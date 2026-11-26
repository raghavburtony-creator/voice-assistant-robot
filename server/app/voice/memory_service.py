"""Explicit, identity-scoped memory for Otto.

The service is deliberately a storage/retrieval primitive, not an agent or action
router. Callers must supply the trusted host identity and explicitly authorize every
write. Raw identities and sensitive records are never returned in model context.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from app.voice.privacy import has_placeholder, redact_text

MemoryKind = Literal["episodic", "semantic", "working"]
Sensitivity = Literal["normal", "sensitive"]

MAX_CONTENT_CHARS = 2_000
MAX_PROVENANCE_CHARS = 240
MAX_RECORDS_PER_IDENTITY = 500
MAX_CONTEXT_CHARS = 1_200
DEFAULT_LIMIT = 20
WORKING_RETENTION_SECONDS = 24 * 60 * 60
_KIND_VALUES = frozenset({"episodic", "semantic", "working"})
_SENSITIVITY_VALUES = frozenset({"normal", "sensitive"})


@dataclass(frozen=True)
class MemoryRecord:
    id: str
    kind: MemoryKind
    content: str
    provenance: str
    sensitivity: Sensitivity
    created_at: int
    updated_at: int
    related_ids: tuple[str, ...]

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "kind": self.kind,
            "content": self.content,
            "provenance": self.provenance,
            "sensitivity": self.sensitivity,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "related_ids": list(self.related_ids),
        }


def _identity_key(scope: str, identity: str) -> str:
    if not isinstance(scope, str) or not scope.strip() or not isinstance(identity, str) or not identity:
        raise ValueError("A trusted scope and identity are required")
    return hashlib.sha256((scope.strip() + "\0" + identity).encode("utf-8")).hexdigest()


def _clean_text(value: object, cap: int, *, required: bool = True) -> str:
    if not isinstance(value, str):
        raise ValueError("Memory text must be a string")
    cleaned = "".join(" " if ord(ch) < 0x20 and ch not in "\n\t" else ch for ch in value).strip()
    if required and not cleaned:
        raise ValueError("Memory text cannot be empty")
    if len(cleaned) > cap:
        raise ValueError(f"Memory text exceeds {cap} characters")
    return cleaned


def _clean_redacted(value: object, cap: int) -> tuple[str, tuple[str, ...]]:
    """Validate, redact (privacy.py), then validate again: a placeholder can be longer than what it replaced."""
    text = _clean_text(value, cap)
    text, categories = redact_text(text)
    return _clean_text(text, cap), categories


def _record(row: tuple) -> MemoryRecord:
    related = json.loads(row[8])
    if not isinstance(related, list) or any(not isinstance(item, str) for item in related):
        related = []
    return MemoryRecord(
        id=row[0], kind=row[1], content=row[2], provenance=row[3],
        sensitivity=row[4], created_at=row[5], updated_at=row[6],
        related_ids=tuple(related),
    )


class SQLiteMemoryService:
    """SQLite-backed memory store; each operation uses a short-lived connection."""

    @staticmethod
    def _purge_expired_working(db: sqlite3.Connection, timestamp: int) -> int:
        """Delete working records whose last update is beyond the 24-hour retention window."""
        cursor = db.execute(
            "DELETE FROM memories WHERE kind = 'working' AND updated_at < ?",
            (timestamp - WORKING_RETENTION_SECONDS,),
        )
        return cursor.rowcount

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self._connection() as db:
            db.execute(
                """CREATE TABLE IF NOT EXISTS memories (
                    id TEXT PRIMARY KEY,
                    identity_key TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    content TEXT NOT NULL,
                    provenance TEXT NOT NULL,
                    sensitivity TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    related_ids TEXT NOT NULL
                )"""
            )
            db.execute("CREATE INDEX IF NOT EXISTS memories_identity_updated ON memories(identity_key, updated_at DESC)")
            db.execute("""CREATE TABLE IF NOT EXISTS memory_audit (
                audit_id TEXT PRIMARY KEY, identity_key TEXT NOT NULL, record_id TEXT NOT NULL,
                action TEXT NOT NULL, provenance TEXT NOT NULL, created_at INTEGER NOT NULL
            )""")
            # Redaction categories (names only, never values). Added in place for databases made before it:
            # a NOT NULL column with a default is a safe, metadata-only ALTER in SQLite.
            if "redacted" not in {row[1] for row in db.execute("PRAGMA table_info(memory_audit)")}:
                try:
                    db.execute("ALTER TABLE memory_audit ADD COLUMN redacted TEXT NOT NULL DEFAULT ''")
                except sqlite3.OperationalError:
                    # Fine only if another process added it first; any other failure must not be hidden.
                    if "redacted" not in {row[1] for row in db.execute("PRAGMA table_info(memory_audit)")}:
                        raise
            db.execute("CREATE INDEX IF NOT EXISTS memory_audit_identity_created ON memory_audit(identity_key, created_at DESC)")
            # Working context is short-lived even when no later recall happens in this process.
            self._purge_expired_working(db, int(time.time()))

    def _connect(self):
        return sqlite3.connect(self.path, timeout=5)

    @contextmanager
    def _connection(self):
        db = self._connect()
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def _audit(
        db: sqlite3.Connection, key: str, record_id: str, action: str, provenance: str, timestamp: int,
        redacted: tuple[str, ...] = (),
    ) -> None:
        db.execute(
            "INSERT INTO memory_audit(audit_id, identity_key, record_id, action, provenance, created_at, redacted) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (str(uuid.uuid4()), key, record_id, action, provenance, timestamp, ",".join(redacted)),
        )
        db.execute(
            "DELETE FROM memory_audit WHERE identity_key = ? AND audit_id NOT IN "
            "(SELECT audit_id FROM memory_audit WHERE identity_key = ? ORDER BY created_at DESC LIMIT 1000)",
            (key, key),
        )

    @staticmethod
    def _explicit(explicit: bool) -> None:
        if explicit is not True:
            raise PermissionError("Memory writes require an explicit user request")

    def remember(
        self,
        scope: str,
        identity: str,
        content: str,
        *,
        kind: MemoryKind = "semantic",
        provenance: str,
        sensitivity: Sensitivity = "normal",
        related_ids: tuple[str, ...] | list[str] = (),
        explicit: bool = False,
        now: int | None = None,
    ) -> MemoryRecord:
        self._explicit(explicit)
        key = _identity_key(scope, identity)
        if kind not in _KIND_VALUES or sensitivity not in _SENSITIVITY_VALUES:
            raise ValueError("Unsupported memory kind or sensitivity")
        clean_content, content_cats = _clean_redacted(content, MAX_CONTENT_CHARS)
        clean_provenance, provenance_cats = _clean_redacted(provenance, MAX_PROVENANCE_CHARS)
        categories = tuple(sorted(set(content_cats) | set(provenance_cats)))
        if categories:
            sensitivity = "sensitive"  # D-17: what had to be redacted is not offered back by default
        if not isinstance(related_ids, (tuple, list)) or len(related_ids) > 20 or any(
            not isinstance(item, str) or not re.fullmatch(r"[0-9a-f-]{36}", item) for item in related_ids
        ):
            raise ValueError("Related memory ids are invalid")
        timestamp = int(time.time()) if now is None else now
        record_id = str(uuid.uuid4())
        related_json = json.dumps(list(dict.fromkeys(related_ids)), separators=(",", ":"))
        with self._connection() as db:
            self._purge_expired_working(db, timestamp)
            count = db.execute("SELECT COUNT(*) FROM memories WHERE identity_key = ?", (key,)).fetchone()[0]
            if count >= MAX_RECORDS_PER_IDENTITY:
                oldest = db.execute(
                    "SELECT id FROM memories WHERE identity_key = ? ORDER BY updated_at ASC LIMIT 1", (key,)
                ).fetchone()
                if oldest:
                    db.execute("DELETE FROM memories WHERE id = ? AND identity_key = ?", (oldest[0], key))
            db.execute(
                "INSERT INTO memories VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (record_id, key, kind, clean_content, clean_provenance, sensitivity, timestamp, timestamp, related_json),
            )
            self._audit(db, key, record_id, "remember", clean_provenance, timestamp, categories)
        return MemoryRecord(record_id, kind, clean_content, clean_provenance, sensitivity, timestamp, timestamp, tuple(json.loads(related_json)))

    def recall(
        self,
        scope: str,
        identity: str,
        *,
        query: str | None = None,
        kind: MemoryKind | None = None,
        include_sensitive: bool = False,
        limit: int = DEFAULT_LIMIT,
        now: int | None = None,
    ) -> list[MemoryRecord]:
        key = _identity_key(scope, identity)
        if kind is not None and kind not in _KIND_VALUES:
            raise ValueError("Unsupported memory kind")
        if type(include_sensitive) is not bool or type(limit) is not int or not 1 <= limit <= 100:
            raise ValueError("Invalid memory retrieval options")
        timestamp = int(time.time()) if now is None else now
        clauses = ["identity_key = ?"]
        params: list[object] = [key]
        if not include_sensitive:
            clauses.append("sensitivity = 'normal'")
        if kind is not None:
            clauses.append("kind = ?")
            params.append(kind)
        clauses.append("(kind != 'working' OR updated_at >= ?)")
        params.append(timestamp - WORKING_RETENTION_SECONDS)
        with self._connection() as db:
            self._purge_expired_working(db, timestamp)
            rows = db.execute(
                "SELECT id, kind, content, provenance, sensitivity, created_at, updated_at, identity_key, related_ids " 
                "FROM memories WHERE " + " AND ".join(clauses) + " ORDER BY updated_at DESC LIMIT 500",
                params,
            ).fetchall()
        records = [_record(row) for row in rows]
        if isinstance(query, str) and query.strip():
            terms = {term.casefold() for term in re.findall(r"[\w'-]+", query) if len(term) > 1}
            if terms:
                def score(item: MemoryRecord) -> int:
                    haystack = (item.content + " " + item.provenance).casefold()
                    return sum(1 for term in terms if term in haystack)
                records = [item for item in records if score(item) > 0]
                records.sort(key=lambda item: (score(item), item.updated_at), reverse=True)
        return records[:limit]

    def update(
        self,
        scope: str,
        identity: str,
        record_id: str,
        *,
        content: str | None = None,
        provenance: str | None = None,
        sensitivity: Sensitivity | None = None,
        related_ids: tuple[str, ...] | list[str] | None = None,
        explicit: bool = False,
        now: int | None = None,
    ) -> MemoryRecord | None:
        self._explicit(explicit)
        key = _identity_key(scope, identity)
        if not isinstance(record_id, str):
            raise ValueError("Invalid memory id")
        timestamp = int(time.time()) if now is None else now
        with self._connection() as db:
            self._purge_expired_working(db, timestamp)
            row = db.execute(
                "SELECT id, kind, content, provenance, sensitivity, created_at, updated_at, identity_key, related_ids " 
                "FROM memories WHERE id = ? AND identity_key = ?", (record_id, key)
            ).fetchone()
            if row is None:
                return None
            current = _record(row)
            categories: tuple[str, ...] = ()
            new_content, new_provenance = current.content, current.provenance
            if content is not None:
                new_content, content_cats = _clean_redacted(content, MAX_CONTENT_CHARS)
                categories += content_cats
            if provenance is not None:
                new_provenance, provenance_cats = _clean_redacted(provenance, MAX_PROVENANCE_CHARS)
                categories += provenance_cats
            categories = tuple(sorted(set(categories)))
            new_sensitivity = current.sensitivity if sensitivity is None else sensitivity
            if new_sensitivity not in _SENSITIVITY_VALUES:
                raise ValueError("Unsupported memory sensitivity")
            # Never lower: a record whose text was redacted (now, or when it was first written, which
            # leaves a placeholder behind) stays sensitive. ASSUMPTION: a placeholder in the stored
            # text is the only trace of an earlier redaction, so it is treated as one.
            if categories or has_placeholder(new_content) or has_placeholder(new_provenance):
                new_sensitivity = "sensitive"
            new_related = current.related_ids if related_ids is None else tuple(related_ids)
            if len(new_related) > 20 or any(not isinstance(item, str) or not re.fullmatch(r"[0-9a-f-]{36}", item) for item in new_related):
                raise ValueError("Related memory ids are invalid")
            related_json = json.dumps(list(dict.fromkeys(new_related)), separators=(",", ":"))
            db.execute(
                "UPDATE memories SET content=?, provenance=?, sensitivity=?, updated_at=?, related_ids=? "
                "WHERE id=? AND identity_key=?",
                (new_content, new_provenance, new_sensitivity, timestamp, related_json, record_id, key),
            )
            self._audit(db, key, record_id, "update", new_provenance, timestamp, categories)
        return MemoryRecord(record_id, current.kind, new_content, new_provenance, new_sensitivity,
                            current.created_at, timestamp, tuple(json.loads(related_json)))

    def forget(
        self, scope: str, identity: str, record_id: str, *,
        explicit: bool = False, provenance: str = "explicit user request", now: int | None = None,
    ) -> bool:
        self._explicit(explicit)
        key = _identity_key(scope, identity)
        clean_provenance, _ = _clean_redacted(provenance, MAX_PROVENANCE_CHARS)
        timestamp = int(time.time()) if now is None else now
        with self._connection() as db:
            self._purge_expired_working(db, timestamp)
            cursor = db.execute("DELETE FROM memories WHERE id = ? AND identity_key = ?", (record_id, key))
            if cursor.rowcount == 1:
                self._audit(db, key, record_id, "forget", clean_provenance, timestamp)
                return True
            return False

    def forget_all(self, scope: str, identity: str, *, explicit: bool = False, now: int | None = None) -> int:
        """Delete every record for this identity and return how many. One audit row records the action and
        the count only. Earlier audit rows hold no values (provenance is redacted) and are kept as the trail."""
        self._explicit(explicit)
        key = _identity_key(scope, identity)
        timestamp = int(time.time()) if now is None else now
        with self._connection() as db:
            self._purge_expired_working(db, timestamp)
            count = db.execute("DELETE FROM memories WHERE identity_key = ?", (key,)).rowcount
            self._audit(db, key, "*", "forget_all", f"count={count}", timestamp)
        return count

    def audit_events(self, scope: str, identity: str, *, limit: int = 100) -> list[dict]:
        """Return bounded metadata-only write history for the matching host identity."""
        key = _identity_key(scope, identity)
        if type(limit) is not int or not 1 <= limit <= 500:
            raise ValueError("Invalid audit limit")
        with self._connection() as db:
            self._purge_expired_working(db, int(time.time()))
            rows = db.execute(
                "SELECT record_id, action, provenance, created_at, redacted FROM memory_audit " 
                "WHERE identity_key = ? ORDER BY created_at DESC LIMIT ?", (key, limit)
            ).fetchall()
        return [
            {"record_id": row[0], "action": row[1], "provenance": row[2], "created_at": row[3],
             "redacted": [item for item in row[4].split(",") if item]}
            for row in rows
        ]

    def resurface(
        self, scope: str, identity: str, query: str, *, limit: int = 5, now: int | None = None
    ) -> list[MemoryRecord]:
        """Return relevant, non-sensitive records; this method never emits events or performs actions."""
        return self.recall(scope, identity, query=query, limit=limit, now=now)

    def get_context(self, scope: str, identity: str, *, limit: int = 8) -> str:
        """Return bounded JSON data for the existing ADK instruction context."""
        records = self.recall(scope, identity, limit=limit)
        payload = json.dumps(
            [{"kind": item.kind, "content": item.content, "provenance": item.provenance}
             for item in records],
            ensure_ascii=True, separators=(",", ":"),
        )
        if len(payload) <= MAX_CONTEXT_CHARS:
            return payload
        bounded = []
        for item in records:
            candidate = bounded + [{"kind": item.kind, "content": item.content, "provenance": item.provenance}]
            encoded = json.dumps(candidate, ensure_ascii=True, separators=(",", ":"))
            if len(encoded) > MAX_CONTEXT_CHARS:
                break
            bounded = candidate
        return json.dumps(bounded, ensure_ascii=True, separators=(",", ":"))
