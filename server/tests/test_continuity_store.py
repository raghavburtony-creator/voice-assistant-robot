from __future__ import annotations

import json
import time

from types import SimpleNamespace

from app.voice.bridge import Bridge, _set_page, _task_specs
from app.voice.continuity import ContinuityContext
from app.voice.continuity_store import (
    RETENTION_SECONDS,
    ContinuityRecord,
    SQLiteContinuityStore,
)


class FakeContinuityStore:
    """Small in-memory implementation of the continuity-store contract for bridge tests."""

    def __init__(self):
        self.records = {}
        self.disabled = set()

    def load(self, scope, identity, *, now=None):
        record = self.records.get((scope, identity))
        if record is None or (scope, identity) in self.disabled:
            return None
        current = int(time.time()) if now is None else now
        return record if 0 <= current - record.savedAt <= RETENTION_SECONDS else None

    def save(self, record, identity):
        key = (record.scope, identity)
        if key not in self.disabled:
            self.records[key] = record

    def delete(self, scope, identity):
        self.records.pop((scope, identity), None)

    def disable(self, scope, identity):
        self.delete(scope, identity)
        self.disabled.add((scope, identity))

    def enable(self, scope, identity):
        self.disabled.discard((scope, identity))


def test_task_specs_unwraps_browser_task_registry_envelope():
    tasks = [{"id": "checkout", "stepIds": ["details", "payment"]}]
    assert _task_specs({"tasks": tasks}) == tasks


def test_task_specs_rejects_invalid_or_legacy_bare_list_payloads():
    assert _task_specs([{"id": "checkout"}]) is None
    assert _task_specs({"tasks": None}) is None
    assert _task_specs(None) is None


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


def test_fake_store_implements_the_narrow_store_contract():
    store = FakeContinuityStore()
    record = ContinuityRecord("app", "task", "step", 100)
    store.save(record, "visitor")
    assert store.load("app", "visitor", now=101) == record
    store.delete("app", "visitor")
    assert store.load("app", "visitor", now=101) is None


def _bridge_for_null_update(store, state):
    bridge = object.__new__(Bridge)
    bridge.live = SimpleNamespace(
        state=state,
        continuity=ContinuityContext(scope="app", identity="visitor"),
    )
    bridge.continuity_store = store
    bridge.continuity_withdrawn = False
    bridge.seen_running_task = True
    bridge.pending_continuity = None
    return bridge


def _bridge_for_resume(store, record):
    actions = []
    bridge = object.__new__(Bridge)
    bridge.live = SimpleNamespace(
        state={"screens": {}},
        continuity=ContinuityContext(scope="app", identity="visitor"),
    )
    bridge.continuity_store = store
    bridge.pending_continuity = record
    bridge.continuity_resumed = False
    bridge.out = SimpleNamespace(control=actions.append)
    return bridge, actions


def test_source_unmount_preserves_saved_task_once_during_navigation_handoff():
    store = FakeContinuityStore()
    record = ContinuityRecord("app", "checkout", "payment", 100)
    store.save(record, "visitor")
    state = {"continuity_handoff": True}
    bridge = _bridge_for_null_update(store, state)

    bridge._persist_running_task(None)

    assert store.load("app", "visitor", now=101) == record
    assert "continuity_handoff" not in state
    assert bridge.seen_running_task is False


def test_normal_task_completion_still_deletes_saved_task_without_handoff():
    store = FakeContinuityStore()
    store.save(ContinuityRecord("app", "checkout", "payment", 100), "visitor")
    bridge = _bridge_for_null_update(store, {})

    bridge._persist_running_task(None)

    assert store.load("app", "visitor", now=101) is None


def test_new_task_progress_closes_handoff_window_and_saves_current_step():
    store = FakeContinuityStore()
    state = {
        "continuity_handoff": True,
        "screens": {"guide_tasks": {"tasks": [
            {"id": "checkout", "stepIds": ["details", "payment"]},
        ]}},
    }
    bridge = _bridge_for_null_update(store, state)

    bridge._persist_running_task({"id": "checkout", "stepId": "payment"})

    assert "continuity_handoff" not in state
    assert store.load("app", "visitor").task == "checkout"
    assert store.load("app", "visitor").step == "payment"


def test_page_change_invalidates_only_the_previous_page_registries():
    state = {"screens": {
        "destinations": {"destinations": [{"id": "project.42", "label": "Project"}]},
        "guide_targets": {"targets": [{"id": "save"}]},
        "guide_tasks": {"tasks": [{"id": "checkout"}]},
        "guide_task_running": {"id": "checkout", "stepId": "payment"},
        "app_tasks": {"running": [{"id": "upload"}]},
    }}
    _set_page(state, "project.42", "Project")

    assert state["screens"]["destinations"] is None
    assert state["screens"]["guide_targets"] is None
    assert state["screens"]["guide_tasks"] is None
    assert state["screens"]["guide_task_running"] == {"id": "checkout", "stepId": "payment"}
    assert state["screens"]["app_tasks"] == {"running": [{"id": "upload"}]}


def test_destination_interface_resumes_only_the_task_and_step_it_reports():
    store = FakeContinuityStore()
    record = ContinuityRecord("app", "checkout", "payment", 100)
    store.save(record, "visitor")
    bridge, actions = _bridge_for_resume(store, record)

    bridge._resume_saved_task({"tasks": [
        {"id": "profile", "stepIds": ["start"]},
        {"id": "checkout", "stepIds": ["details", "payment"]},
    ]})

    assert actions == [{"type": "action", "action": "task_resume", "task": "checkout", "step": "payment"}]
    assert bridge.pending_continuity is None
    assert store.load("app", "visitor", now=101) == record


def test_destination_interface_drops_a_task_or_step_it_does_not_offer():
    for offered in (
        [{"id": "profile", "stepIds": ["start"]}],
        [{"id": "checkout", "stepIds": ["details"]}],
    ):
        store = FakeContinuityStore()
        record = ContinuityRecord("app", "checkout", "payment", 100)
        store.save(record, "visitor")
        bridge, actions = _bridge_for_resume(store, record)

        bridge._resume_saved_task({"tasks": offered})

        assert actions == []
        assert store.load("app", "visitor", now=101) is None


def test_task_cancellation_still_deletes_saved_task_without_handoff():
    store = FakeContinuityStore()
    store.save(ContinuityRecord("app", "checkout", "payment", 100), "visitor")
    bridge = _bridge_for_null_update(store, {})

    # The guide emits the same null running-task update for an explicit stop/cancel.
    bridge._persist_running_task(None)

    assert store.load("app", "visitor", now=101) is None


def test_handoff_marker_and_destination_registry_resume_as_one_flow():
    store = FakeContinuityStore()
    record = ContinuityRecord("app", "checkout", "payment", 100)
    store.save(record, "visitor")

    source = _bridge_for_null_update(store, {"continuity_handoff": True})
    source._persist_running_task(None)
    assert store.load("app", "visitor", now=101) == record

    destination, actions = _bridge_for_resume(store, record)
    destination._resume_saved_task({"tasks": [
        {"id": "checkout", "stepIds": ["details", "payment"]},
    ]})
    assert actions == [{"type": "action", "action": "task_resume", "task": "checkout", "step": "payment"}]
