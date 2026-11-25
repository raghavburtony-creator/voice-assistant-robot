"""The server's end of the `avatar` message (issue #58): what may be sent, and that both ends agree on the lists."""
from __future__ import annotations

import asyncio
import re
from pathlib import Path

import pytest

from app.voice.avatar import AVATAR_KINDS, EXPRESSIONS, GESTURES, PERMISSION_STATES, clean_avatar_event
from app.voice.bridge import Bridge

WEB = Path(__file__).resolve().parents[2] / "web" / "src" / "otto"


def _ts_list(source: str, pattern: str) -> list[str]:
    match = re.search(pattern, source, re.S)
    assert match, pattern
    return re.findall(r"'([A-Za-z]+)'", match.group(1))


def test_avatar_kinds_match_the_browser():
    avatar_ts = (WEB / "awareness" / "avatar.ts").read_text()
    assert list(AVATAR_KINDS) == _ts_list(avatar_ts, r"AVATAR_KINDS = \[(.*?)\] as const")
    assert list(PERMISSION_STATES) == _ts_list(avatar_ts, r"PERMISSION_STATES: readonly PermissionState\[\] = \[(.*?)\]")


def test_faces_and_gestures_match_the_browser():
    assert list(EXPRESSIONS) == _ts_list((WEB / "robot" / "robot.ts").read_text(), r"ROBOT_EXPRESSIONS: readonly RobotExpression\[\] = \[(.*?)\]")
    assert list(GESTURES) == _ts_list((WEB / "robot" / "gestures.ts").read_text(), r"GESTURE_NAMES = \[(.*?)\] as const")


@pytest.mark.parametrize("event, expected", [
    ({"kind": "listening", "junk": 1}, {"kind": "listening"}),
    ({"kind": "working", "id": "render-1", "topic": "image", "message": "Rendering", "html": "<b>"},
     {"kind": "working", "id": "render-1", "topic": "image", "message": "Rendering"}),
    ({"kind": "permission", "id": "p1", "state": "asking", "message": "May I?"}, {"kind": "permission", "id": "p1", "state": "asking", "message": "May I?"}),
    ({"kind": "success"}, {"kind": "success"}),
    ({"kind": "failure", "id": "t:1"}, {"kind": "failure", "id": "t:1"}),
    ({"kind": "emotion", "expression": "sad"}, {"kind": "emotion", "expression": "sad"}),
    ({"kind": "gesture", "gesture": "nod", "intensity": 3}, {"kind": "gesture", "gesture": "nod", "intensity": 1.0}),
    ({"kind": "gesture", "gesture": "nod", "intensity": True}, {"kind": "gesture", "gesture": "nod"}),
    ({"kind": "movement", "to": "visitor"}, {"kind": "movement", "to": "visitor"}),
])
def test_a_good_event_goes_out_clean(event, expected):
    assert clean_avatar_event(event) == expected


@pytest.mark.parametrize("event", [
    None, 5, "working", {}, {"kind": "dance"}, {"kind": "working"}, {"kind": "working", "id": "has space"}, {"kind": "working", "id": "x" * 65},
    {"kind": "permission", "id": "p", "state": "maybe"}, {"kind": "permission", "state": "asking"}, {"kind": "success", "id": "<script>"},
    {"kind": "emotion", "expression": "furious"}, {"kind": "gesture", "gesture": "backflip"}, {"kind": "movement", "to": "#save"},
    {"kind": "movement", "to": "https://x.test"},
])
def test_a_bad_event_is_dropped(event):
    assert clean_avatar_event(event) is None


def test_text_is_plain_single_line_and_capped():
    out = clean_avatar_event({"kind": "waiting", "message": "Line one\x00\n  line two " + "x" * 300})
    assert out is not None and len(out["message"]) == 140 and "\n" not in out["message"] and "\x00" not in out["message"]
    assert clean_avatar_event({"kind": "waiting", "message": "   "}) == {"kind": "waiting"}


class _Live:
    session_id = "avatar"
    state: dict = {}


class _Socket:
    def __init__(self) -> None:
        self.sent: list = []

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)

    async def send_bytes(self, data: bytes) -> None:
        self.sent.append(data)


def test_the_bridge_queues_a_checked_event_and_drops_a_bad_one():
    async def go():
        ws = _Socket()
        bridge = Bridge(ws, _Live())  # type: ignore[arg-type]
        pump = asyncio.create_task(bridge.output_pump())
        assert bridge.avatar({"kind": "permission", "id": "send", "state": "asking", "message": "May I send this?", "extra": 1}) is True
        assert bridge.avatar({"kind": "dance"}) is False
        assert bridge.avatar("not an event") is False
        await bridge.out.flush()
        pump.cancel()
        return ws.sent

    assert asyncio.run(go()) == [{"type": "avatar", "event": {"kind": "permission", "id": "send", "state": "asking", "message": "May I send this?"}}]


def test_an_avatar_event_keeps_its_place_between_speech_and_messages():
    async def go():
        ws = _Socket()
        bridge = Bridge(ws, _Live())  # type: ignore[arg-type]
        bridge.out.audio(b"\x01")
        bridge.avatar({"kind": "working", "id": "j"})
        bridge.out.interrupt()  # voids the speech, keeps the avatar message
        pump = asyncio.create_task(bridge.output_pump())
        await bridge.out.flush()
        pump.cancel()
        return ws.sent

    assert asyncio.run(go()) == [{"type": "avatar", "event": {"kind": "working", "id": "j"}}, {"type": "interrupted"}]
