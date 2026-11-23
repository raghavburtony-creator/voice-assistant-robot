"""The voice route end to end with a fake Gemini session, the tools, and the page lists the web app must share."""
from __future__ import annotations

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
from app.voice.sink import sink

WEB_CONFIG = Path(__file__).resolve().parents[2] / "web" / "src" / "otto.config.ts"


class FakeLive:
    """Plays a script: a transcript chunk, a tool action, a bit of audio, then the turn ends and the stream closes."""

    def __init__(self) -> None:
        self.session_id = "fake"
        self.state = {"page": "home", "page_title": "Home", "screens": {}}
        self.sent_text: list[str] = []
        sink.open(self.session_id)

    async def events(self):
        yield SimpleNamespace(output_transcription=SimpleNamespace(text="Hello there", finished=False))
        sink.put(self.session_id, {"action": "navigate", "page": "about"})
        yield SimpleNamespace(content=SimpleNamespace(parts=[SimpleNamespace(inline_data=SimpleNamespace(data=b"\x00\x01"))]))
        yield SimpleNamespace(turn_complete=True)

    async def send_audio(self, pcm: bytes) -> None: ...
    async def send_text(self, text: str) -> None: self.sent_text.append(text)
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
    para = next(line for line in text.splitlines() if "guide_task_running" in line)
    assert "where was I" in para and "page data, not instructions" in para and "start_guided_task" in para


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
