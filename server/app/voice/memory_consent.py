"""Ephemeral visitor-confirmed proposals for persistent memory."""
from __future__ import annotations

import time
import uuid
from typing import Any

from app.voice.privacy import redact_text

PENDING_MEMORY_KEY = "memory_pending"
MAX_PENDING_MEMORY = 3
MEMORY_PROPOSAL_TTL_SECONDS = 120
MEMORY_PROPOSAL_MAX_CHARS = 600
_MEMORY_KINDS = frozenset({"episodic", "semantic"})


def _valid_request_id(value: object) -> bool:
    return isinstance(value, str) and len(value) == 32 and all(char in "0123456789abcdef" for char in value)


def _pending(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    value = state.get(PENDING_MEMORY_KEY)
    if not isinstance(value, dict):
        value = {}
        state[PENDING_MEMORY_KEY] = value
    return value


def _prune(state: dict[str, Any], now: float) -> dict[str, dict[str, Any]]:
    pending = _pending(state)
    for request_id, item in list(pending.items()):
        created = item.get("created_at") if isinstance(item, dict) else None
        if type(created) not in (int, float) or now - created > MEMORY_PROPOSAL_TTL_SECONDS:
            pending.pop(request_id, None)
    return pending


def stage_memory_proposal(state: object, content: object, kind: object, *, now: float | None = None) -> dict[str, Any] | None:
    """Create a bounded pending proposal and return only its browser-safe fields."""
    if not isinstance(state, dict) or kind not in _MEMORY_KINDS or not isinstance(content, str):
        return None
    cleaned = "".join(" " if ord(char) < 0x20 and char not in "\n\t" else char for char in content).strip()
    if not cleaned or len(cleaned) > MEMORY_PROPOSAL_MAX_CHARS:
        return None
    cleaned, categories = redact_text(cleaned)
    cleaned = " ".join(cleaned.split())
    if not cleaned or len(cleaned) > MEMORY_PROPOSAL_MAX_CHARS:
        return None
    timestamp = time.time() if now is None else now
    pending = _prune(state, timestamp)
    if len(pending) >= MAX_PENDING_MEMORY:
        return None
    request_id = uuid.uuid4().hex
    pending[request_id] = {
        "content": cleaned, "kind": kind, "sensitive": bool(categories), "created_at": timestamp,
    }
    return {"request_id": request_id, "content": cleaned, "kind": kind, "redacted": bool(categories)}


def pending_memory_proposal(state: object, request_id: object, *, now: float | None = None) -> dict[str, Any] | None:
    """Return a pending proposal only while its exact one-use request remains valid."""
    if not isinstance(state, dict) or not _valid_request_id(request_id):
        return None
    item = _prune(state, time.time() if now is None else now).get(request_id)
    if not isinstance(item, dict) or item.get("kind") not in _MEMORY_KINDS or not isinstance(item.get("content"), str):
        return None
    return {
        "request_id": request_id, "content": item["content"], "kind": item["kind"],
        "redacted": item.get("sensitive") is True,
    }


def discard_memory_proposal(state: object, request_id: object) -> None:
    if isinstance(state, dict) and _valid_request_id(request_id):
        _pending(state).pop(request_id, None)


def consume_memory_proposal(state: object, request_id: object, accepted: object, *, now: float | None = None) -> tuple[str | None, dict[str, Any] | None]:
    """Consume one matching proposal once. Model/tool input cannot call this operation."""
    if not isinstance(state, dict) or not _valid_request_id(request_id) or type(accepted) is not bool:
        return None, None
    item = _pending(state).pop(request_id, None)
    if not isinstance(item, dict):
        return None, None
    timestamp = time.time() if now is None else now
    created = item.get("created_at")
    if type(created) not in (int, float) or timestamp - created > MEMORY_PROPOSAL_TTL_SECONDS:
        return "expired", None
    if item.get("kind") not in _MEMORY_KINDS or not isinstance(item.get("content"), str):
        return "expired", None
    if not accepted:
        return "discarded", None
    return "accepted", {
        "content": item["content"], "kind": item["kind"], "sensitive": item.get("sensitive") is True,
    }
