"""How things are going, for Otto's character (issue #58): the server's end of the `avatar` message.

An avatar event says what is happening ("a permission request is open", "a task is running"), never what Otto should
decide. The orchestrator, the task engine and the policy layer (#44, #49, #47) decide; they call `Bridge.avatar(...)` and
Otto only shows it. The browser (web/src/otto/awareness/avatar.ts) checks every event again and maps it to the events Otto
already has; the two lists below must match it (`test_avatar_kinds_match_the_browser`).

Pure: no FastAPI, no ADK, no I/O. The model never calls this: it is not a tool, so nothing the model says can reach it (D-02).
"""
from __future__ import annotations

import re
from typing import Any

#: The kinds, in the order the issue lists them. Keep equal to AVATAR_KINDS in web/src/otto/awareness/avatar.ts.
AVATAR_KINDS = (
    "thinking", "listening", "speaking", "working", "waiting", "permission", "success", "failure", "interruption",
    "emotion", "gesture", "movement",
)
PERMISSION_STATES = ("asking", "granted", "denied")
#: Otto's faces and gestures (web/src/otto/robot/robot.ts, gestures.ts). A test keeps them equal to the browser's.
EXPRESSIONS = ("happy", "searching", "excited", "alert", "resting", "sad", "curious")
GESTURES = ("welcomeWave", "celebrate", "nod", "headShake", "thinkingHand", "goodbyeWave", "lookAround", "stretch", "pointLeft", "pointRight")

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$")
TOPIC_CHARS = 60
MESSAGE_CHARS = 140
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def _text(value: Any, limit: int) -> str | None:
    """Plain single-line text, capped; None when nothing is left. Never HTML, never a link (D-18)."""
    if not isinstance(value, str):
        return None
    clean = " ".join(_CONTROL.sub(" ", value).split())[:limit].strip()
    return clean or None


def _id(value: Any) -> str | None:
    return value if isinstance(value, str) and ID_RE.match(value) else None


def clean_avatar_event(event: Any) -> dict | None:
    """The event as it goes on the wire, or None when it is unknown or does not fit. Extra fields are dropped."""
    if not isinstance(event, dict) or event.get("kind") not in AVATAR_KINDS:
        return None
    kind = event["kind"]
    out: dict[str, Any] = {"kind": kind}
    topic, message = _text(event.get("topic"), TOPIC_CHARS), _text(event.get("message"), MESSAGE_CHARS)
    named = {**({"topic": topic} if topic else {}), **({"message": message} if message else {})}
    if kind in ("listening", "speaking", "interruption"):
        return out
    if kind in ("thinking", "working"):
        key = _id(event.get("id"))
        return {**out, "id": key, **named} if key else None
    if kind == "waiting":
        return {**out, **({"message": message} if message else {})}
    if kind == "permission":
        key = _id(event.get("id"))
        return {**out, "id": key, "state": event["state"], **named} if key and event.get("state") in PERMISSION_STATES else None
    if kind in ("success", "failure"):
        if event.get("id") is not None:
            key = _id(event["id"])
            if not key:
                return None
            out["id"] = key
        return {**out, **named}
    if kind == "emotion":
        return {**out, "expression": event["expression"]} if event.get("expression") in EXPRESSIONS else None
    if kind == "gesture":
        if event.get("gesture") not in GESTURES:
            return None
        intensity = event.get("intensity")
        if isinstance(intensity, (int, float)) and not isinstance(intensity, bool) and intensity == intensity and abs(intensity) != float("inf"):
            out["intensity"] = min(1.0, max(0.0, float(intensity)))
        return {**out, "gesture": event["gesture"]}
    if kind == "movement":
        return {**out, "to": "visitor"} if event.get("to") == "visitor" else None
    return None
