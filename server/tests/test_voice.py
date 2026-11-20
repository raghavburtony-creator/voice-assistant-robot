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
from app.voice.app_config import COMMANDS, PAGE_IDS
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
