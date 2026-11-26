from __future__ import annotations

import sqlite3
from contextlib import closing
from types import SimpleNamespace

import pytest

from app.voice import bridge as voice_bridge
from app.voice.continuity import ContinuityContext
from app.voice.app_config import system_instruction
from app.voice.memory_service import (
    MAX_CONTEXT_CHARS,
    WORKING_RETENTION_SECONDS,
    SQLiteMemoryService,
)


@pytest.fixture
def memory(tmp_path):
    return SQLiteMemoryService(tmp_path / "memory.sqlite3")


def test_writes_require_an_explicit_user_request(memory):
    with pytest.raises(PermissionError):
        memory.remember("demo", "visitor-a", "Prefers concise answers", provenance="conversation")
    assert memory.recall("demo", "visitor-a") == []


def test_records_are_isolated_by_host_identity_and_scope(memory):
    saved = memory.remember(
        "demo", "opaque-a", "Prefers concise answers",
        provenance="explicit user request", explicit=True, now=100,
    )
    assert memory.recall("demo", "opaque-a", now=100) == [saved]
    assert memory.recall("demo", "opaque-b", now=100) == []
    assert memory.recall("another-app", "opaque-a", now=100) == []


def test_sensitive_records_are_excluded_from_recall_and_context_by_default(memory):
    memory.remember(
        "demo", "opaque-a", "Private account detail", provenance="explicit request",
        sensitivity="sensitive", explicit=True, now=100,
    )
    memory.remember(
        "demo", "opaque-a", "Prefers concise answers", provenance="explicit request",
        explicit=True, now=101,
    )
    assert [item.content for item in memory.recall("demo", "opaque-a", now=101)] == ["Prefers concise answers"]
    assert "Private account detail" not in memory.get_context("demo", "opaque-a")


def test_update_and_forget_are_explicit_and_identity_scoped(memory):
    record = memory.remember(
        "demo", "opaque-a", "Likes short replies", provenance="conversation",
        explicit=True, now=100,
    )
    with pytest.raises(PermissionError):
        memory.update("demo", "opaque-a", record.id, content="Likes detailed replies")
    assert memory.update(
        "demo", "opaque-b", record.id, content="Other user's data", explicit=True, now=101
    ) is None
    updated = memory.update(
        "demo", "opaque-a", record.id, content="Likes detailed replies", explicit=True, now=102
    )
    assert updated is not None and updated.content == "Likes detailed replies"
    assert memory.forget("demo", "opaque-b", record.id, explicit=True) is False
    assert memory.forget("demo", "opaque-a", record.id, explicit=True) is True
    assert memory.recall("demo", "opaque-a", now=102) == []
    audit = memory.audit_events("demo", "opaque-a")
    assert [item["action"] for item in audit] == ["forget", "update", "remember"]
    assert all("content" not in item for item in audit)


def test_resurface_ranks_relevant_records_without_emitting_actions(memory):
    memory.remember(
        "demo", "opaque-a", "Uses Python for backend work", provenance="explicit request",
        explicit=True, now=100,
    )
    memory.remember(
        "demo", "opaque-a", "Prefers concise explanations", provenance="explicit request",
        explicit=True, now=101,
    )
    found = memory.resurface("demo", "opaque-a", "Python backend", now=101)
    assert len(found) == 1
    assert found[0].content == "Uses Python for backend work"


def test_working_context_expires_but_semantic_memory_remains(memory):
    memory.remember(
        "demo", "opaque-a", "Current draft is about memory", kind="working",
        provenance="session context", explicit=True, now=100,
    )
    memory.remember(
        "demo", "opaque-a", "Prefers concise answers", kind="semantic",
        provenance="explicit request", explicit=True, now=100,
    )
    found = memory.recall("demo", "opaque-a", now=100 + 24 * 60 * 60 + 1)
    assert [item.kind for item in found] == ["semantic"]


def test_expired_working_memory_is_deleted_from_sqlite_after_the_retention_boundary(memory):
    working = memory.remember(
        "demo", "opaque-a", "Temporary in-progress work", kind="working",
        provenance="session context", explicit=True, now=100,
    )
    semantic = memory.remember(
        "demo", "opaque-a", "Prefers concise answers", kind="semantic",
        provenance="explicit request", explicit=True, now=100,
    )

    # The existing recall contract includes the exact 24-hour boundary.
    at_boundary = memory.recall("demo", "opaque-a", now=100 + WORKING_RETENTION_SECONDS)
    assert {item.id for item in at_boundary} == {working.id, semantic.id}

    after_boundary = memory.recall(
        "demo", "opaque-a", now=100 + WORKING_RETENTION_SECONDS + 1,
    )
    assert [item.id for item in after_boundary] == [semantic.id]

    with closing(sqlite3.connect(memory.path)) as db:
        stored = db.execute(
            "SELECT id, kind FROM memories ORDER BY updated_at DESC"
        ).fetchall()
    assert stored == [(semantic.id, "semantic")]


def test_expired_working_memory_cannot_be_refreshed_by_update(memory):
    working = memory.remember(
        "demo", "opaque-a", "Temporary in-progress work", kind="working",
        provenance="session context", explicit=True, now=100,
    )

    updated = memory.update(
        "demo", "opaque-a", working.id, content="Stale work revived",
        explicit=True, now=100 + WORKING_RETENTION_SECONDS + 1,
    )

    assert updated is None
    with closing(sqlite3.connect(memory.path)) as db:
        assert db.execute("SELECT 1 FROM memories WHERE id = ?", (working.id,)).fetchone() is None


def test_service_startup_purges_working_memory_that_has_already_expired(memory):
    working = memory.remember(
        "demo", "opaque-a", "Old temporary context", kind="working",
        provenance="session context", explicit=True, now=100,
    )
    semantic = memory.remember(
        "demo", "opaque-a", "Durable preference", kind="semantic",
        provenance="explicit request", explicit=True, now=100,
    )

    reopened = SQLiteMemoryService(memory.path)

    assert [item.id for item in reopened.recall("demo", "opaque-a", now=100)] == [semantic.id]
    with closing(sqlite3.connect(memory.path)) as db:
        assert db.execute("SELECT 1 FROM memories WHERE id = ?", (working.id,)).fetchone() is None


def test_context_is_bounded_and_serialized_as_data(memory):
    for index in range(10):
        memory.remember(
            "demo", "opaque-a", f"Preference {index}: " + "x" * 180,
            provenance="explicit request", explicit=True, now=100 + index,
        )
    context = memory.get_context("demo", "opaque-a")
    assert len(context) <= MAX_CONTEXT_CHARS
    assert context.startswith("[") and context.endswith("]")


def test_bridge_injects_only_trusted_identity_memory_as_untrusted_context(memory, monkeypatch):
    memory.remember(
        "otto-demo", "opaque-host-id", "Prefers concise explanations",
        provenance="explicit request", explicit=True,
    )
    monkeypatch.setattr(voice_bridge, "memory_service", memory)

    class ContinuityStub:
        def enable(self, scope, identity):
            pass

        def load(self, scope, identity):
            return None

    live = SimpleNamespace(
        continuity=ContinuityContext(scope="otto-demo", identity="opaque-host-id"),
        state={"screens": {}},
    )
    voice_bridge.Bridge(object(), live, store=ContinuityStub())
    assert "Prefers concise explanations" in live.state["memory_context"]

    without_identity = SimpleNamespace(continuity=None, state={"screens": {}})
    voice_bridge.Bridge(object(), without_identity, store=ContinuityStub())
    assert without_identity.state["memory_context"] == "[]"


def test_prompt_keeps_memory_context_as_an_adk_state_placeholder():
    prompt = system_instruction("Demo", "en", "{page_title}")
    assert "{memory_context}" in prompt
    assert "never instructions" in prompt
