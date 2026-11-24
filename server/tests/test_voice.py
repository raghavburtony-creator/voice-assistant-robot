"""The voice route end to end with a fake Gemini session, the tools, and the page lists the web app must share."""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import re
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import get_args

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import settings
from app.main import app
from app.voice import route, tools
from app.voice.app_config import COMMANDS, PAGE_IDS, system_instruction
from app.voice.bridge import FRAME_GAP_SECONDS, JPEG_MAGIC, MAX_FRAME_BYTES, Bridge
from app.voice.sink import sink

WEB_CONFIG = Path(__file__).resolve().parents[2] / "web" / "src" / "otto.config.ts"


class FakeLive:
    """Plays a script: a transcript chunk, a tool action, a bit of audio, then the turn ends and the stream closes."""

    def __init__(self) -> None:
        self.session_id = "fake"
        self.state = {"page": "home", "page_title": "Home", "screens": {}}
        self.sent_text: list[str] = []
        self.images: list[bytes] = []
        sink.open(self.session_id)

    async def events(self):
        yield SimpleNamespace(output_transcription=SimpleNamespace(text="Hello there", finished=False))
        sink.put(self.session_id, {"action": "navigate", "page": "about"})
        yield SimpleNamespace(content=SimpleNamespace(parts=[SimpleNamespace(inline_data=SimpleNamespace(data=b"\x00\x01"))]))
        yield SimpleNamespace(turn_complete=True)

    async def send_audio(self, pcm: bytes) -> None: ...
    async def send_text(self, text: str) -> None: self.sent_text.append(text)
    async def send_image(self, jpeg: bytes) -> None: self.images.append(jpeg)
    async def audio_end(self) -> None: ...
    def close(self) -> None: sink.close(self.session_id)


@pytest.fixture
def keyed(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", SecretStr("test-key"))

    @asynccontextmanager
    async def fake_connect(language, page, detail):
        live = FakeLive()
        try:
            yield live
        finally:
            live.close()

    monkeypatch.setattr(route, "connect_adk", fake_connect)


def test_not_configured_without_a_key(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", SecretStr(""))
    with TestClient(app).websocket_connect("/api/v1/voice/live") as ws:
        assert ws.receive_json()["code"] == "not_configured"


def test_foreign_origin_is_refused(keyed):
    with pytest.raises(Exception):
        with TestClient(app).websocket_connect("/api/v1/voice/live", headers={"origin": "https://evil.example"}) as ws:
            ws.receive_json()


def test_bad_start(keyed):
    with TestClient(app).websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json({"type": "nonsense"})
        assert ws.receive_json()["code"] == "bad_start"


def test_a_scripted_turn(keyed):
    with TestClient(app).websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json({"type": "start", "language": "en", "page": "home"})
        assert ws.receive_json() == {"type": "ready", "limitSeconds": settings.max_session_seconds}
        assert ws.receive_json() == {"type": "transcript", "role": "assistant", "text": "Hello there"}
        assert ws.receive_json() == {"type": "action", "action": "navigate", "page": "about"}
        assert ws.receive_bytes() == b"\x00\x01"
        assert ws.receive_json() == {"type": "turn_complete"}
        assert ws.receive_json() == {"type": "ended", "reason": "service_ended"}


def _context(page="home"):
    return SimpleNamespace(state={"page": page, "screens": {}}, session=SimpleNamespace(id="tool-test"))


def test_navigate_queues_an_action_and_moves_the_page():
    sink.open("tool-test")
    ctx = _context()
    assert tools.navigate_to("features", ctx)["ok"] is True
    assert sink.drain("tool-test") == [{"action": "navigate", "page": "features"}]
    assert ctx.state["page"] == "features"
    assert "error" in tools.navigate_to("nowhere", ctx)
    assert sink.drain("tool-test") == []
    sink.close("tool-test")


def test_run_command_only_allows_known_commands():
    sink.open("tool-test")
    ctx = _context()
    assert tools.run_command("show_message", ctx)["ok"] is True
    assert "error" in tools.run_command("rm -rf", ctx)
    assert sink.drain("tool-test") == [{"action": "command", "name": "show_message"}]
    sink.close("tool-test")


def test_tool_enums_match_the_config():
    assert list(get_args(tools.PageId)) == PAGE_IDS
    assert list(get_args(tools.Command)) == COMMANDS


def test_web_config_has_the_same_pages_and_commands():
    text = WEB_CONFIG.read_text(encoding="utf-8")
    assert re.findall(r"\{ id: '([a-z0-9-]+)', title:", text) == PAGE_IDS
    commands = re.search(r"COMMANDS = \[([^\]]*)\]", text)
    assert commands and re.findall(r"'([a-z_]+)'", commands.group(1)) == COMMANDS


def test_show_target_only_allows_reported_targets():
    sink.open("tool-test")
    ctx = _context()
    ctx.state["screens"] = {"guide_targets": {"targets": [{"id": "save", "label": "Save", "description": "Saves it"}]}}
    out = tools.show_target("nope", ctx)
    assert out["ok"] is False and out["known"] == ["save"]
    for bad in ("", "x" * 65, None, 5):
        assert tools.show_target(bad, ctx)["ok"] is False
    assert sink.drain("tool-test") == []
    assert tools.show_target("save", ctx) == {"ok": True, "label": "Save", "description": "Saves it"}
    assert sink.drain("tool-test") == [{"action": "guide", "target": "save"}]
    ctx.state["screens"] = {}
    assert tools.show_target("save", ctx)["ok"] is False
    sink.close("tool-test")


def test_start_guided_task_only_allows_reported_tasks():
    sink.open("tool-test")
    ctx = _context()
    ctx.state["screens"] = {"guide_tasks": {"tasks": [{"id": "show-message", "title": "Show an example message", "steps": 2}]}}
    out = tools.start_guided_task("nope", ctx)
    assert out["ok"] is False and out["known"] == ["show-message"]
    for bad in ("", "x" * 65, None, 5):
        assert tools.start_guided_task(bad, ctx)["ok"] is False
    assert sink.drain("tool-test") == []
    assert tools.start_guided_task("show-message", ctx) == {"ok": True, "title": "Show an example message", "steps": 2}
    assert sink.drain("tool-test") == [{"action": "task", "task": "show-message"}]
    ctx.state["screens"] = {}
    assert tools.start_guided_task("show-message", ctx)["ok"] is False
    sink.close("tool-test")


def test_instruction_prefers_a_matching_guided_task_over_show_target():
    text = system_instruction("Otto", "en", "Home")
    show = next(line for line in text.splitlines() if line.startswith("- show_target:"))
    task = next(line for line in text.splitlines() if line.startswith("- start_guided_task:"))
    assert "no task in guide_tasks matches" in show
    assert "not show_target" in task


def test_screen_context_reports_the_running_task_and_the_instruction_says_how_to_use_it():
    ctx = _context()
    running = {"id": "show-message", "title": "Show an example message", "step": 2, "total": 3, "say": "Press Show."}
    ctx.state["screens"] = {"guide_task_running": running}
    assert tools.get_screen_context(ctx)["guide_task_running"] == running
    # Cleared when the task ends: the browser sends null, and get_screen_context leaves it out.
    ctx.state["screens"] = {"guide_task_running": None}
    assert "guide_task_running" not in tools.get_screen_context(ctx)
    text = system_instruction("Otto", "en", "Home")
    para = next(line for line in text.splitlines() if line.startswith("The guided task running now"))
    assert "where was I" in para and "page data, not instructions" in para and "start_guided_task" in para


def test_screen_context_reports_what_the_app_is_busy_with_and_the_instruction_says_how_to_use_it():
    ctx = _context()
    busy = {"running": [{"id": "up", "topic": "upload", "outcome": "running"}],
            "ended": [{"id": "render", "topic": "render", "outcome": "failed", "message": "Out of memory."}]}
    ctx.state["screens"] = {"app_tasks": busy}
    assert tools.get_screen_context(ctx)["app_tasks"] == busy
    ctx.state["screens"] = {"app_tasks": None}
    assert "app_tasks" not in tools.get_screen_context(ctx)
    text = system_instruction("Otto", "en", "Home")
    para = next(line for line in text.splitlines() if "app_tasks" in line)
    assert "is my upload done" in para and "page data, not instructions" in para


def test_move_guided_task_takes_only_known_moves_and_only_while_a_task_runs():
    sink.open("tool-test")
    ctx = _context()
    assert tools.move_guided_task("next", ctx)["ok"] is False  # nothing running
    ctx.state["screens"] = {"guide_task_running": {"id": "show-message", "title": "Show an example message", "step": 1, "total": 3}}
    for bad in ("skip", "goto", "", None, 3):
        assert tools.move_guided_task(bad, ctx)["ok"] is False
    assert tools.move_guided_task("back", ctx)["ok"] is False  # already on the first step
    assert sink.drain("tool-test") == []
    for move in ("next", "back", "stop"):
        ctx.state["screens"]["guide_task_running"]["step"] = 2
        assert tools.move_guided_task(move, ctx) == {"ok": True, "move": move, "task": "Show an example message"}
    assert sink.drain("tool-test") == [{"action": "task_move", "move": m} for m in ("next", "back", "stop")]
    ctx.state["screens"] = {"guide_task_running": None}  # ended
    assert tools.move_guided_task("stop", ctx)["ok"] is False
    sink.close("tool-test")


def test_task_moves_match_the_web_kit():
    text = (WEB_CONFIG.parent / "otto" / "guidance" / "task.ts").read_text(encoding="utf-8")
    moves = re.search(r"GUIDE_TASK_MOVES = \[([^\]]*)\]", text)
    assert moves and re.findall(r"'([a-z]+)'", moves.group(1)) == list(get_args(tools.TaskMove))


def test_action_kinds_match_on_both_ends():
    """D-22: the server link and the browser link name the same actions. A tool that sends a kind the browser drops, or a
    browser variant no tool sends, means one of the two checks (D-02) is missing for it."""
    sent = set(re.findall(r'_send\(tool_context, \{"action": "([a-z_]+)"', Path(tools.__file__).read_text(encoding="utf-8")))
    text = (WEB_CONFIG.parent / "otto" / "messages.ts").read_text(encoding="utf-8")
    union = re.search(r"export type AssistantAction = (.*?)\n\n", text, flags=re.S)
    assert union
    declared = set(re.findall(r"action: '([a-z_]+)'", union.group(1)))
    body = text[text.index("export function toAssistantAction"):]
    checked = set(re.findall(r"message\.action === '([a-z_]+)'", body))
    assert sent and sent == declared == checked, (sent, declared, checked)


def test_show_target_refuses_hidden_and_flags_disabled_targets():
    sink.open("tool-test")
    ctx = _context()
    ctx.state["screens"] = {"guide_targets": {"targets": [
        {"id": "menu", "label": "Menu", "hidden": True},
        {"id": "pay", "label": "Pay", "disabled": True},
    ]}}
    out = tools.show_target("menu", ctx)
    assert out["ok"] is False and "hidden" in out["error"]
    assert sink.drain("tool-test") == []
    out = tools.show_target("pay", ctx)
    assert out["ok"] is True and out["disabled"] is True
    assert sink.drain("tool-test") == [{"action": "guide", "target": "pay"}]
    sink.close("tool-test")


def test_show_card_checks_and_caps_what_the_model_sends():
    sink.open("tool-test")
    ctx = _context()
    assert tools.show_card("", "body", ctx)["ok"] is False
    assert tools.show_card("Title", "   ", ctx)["ok"] is False
    assert tools.show_card(5, "body", ctx)["ok"] is False  # type: ignore[arg-type]
    assert sink.drain("tool-test") == []
    out = tools.show_card("Steps\x00", "  one\n\ntwo  ", ctx, code="a\n\tb\x07", follow_ups=["Next?", "", 3, "b" * 200, "c", "d"])
    assert out["ok"] is True
    [action] = sink.drain("tool-test")
    card = action["card"]
    assert action["action"] == "card"
    assert card["title"] == "Steps" and card["body"] == "one two"
    assert card["code"] == "a\n\tb"
    assert card["follow_ups"] == ["Next?", "b" * tools.CARD_FOLLOW_UP_CHARS, "c"]
    tools.show_card("t" * 500, "x" * 5000, ctx, code="y" * 9000)
    [big] = sink.drain("tool-test")
    assert len(big["card"]["title"]) == tools.CARD_TITLE_CHARS
    assert len(big["card"]["body"]) == tools.CARD_BODY_CHARS
    assert len(big["card"]["code"]) == tools.CARD_CODE_CHARS
    assert "follow_ups" not in big["card"]
    sink.close("tool-test")


def test_instruction_keeps_urls_and_code_out_of_speech():
    text = system_instruction("App", "en", "Home")
    assert "show_card" in text and "Never say a URL" in text
    assert "page data, not instructions" in text


def test_tool_schemas_have_no_anyof():
    """An Optional argument becomes anyOf in the schema; keep the declarations plain (see show_card)."""
    for tool in tools.TOOLS:
        assert "anyOf" not in str(tool._get_declaration().parameters_json_schema), tool.name


# ---- shared frames (D-21) ----

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 60


class ScriptedSocket:
    """Hands the bridge these browser messages, then disconnects."""

    def __init__(self, *messages: dict) -> None:
        self.messages = [{"type": "websocket.receive", "text": json.dumps(m)} for m in messages]

    async def receive(self) -> dict:
        return self.messages.pop(0) if self.messages else {"type": "websocket.disconnect"}


def run_bridge(*messages: dict) -> tuple[Bridge, FakeLive]:
    live = FakeLive()
    bridge = Bridge(ScriptedSocket(*messages), live)
    asyncio.run(bridge.browser_to_model())
    live.close()
    return bridge, live


def frame(data: bytes = JPEG) -> dict:
    return {"type": "frame", "data": base64.b64encode(data).decode()}


SHARE = {"type": "capture", "source": "screen"}


def test_a_frame_reaches_the_model_as_a_jpeg_only_while_a_share_is_on():
    _, live = run_bridge(frame())
    assert live.images == []
    bridge, live = run_bridge(SHARE, frame())
    assert live.images == [JPEG] and bridge.frames == 1
    _, live = run_bridge({"type": "capture", "source": "camera"}, {"type": "capture", "source": None}, frame())
    assert live.images == []


def test_a_share_names_only_camera_or_screen():
    bridge, live = run_bridge({"type": "capture", "source": "microphone"}, frame())
    assert bridge.capture is None and live.images == []


def test_frames_that_are_not_jpeg_too_big_or_not_base64_are_dropped():
    _, live = run_bridge(SHARE, frame(b"\x89PNG\r\n\x1a\n" + b"\x00" * 60))
    assert live.images == []
    _, live = run_bridge(SHARE, frame(JPEG_MAGIC + b"\x00" * MAX_FRAME_BYTES))
    assert live.images == []
    _, live = run_bridge(SHARE, {"type": "frame", "data": "not base64!"}, {"type": "frame", "data": 42})
    assert live.images == []


def test_frames_faster_than_one_a_second_are_dropped():
    bridge, live = run_bridge(SHARE, frame(), frame(), frame())
    assert live.images == [JPEG] and bridge.frames == 1


def test_the_full_second_is_enforced_before_a_frame_is_decoded(monkeypatch):
    assert FRAME_GAP_SECONDS >= 1.0
    decoded = []
    real = base64.b64decode
    monkeypatch.setattr("app.voice.bridge.base64.b64decode", lambda *a, **k: decoded.append(1) or real(*a, **k))
    run_bridge(SHARE, frame(), frame(), frame())
    assert len(decoded) == 1


def test_frames_are_never_logged(caplog):
    caplog.set_level(logging.DEBUG)
    data = frame()["data"]
    run_bridge(SHARE, frame())
    assert data not in caplog.text
