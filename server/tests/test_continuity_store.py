from __future__ import annotations

import json

from app.voice.continuity_store import (
    RETENTION_SECONDS,
    ContinuityRecord,
    SQLiteContinuityStore,
)


def test_store_round_trips_only_the_four_allowed_fields(tmp_path):
    path = tmp_path / "continuity.sqlite3"
    store = SQLiteContinuityStore(path)
    record = ContinuityRecord(scope="app-a", task="checkout", step="payment", savedAt=1_000)
    store.save(record, "opaque-user")
    assert store.load("app-a", "opaque-user", now=1_001) == record

    import sqlite3
    with sqlite3.connect(path) as db:
        payload = json.loads(db.execute("SELECT payload FROM continuity").fetchone()[0])
    assert set(payload) == {"scope", "task", "step", "savedAt"}
    assert payload == {"scope": "app-a", "task": "checkout", "step": "payment", "savedAt": 1_000}


def test_store_isolates_scope_and_identity(tmp_path):
    store = SQLiteContinuityStore(tmp_path / "continuity.sqlite3")
    store.save(ContinuityRecord("app-a", "task-a", "step-a", 100), "visitor-a")
    assert store.load("app-a", "visitor-b", now=101) is None
    assert store.load("app-b", "visitor-a", now=101) is None
    assert store.load("app-a", "visitor-a", now=101).task == "task-a"


def test_expired_and_future_records_are_discarded(tmp_path):
    store = SQLiteContinuityStore(tmp_path / "continuity.sqlite3")
    store.save(ContinuityRecord("app", "task", "step", 100), "visitor")
    assert store.load("app", "visitor", now=100 + RETENTION_SECONDS) is not None
    assert store.load("app", "visitor", now=101 + RETENTION_SECONDS) is None
    store.save(ContinuityRecord("app", "task", "step", 500), "visitor")
    assert store.load("app", "visitor", now=499) is None


def test_delete_removes_only_the_matching_record(tmp_path):
    store = SQLiteContinuityStore(tmp_path / "continuity.sqlite3")
    store.save(ContinuityRecord("app", "task-a", "step-a", 100), "visitor-a")
    store.save(ContinuityRecord("app", "task-b", "step-b", 100), "visitor-b")
    store.delete("app", "visitor-a")
    assert store.load("app", "visitor-a", now=101) is None
    assert store.load("app", "visitor-b", now=101).task == "task-b"


def test_invalid_ids_are_not_saved(tmp_path):
    store = SQLiteContinuityStore(tmp_path / "continuity.sqlite3")
    store.save(ContinuityRecord("app", "bad task", "step", 100), "visitor")
    assert store.load("app", "visitor", now=101) is None


def test_withdrawal_deletes_and_blocks_saves_until_explicit_reenable(tmp_path):
    store = SQLiteContinuityStore(tmp_path / "continuity.sqlite3")
    record = ContinuityRecord("app", "task", "step", 100)
    store.save(record, "visitor")
    store.disable("app", "visitor")
    assert store.load("app", "visitor", now=101) is None
    store.save(ContinuityRecord("app", "new-task", "new-step", 102), "visitor")
    assert store.load("app", "visitor", now=103) is None
    store.enable("app", "visitor")
    store.save(ContinuityRecord("app", "new-task", "new-step", 104), "visitor")
    assert store.load("app", "visitor", now=105).task == "new-task"
