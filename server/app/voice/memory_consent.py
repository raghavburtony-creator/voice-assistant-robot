"""Ephemeral visitor-confirmed proposals for persistent memory."""
from __future__ import annotations

import time
import uuid
from typing import Any

from app.voice.privacy import CATEGORIES, redact_text

PENDING_MEMORY_KEY = "memory_pending"
MAX_PENDING_MEMORY = 3
MEMORY_PROPOSAL_TTL_SECONDS = 120
MEMORY_PROPOSAL_MAX_CHARS = 600
_MEMORY_KINDS = frozenset({"episodic", "semantic"})


def _valid_request_id(value: object) -> bool:
    return isinstance(value, str) and len(value) == 32 and all(char in "0123456789abcdef" for char in value)


def _supports_state(state: object) -> bool:
    """Accept a plain dict or ADK's dict-like State object."""
    return all(callable(getattr(state, name, None)) for name in ("get", "__getitem__", "__setitem__", "__contains__"))


def _pending(state: object) -> dict[str, dict[str, Any]]:
    value = state.get(PENDING_MEMORY_KEY)  # type: ignore[attr-defined]
    return dict(value) if isinstance(value, dict) else {}


def _write_pending(state: object, pending: dict[str, dict[str, Any]]) -> None:
    # Assign a new nested mapping so ADK State records the update as a state delta.
    state[PENDING_MEMORY_KEY] = pending  # type: ignore[index]


def _prune(state: object, now: float) -> dict[str, dict[str, Any]]:
    pending = _pending(state)
    clean: dict[str, dict[str, Any]] = {}
    for request_id, item in pending.items():
        created = item.get("created_at") if isinstance(item, dict) else None
        if (
            _valid_request_id(request_id)
            and type(created) in (int, float)
            and 0 <= now - created <= MEMORY_PROPOSAL_TTL_SECONDS
        ):
            clean[request_id] = item
    _write_pending(state, clean)
    return clean


def stage_memory_proposal(state: object, content: object, kind: object, *, now: float | None = None) -> dict[str, Any] | None:
    """Create a bounded pending proposal and return only its browser-safe fields."""
    if not _supports_state(state) or not isinstance(kind, str) or kind not in _MEMORY_KINDS or not isinstance(content, str):
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
        "content": cleaned, "kind": kind, "sensitive": bool(categories),
        "redacted_categories": list(categories), "created_at": timestamp,
    }
    _write_pending(state, pending)
    return {"request_id": request_id, "content": cleaned, "kind": kind, "redacted": bool(categories)}


def pending_memory_proposal(state: object, request_id: object, *, now: float | None = None) -> dict[str, Any] | None:
    """Return a pending proposal only while its exact one-use request remains valid."""
    if not _supports_state(state) or not _valid_request_id(request_id):
        return None
    pending = _prune(state, time.time() if now is None else now)
    item = pending.get(request_id)
    if not isinstance(item, dict) or not isinstance(item.get("kind"), str) or item.get("kind") not in _MEMORY_KINDS or not isinstance(item.get("content"), str):
        pending.pop(request_id, None)
        _write_pending(state, pending)
        return None
    return {
        "request_id": request_id, "content": item["content"], "kind": item["kind"],
        "redacted": item.get("sensitive") is True,
    }


def discard_memory_proposal(state: object, request_id: object, *, now: float | None = None) -> None:
    if _supports_state(state) and _valid_request_id(request_id):
        pending = _prune(state, time.time() if now is None else now)
        pending.pop(request_id, None)
        _write_pending(state, pending)


def consume_memory_proposal(state: object, request_id: object, accepted: object, *, now: float | None = None) -> tuple[str | None, dict[str, Any] | None]:
    """Consume one matching proposal once. Model/tool input cannot call this operation."""
    if not _supports_state(state) or not _valid_request_id(request_id) or type(accepted) is not bool:
        return None, None
    timestamp = time.time() if now is None else now
    original_pending = _pending(state)
    original_item = original_pending.get(request_id)
    if not isinstance(original_item, dict):
        _prune(state, timestamp)
        return None, None
    created = original_item.get("created_at")
    age = timestamp - created if type(created) in (int, float) else None
    if age is None or age < 0 or age > MEMORY_PROPOSAL_TTL_SECONDS:
        _prune(state, timestamp)
        return "expired", None

    pending = _prune(state, timestamp)
    item = pending.pop(request_id, None)
    _write_pending(state, pending)
    if not isinstance(item, dict):
        return None, None
    if not isinstance(item.get("kind"), str) or item.get("kind") not in _MEMORY_KINDS or not isinstance(item.get("content"), str):
        return "expired", None
    if not accepted:
        return "discarded", None
    categories = item.get("redacted_categories", [])
    if not isinstance(categories, list):
        categories = []
    categories = tuple(sorted({value for value in categories if isinstance(value, str) and value in CATEGORIES}))
    return "accepted", {
        "content": item["content"], "kind": item["kind"],
        "sensitive": item.get("sensitive") is True or bool(categories),
        "redacted_categories": categories,
    }
