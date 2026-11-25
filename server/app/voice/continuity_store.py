"""Small SQLite-backed store for one bounded guided-task continuity record per host identity.

The raw host identity is never persisted. A SHA-256 key scopes records to the host/app and opaque identity;
the JSON payload contains exactly scope, task, step and savedAt.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

RETENTION_SECONDS = 7 * 24 * 60 * 60
MAX_ID_CHARS = 128


@dataclass(frozen=True)
class ContinuityRecord:
    scope: str
    task: str
    step: str
    savedAt: int

    def payload(self) -> dict:
        return {"scope": self.scope, "task": self.task, "step": self.step, "savedAt": self.savedAt}


class ContinuityStore(Protocol):
    def load(self, scope: str, identity: str, *, now: int | None = None) -> ContinuityRecord | None: ...
    def save(self, record: ContinuityRecord, identity: str) -> None: ...
    def delete(self, scope: str, identity: str) -> None: ...


def _key(scope: str, identity: str) -> str:
    return hashlib.sha256((scope + "\0" + identity).encode("utf-8")).hexdigest()


def _valid_id(value: object) -> bool:
    return isinstance(value, str) and 0 < len(value) <= MAX_ID_CHARS and all(c.isascii() and (c.isalnum() or c in "_.:-") for c in value)


class SQLiteContinuityStore:
    """SQLite adapter; each operation opens its own short-lived connection."""

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS continuity (record_key TEXT PRIMARY KEY, payload TEXT NOT NULL)")

    def _connect(self):
        return sqlite3.connect(self.path, timeout=5)

    def load(self, scope: str, identity: str, *, now: int | None = None) -> ContinuityRecord | None:
        if not scope or not identity:
            return None
        current = int(time.time()) if now is None else now
        key = _key(scope, identity)
        with self._connect() as db:
            row = db.execute("SELECT payload FROM continuity WHERE record_key = ?", (key,)).fetchone()
            if row is None:
                return None
            try:
                data = json.loads(row[0])
                if set(data) != {"scope", "task", "step", "savedAt"}:
                    raise ValueError("unexpected fields")
                record = ContinuityRecord(**data)
                if record.scope != scope or not _valid_id(record.task) or not _valid_id(record.step):
                    raise ValueError("invalid record")
                age = current - record.savedAt
                if age < 0 or age > RETENTION_SECONDS:
                    raise ValueError("expired record")
            except (TypeError, ValueError, json.JSONDecodeError):
                db.execute("DELETE FROM continuity WHERE record_key = ?", (key,))
                return None
            return record

    def save(self, record: ContinuityRecord, identity: str) -> None:
        if not identity or not record.scope or not _valid_id(record.task) or not _valid_id(record.step):
            return
        payload = json.dumps(record.payload(), separators=(",", ":"), ensure_ascii=True)
        with self._connect() as db:
            db.execute("INSERT INTO continuity(record_key, payload) VALUES(?, ?) "
                       "ON CONFLICT(record_key) DO UPDATE SET payload=excluded.payload",
                       (_key(record.scope, identity), payload))

    def delete(self, scope: str, identity: str) -> None:
        if not scope or not identity:
            return
        with self._connect() as db:
            db.execute("DELETE FROM continuity WHERE record_key = ?", (_key(scope, identity),))
