"""The task engine (TASK-01, #49): lifecycle, bounds, cancellation, honesty about failure, and the session seams.

Every test drives the engine with real asyncio and events, never with wall-clock waits: a worker blocks on an `asyncio.Event`
the test sets, and retry backoff goes through an injected `sleep`.
"""
from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import settings
from app.main import app
from app.voice import bridge as bridge_module, route, tasks
from app.voice.avatar import AVATAR_KINDS, clean_avatar_event
from app.voice.bridge import Bridge
from app.voice.tasks import MAX_ACTIVE, MAX_KEPT, MAX_RETRIES, MAX_RUNNING, MAX_TIMEOUT, RetryableError, TaskEngine
from tests.test_voice import FakeLive, _receive_until_ended


def run(coro):
    return asyncio.run(coro)


async def settle(times: int = 5) -> None:
    for _ in range(times):
        await asyncio.sleep(0)


class Gate:
    """A worker that stays running until the test opens it."""

    def __init__(self, result: str | None = "done") -> None:
        self.open = asyncio.Event()
        self.started = asyncio.Event()
        self.result = result

    async def __call__(self, ctx):
        self.started.set()
        await self.open.wait()
        return self.result


def engine() -> tuple[TaskEngine, list[dict]]:
    events: list[dict] = []
    return TaskEngine(emit=events.append), events


# ---- the lifecycle ----

def test_a_task_runs_beside_the_caller_and_completes_with_a_bounded_result():
    async def go():
        eng, events = engine()
        gate = Gate("x" * 900 + "\n second line")
        sub = eng.submit("Build the report", gate)
        assert sub.ok and sub.task_id == "task-1"
        assert eng.get("task-1").state == "running"  # submit returned without waiting for the work
        await gate.started.wait()
        gate.open.set()
        await settle()
        return eng.get("task-1"), events

    snap, events = run(go())
    assert snap.state == "completed" and snap.progress == 1.0 and snap.reason is None
    assert len(snap.result) == tasks.RESULT_CHARS and "\n" not in snap.result
    assert events == [
        {"kind": "working", "id": "task-1", "topic": "Build the report"},
        {"kind": "success", "id": "task-1", "topic": "Build the report"},
    ]


def test_a_long_task_never_blocks_the_loop_the_voice_session_runs_on():
    async def go():
        eng, _ = engine()
        gate = Gate()
        eng.submit("Slow", gate)
        ticks = 0
        for _ in range(50):  # the "voice loop": keeps turning while the task is stuck running
            ticks += 1
            await asyncio.sleep(0)
        still_running = eng.get("task-1").state == "running"
        await eng.close()
        return ticks, still_running

    assert run(go()) == (50, True)


def test_progress_and_waiting_are_visible_and_clamped_and_waiting_keeps_its_slot():
    async def go():
        eng, events = engine()
        seen = []
        resume, parked = asyncio.Event(), asyncio.Event()

        async def worker(ctx):
            ctx.progress(0.4, "Half\nway")
            ctx.progress(float("nan"), "ignored number")
            ctx.progress(7)
            seen.append(eng.get("task-1"))
            ctx.waiting("Needs a visitor")
            parked.set()
            await resume.wait()
            ctx.progress(0.5)
            return "ok"

        eng.submit("Parked", worker)
        await parked.wait()
        waiting = eng.get("task-1")
        # A waiting task still holds one of the MAX_RUNNING slots.
        eng.submit("Second", Gate())
        eng.submit("Third", Gate())
        third = eng.get("task-3").state
        resume.set()
        await settle()
        return seen[0], waiting, third, eng.get("task-1"), events

    first, waiting, third, final, events = run(go())
    assert (first.progress, first.note) == (1.0, "ignored number")  # clamped; NaN left it as it was
    assert (waiting.state, waiting.note) == ("waiting", "Needs a visitor")
    assert third == "queued"
    assert final.state == "completed"
    assert [e["kind"] for e in events if e["id"] == "task-1"] == ["working", "success"]  # no event for progress or waiting


def test_an_illegal_transition_is_refused_by_the_table():
    eng, _ = engine()
    run(eng.close())
    record = tasks._Record("t", "T", lambda c: None, None, 1.0, 0, 0.0, True)  # type: ignore[arg-type]
    record.state = "completed"
    with pytest.raises(ValueError):
        eng._transition(record, "running")
    assert all(not tasks.TRANSITIONS[state] for state in tasks.TERMINAL)
    assert set(tasks.TRANSITIONS) == {"created", "queued", "running", "waiting", "verifying", "completed", "failed", "cancelled"}


# ---- bounds ----

def test_only_max_running_run_at_once_and_the_rest_start_in_order_as_slots_free():
    async def go():
        eng, _ = engine()
        gates = [Gate() for _ in range(MAX_ACTIVE)]
        for i, gate in enumerate(gates):
            eng.submit(f"job {i}", gate)
        before = [eng.get(f"task-{i + 1}").state for i in range(MAX_ACTIVE)]
        gates[0].open.set()
        await settle()
        after = [eng.get(f"task-{i + 1}").state for i in range(MAX_ACTIVE)]
        await eng.close()
        return before, after

    before, after = run(go())
    assert before == ["running"] * MAX_RUNNING + ["queued"] * (MAX_ACTIVE - MAX_RUNNING)
    assert after[:3] == ["completed", "running", "running"] and after[3:] == ["queued"] * (MAX_ACTIVE - 3)


def test_more_than_max_active_unfinished_tasks_are_refused_not_dropped_silently():
    async def go():
        eng, _ = engine()
        gates = [Gate() for _ in range(MAX_ACTIVE)]
        subs = [eng.submit("j", g) for g in gates]
        extra = eng.submit("one more", Gate())
        gates[0].open.set()
        await settle()
        again = eng.submit("fits now", Gate())
        await eng.close()
        return subs, extra, again

    subs, extra, again = run(go())
    assert all(s.ok for s in subs)
    assert (extra.ok, extra.rejected) == (False, "busy")
    assert again.ok


def test_bad_arguments_are_rejected_and_the_numbers_are_capped():
    async def go():
        eng, _ = engine()
        bad = [
            eng.submit("t", "not callable"),  # type: ignore[arg-type]
            eng.submit("t", Gate(), timeout=float("nan")),
            eng.submit("t", Gate(), timeout=True),  # type: ignore[arg-type]
            eng.submit("t", Gate(), backoff="1"),  # type: ignore[arg-type]
            eng.submit("t", Gate(), verify="nope"),  # type: ignore[arg-type]
        ]
        ok = eng.submit("  <b>Title</b>\n\x07  ", Gate(), timeout=10_000, retries=99, backoff=999)
        record = eng._records[ok.task_id]
        values = (record.timeout, record.retries, record.backoff, record.title)
        await eng.close()
        return bad, values

    bad, values = run(go())
    assert [s.rejected for s in bad] == ["invalid"] * 5
    assert values == (MAX_TIMEOUT, MAX_RETRIES, tasks.MAX_BACKOFF, "<b>Title</b>")  # text stays text; D-18 keeps it from being markup


def test_finished_tasks_are_kept_only_up_to_the_limit():
    async def go():
        eng, _ = engine()

        async def quick(ctx):
            return "r"

        for _ in range(MAX_KEPT + 7):
            eng.submit("q", quick)
            await settle()
        return eng.snapshots(), eng.get("task-1"), eng.get(f"task-{MAX_KEPT + 7}")

    snaps, oldest, newest = run(go())
    assert len(snaps) == MAX_KEPT and oldest is None and newest.state == "completed"


# ---- retry, timeout, failure ----

def test_a_retryable_failure_is_tried_again_with_backoff_up_to_the_limit():
    async def go():
        slept: list[float] = []

        async def fake_sleep(seconds):
            slept.append(seconds)

        eng = TaskEngine(sleep=fake_sleep)
        calls = []

        async def flaky(ctx):
            calls.append(1)
            if len(calls) < 3:
                raise RetryableError("the service blinked")
            return "third time"

        eng.submit("Flaky", flaky, retries=2, backoff=0.5)
        await settle(10)
        return eng.get("task-1"), slept

    snap, slept = run(go())
    assert (snap.state, snap.attempts, snap.result) == ("completed", 3, "third time")
    assert slept == [0.5, 0.5]


def test_retries_run_out_and_other_errors_are_not_retried_and_their_text_never_escapes():
    async def go():
        async def no_sleep(seconds):
            return None

        events: list[dict] = []
        eng = TaskEngine(emit=events.append, sleep=no_sleep)
        n = {"retry": 0, "boom": 0}

        async def always_retry(ctx):
            n["retry"] += 1
            raise RetryableError("key=sk-secret-1")

        async def boom(ctx):
            n["boom"] += 1
            raise RuntimeError("key=sk-secret-2")

        eng.submit("Retry", always_retry, retries=1)
        eng.submit("Boom", boom, retries=5)
        await settle(10)
        return n, eng.snapshots(), events

    n, snaps, events = run(go())
    assert n == {"retry": 2, "boom": 1}
    assert [(s.state, s.reason) for s in snaps] == [("failed", "error"), ("failed", "error")]
    assert "sk-secret" not in repr(snaps) + repr(events)
    assert {e["message"] for e in events if e["kind"] == "failure"} == {"Something went wrong."}


def test_a_timeout_fails_the_task_and_is_never_retried():
    async def go():
        eng, events = engine()
        calls = []

        async def stuck(ctx):
            calls.append(1)
            await asyncio.Event().wait()

        eng.submit("Stuck", stuck, timeout=0.01, retries=2)
        for _ in range(100):
            if eng.get("task-1").state == "failed":
                break
            await asyncio.sleep(0.01)
        return eng.get("task-1"), calls, events

    snap, calls, events = run(go())
    assert (snap.state, snap.reason, snap.attempts) == ("failed", "timeout", 1) and calls == [1]
    assert events[-1] == {"kind": "failure", "id": "task-1", "topic": "Stuck", "message": "It took too long."}


def test_a_task_is_completed_only_when_its_check_returns_true():
    async def go():
        eng, events = engine()

        async def work(ctx):
            return "made it"

        async def yes(result):
            return result == "made it"

        async def no(result):
            return False

        async def truthy_but_not_true(result):
            return "yes"

        async def raises(result):
            raise RuntimeError("checker down")

        for verify in (yes, no, truthy_but_not_true, raises):
            eng.submit("v", work, verify=verify)
            await settle()
        return [(s.state, s.reason) for s in eng.snapshots()], events

    states, events = run(go())
    assert states == [("completed", None)] + [("failed", "verification_failed")] * 3
    assert [e["kind"] for e in events].count("success") == 1
    assert {e["message"] for e in events if e["kind"] == "failure"} == {"I could not confirm it worked."}


def test_a_task_that_fails_while_waiting_ends_failed():
    async def go():
        eng, _ = engine()

        async def worker(ctx):
            ctx.waiting("for a person")
            raise RuntimeError("gave up")

        eng.submit("W", worker)
        await settle()
        return eng.get("task-1")

    snap = run(go())
    assert (snap.state, snap.reason) == ("failed", "error")


# ---- cancellation and shutdown ----

def test_cancel_stops_a_running_task_at_once_and_starts_the_next_queued_one():
    async def go():
        eng, events = engine()
        a, b, c = Gate(), Gate(), Gate()
        for g in (a, b, c):
            eng.submit("j", g)
        await a.started.wait()
        outcome = eng.cancel("task-1")
        await settle()
        return outcome, [eng.get(f"task-{i}").state for i in (1, 2, 3)], events, eng.cancel("task-1"), eng.cancel("task-99")

    outcome, states, events, again, missing = run(go())
    assert outcome == "cancelled" and states == ["cancelled", "running", "running"]
    assert again == "already_finished" and missing == "not_found"
    assert {"kind": "failure", "id": "task-1", "topic": "j", "message": "Cancelled."} in events


def test_a_task_cancelled_before_it_ever_ran_says_nothing_to_otto_and_never_runs():
    async def go():
        eng, events = engine()
        started = []

        async def late(ctx):
            started.append(1)

        eng.submit("a", Gate())
        eng.submit("b", Gate())
        eng.submit("queued", late)
        outcome = eng.cancel("task-3")
        await eng.close()
        return outcome, started, [e for e in events if e.get("id") == "task-3"], eng.get("task-3").state

    outcome, started, said, state = run(go())
    assert (outcome, started, said, state) == ("cancelled", [], [], "cancelled")


def test_a_task_that_is_not_safe_to_cancel_refuses_the_visitor_but_not_the_session_ending():
    async def go():
        eng, _ = engine()
        gate = Gate()
        eng.submit("Payment", gate, cancellable=False)
        await gate.started.wait()
        refused = eng.cancel("task-1")
        state_after_refusal = eng.get("task-1").state
        await eng.close()
        return refused, state_after_refusal, eng.get("task-1").state

    assert run(go()) == ("not_cancellable", "running", "cancelled")


def test_close_cancels_and_awaits_everything_sends_nothing_and_accepts_nothing_more():
    async def go():
        eng, events = engine()
        gates = [Gate() for _ in range(MAX_ACTIVE)]
        for g in gates:
            eng.submit("j", g)
        await gates[0].started.wait()
        runners = [r.runner for r in eng._records.values() if r.runner]
        sent_before = len(events)
        await eng.close()
        await eng.close()  # idempotent
        return (
            [s.state for s in eng.snapshots()], [r.done() for r in runners], len(events) - sent_before,
            eng.submit("late", Gate()).rejected, len(asyncio.all_tasks()),
        )

    states, done, new_events, late, live_tasks = run(go())
    assert states == ["cancelled"] * MAX_ACTIVE and all(done)
    assert new_events == 0 and late == "closed"
    assert live_tasks == 1  # only the test's own coroutine is left


def test_a_failing_emit_cannot_stop_the_work():
    async def go():
        def broken(event):
            raise RuntimeError("socket gone")

        eng = TaskEngine(emit=broken)

        async def work(ctx):
            return "fine"

        eng.submit("t", work)
        await settle()
        return eng.get("task-1")

    assert run(go()).state == "completed"


# ---- the seams: the bridge, the route, the browser's own check ----

class _Socket:
    def __init__(self) -> None:
        self.sent: list = []

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)

    async def send_bytes(self, data: bytes) -> None:
        self.sent.append(data)


def test_what_the_engine_tells_otto_goes_through_bridge_avatar_and_survives_its_check_unchanged():
    async def go():
        ws = _Socket()
        bridge = Bridge(ws, FakeLive())  # type: ignore[arg-type]
        pump = asyncio.create_task(bridge.output_pump())

        async def work(ctx):
            return "ok"

        async def broken(ctx):
            raise RuntimeError("x")

        gate = Gate()
        bridge.tasks.submit("Report", work)
        bridge.tasks.submit("Broken", broken)
        bridge.tasks.submit("Cancelled one", gate)
        await settle()
        bridge.tasks.cancel("task-3")
        await settle()
        await bridge.out.flush()
        pump.cancel()
        await bridge.tasks.close()
        return ws.sent

    sent = run(go())
    assert [m["type"] for m in sent] == ["avatar"] * len(sent) and sent
    for message in sent:
        event = message["event"]
        assert event["kind"] in AVATAR_KINDS
        assert clean_avatar_event(event) == event  # nothing the browser's identical check would trim or refuse
    assert {m["event"]["kind"] for m in sent} == {"working", "success", "failure"}


def test_the_route_closes_the_engine_when_the_session_ends(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", SecretStr("test-key"))
    seen: dict = {}

    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_connect(language, page, page_title, detail):
        live = FakeLive()
        try:
            yield live
        finally:
            live.close()

    real_bridge = bridge_module.Bridge

    def bridge_with_a_task(ws, live, *args, **kwargs):
        bridge = real_bridge(ws, live, *args, **kwargs)
        gate = Gate()
        bridge.tasks.submit("Still going", gate)
        seen["bridge"] = bridge
        return bridge

    monkeypatch.setattr(route, "connect_adk", fake_connect)
    monkeypatch.setattr(bridge_module, "Bridge", bridge_with_a_task)
    with TestClient(app).websocket_connect("/api/v1/voice/live") as ws:
        ws.send_json({"type": "start", "language": "en", "page": "home"})
        assert ws.receive_json()["type"] == "ready"
        _receive_until_ended(ws)
    snap = seen["bridge"].tasks.get("task-1")
    assert snap.state == "cancelled"
    assert seen["bridge"].tasks.submit("after", Gate()).rejected == "closed"
