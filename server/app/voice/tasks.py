"""The task engine (TASK-01, #49): long work that runs beside the live voice session, never inside it.

A *worker* is an async function the server (never the model) hands to `TaskEngine.submit`. The engine runs it as its own
asyncio task, so the voice loop keeps turning while it works, and reports how it is going through `emit`, which the bridge
points at `Bridge.avatar` (avatar.py). That is the existing event path: this module adds no event bus, no tool and no
action route (D-19, D-22), and it imports nothing above it in the chain (`test_architecture.py`).

Lifecycle (`TRANSITIONS` is the only way a state changes):

    created -> queued -> running <-> waiting -> verifying -> completed
                                   \\-> failed        \\-> failed
    any non-terminal state -> cancelled

Bounds, all per session because the bridge owns one engine: `MAX_ACTIVE` unfinished tasks (more are `Rejected("busy")`),
`MAX_RUNNING` at once (the rest wait in a queue, in order), `MAX_RETRIES`, `MAX_TIMEOUT`, and `MAX_KEPT` finished tasks
(their results are dropped after that). A timeout is final and never retried, so a stuck worker cannot loop. A task whose
`verify` does not return exactly `True` is `failed` ("verification_failed"), never `completed` (POL-02's rule: a failed
check is a failure). An exception's text is never stored or sent: it can carry anything.

Priority (`low`, `normal`, `high`): a free slot goes to the highest first; only `high` preempts (`submit`). At most
`MAX_SUBMITTED` tasks per session. Each step is a `TaskEvent` for one listener, the bridge (`on_event`), beside `emit`,
which carries the same steps to Otto's face; neither is a bus, and both go quiet when the engine closes.

Pure asyncio: no FastAPI, no ADK, no I/O of its own.
"""
from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Literal

from app.voice.runtime import is_runtime_id, runtime_title

State = Literal["created", "queued", "running", "waiting", "verifying", "completed", "failed", "cancelled"]
Reason = Literal["error", "timeout", "verification_failed", "cancelled", "preempted"]
Priority = Literal["low", "normal", "high"]
CancelOutcome = Literal["cancelled", "not_found", "already_finished", "not_cancellable"]

TRANSITIONS: dict[str, frozenset[str]] = {
    "created": frozenset({"queued", "cancelled"}),
    "queued": frozenset({"running", "cancelled"}),
    "running": frozenset({"waiting", "verifying", "completed", "failed", "cancelled"}),
    "waiting": frozenset({"running", "failed", "cancelled"}),
    "verifying": frozenset({"completed", "failed", "cancelled"}),
    "completed": frozenset(),
    "failed": frozenset(),
    "cancelled": frozenset(),
}
STATES = frozenset(TRANSITIONS)
TERMINAL = frozenset({"completed", "failed", "cancelled"})
REASONS = frozenset({"error", "timeout", "verification_failed", "cancelled", "preempted"})
#: Higher wins a free slot first; only "high" may push out lower-priority work (see `submit`).
RANK: dict[str, int] = {"low": 0, "normal": 1, "high": 2}
#: States that hold a running slot.
_RUNNING = frozenset({"running", "waiting", "verifying"})

MAX_ACTIVE = 4
MAX_RUNNING = 2
MAX_KEPT = 20
#: Tasks one session may ever submit: a bound on churn, since a session is billed by the minute (D-04).
MAX_SUBMITTED = 100
MAX_RETRIES = 2
DEFAULT_TIMEOUT = 30.0
MAX_TIMEOUT = 300.0
MAX_BACKOFF = 10.0
#: How long `close` waits for cancelled workers before it gives up on one that will not stop.
CLOSE_TIMEOUT = 5.0
RESULT_CHARS = 500
NOTE_CHARS = 140

#: What Otto shows when a task ends badly. Fixed text: nothing a worker or an exception says reaches the visitor.
_FAILURE_MESSAGES = {
    "error": "Something went wrong.",
    "timeout": "It took too long.",
    "verification_failed": "I could not confirm it worked.",
    "cancelled": "Cancelled.",
    "preempted": "Stopped to make room.",
}


class RetryableError(Exception):
    """A worker raises this for a failure worth another attempt (at most `retries`, itself capped at MAX_RETRIES)."""


@dataclass(frozen=True)
class TaskSnapshot:
    """What anyone outside the engine may see of a task. Immutable, so nothing can change a task through it."""
    id: str
    title: str
    state: State
    progress: float
    note: str | None
    result: str | None
    reason: Reason | None
    attempts: int
    priority: Priority = "normal"


@dataclass(frozen=True)
class TaskEvent:
    """One typed step in a task's life, for whoever owns the engine (the bridge).

    Only a completed task carries its bounded result. The result and server-set title are
    untrusted text; notes and exception details never travel in an event.
    """
    id: str
    title: str
    state: State
    reason: Reason | None
    progress: float
    priority: Priority
    started: bool  # it held a slot at some point, so an ending is news
    result: str | None = None


@dataclass(frozen=True)
class Submission:
    """The result of `submit`: a task id, or why there is none. Never an exception for an expected refusal."""
    task_id: str | None = None
    rejected: Literal["busy", "closed", "invalid", "limit"] | None = None

    @property
    def ok(self) -> bool:
        return self.task_id is not None


Worker = Callable[["TaskContext"], Awaitable["str | None"]]
Verifier = Callable[["str | None"], Awaitable[bool]]


class TaskContext:
    """What a worker may do to its own task: report progress, or say it is waiting on something. Nothing else."""

    def __init__(self, engine: "TaskEngine", record: "_Record") -> None:
        self._engine = engine
        self._record = record

    def progress(self, fraction: float, note: str | None = None) -> None:
        """0 to 1 (clamped; a non-number is ignored). Moves a waiting task back to running."""
        self._engine._progress(self._record, fraction, note)

    def waiting(self, note: str | None = None) -> None:
        """The task is waiting on something outside itself (a person, a service). It still holds its slot."""
        self._engine._wait_on(self._record, note)


@dataclass
class _Record:
    id: str
    title: str
    worker: Worker
    verify: Verifier | None
    timeout: float
    retries: int
    backoff: float
    cancellable: bool
    priority: Priority = "normal"
    seq: int = 0
    state: State = "created"
    progress: float = 0.0
    note: str | None = None
    result: str | None = None
    reason: Reason | None = None
    attempts: int = 0
    runner: asyncio.Task | None = None
    started: bool = False  # it has held a slot, so `working` was sent and an ending must be sent too

    def snapshot(self) -> TaskSnapshot:
        return TaskSnapshot(self.id, self.title, self.state, self.progress, self.note, self.result, self.reason, self.attempts, self.priority)


def _clip(value: object, limit: int) -> str | None:
    """Plain single-line text, capped; None when nothing is left (D-18: a result is text, never markup)."""
    if not isinstance(value, str):
        return None
    return " ".join(value.split())[:limit].strip() or None


class TaskEngine:
    def __init__(
        self,
        emit: Callable[[dict], Any] | None = None,
        *,
        on_event: Callable[[TaskEvent], Any] | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._emit = emit
        self._on_event = on_event
        self._sleep = sleep
        self._records: dict[str, _Record] = {}
        self._queue: list[str] = []
        self._count = 0
        self._closed = False
        self._runners: set[asyncio.Task] = set()  # kept apart from the records, so eviction cannot hide one from `close`

    # ---- starting and stopping ----

    def submit(
        self,
        title: str,
        worker: Worker,
        *,
        verify: Verifier | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        retries: int = 0,
        backoff: float = 1.0,
        cancellable: bool = True,
        priority: Priority = "normal",
    ) -> Submission:
        """Queues `worker` and returns at once; it never waits for the work. Call from the running event loop.

        A `high` task that finds the session full (every slot, or every unfinished-task place, taken) cancels the lowest
        lower-priority running task that may be cancelled, with the reason "preempted", rather than waiting behind it or being
        refused. Nothing else preempts: `normal` and `low` wait their turn."""
        if self._closed:
            return Submission(rejected="closed")
        if (not callable(worker) or (verify is not None and not callable(verify)) or not self._number(timeout)
                or not self._number(backoff) or priority not in RANK):
            return Submission(rejected="invalid")
        if self._count >= MAX_SUBMITTED:
            return Submission(rejected="limit")
        rank = RANK[priority]
        if sum(1 for r in self._records.values() if r.state not in TERMINAL) >= MAX_ACTIVE:
            # More unfinished tasks than slots means every slot is taken, so the one victim must be a running task: it
            # frees a place and a slot together.
            if rank < RANK["high"] or not self._preempt(rank):
                return Submission(rejected="busy")
        self._count += 1
        record = _Record(
            id=f"task-{self._count}",
            title=runtime_title(title, "Task"),
            worker=worker,
            verify=verify,
            timeout=min(max(float(timeout), 0.001), MAX_TIMEOUT),
            retries=retries if type(retries) is int and retries > 0 else 0,
            backoff=min(max(float(backoff), 0.0), MAX_BACKOFF),
            cancellable=bool(cancellable),
            priority=priority,
            seq=self._count,
        )
        record.retries = min(record.retries, MAX_RETRIES)
        self._records[record.id] = record
        self._transition(record, "queued")
        self._queue.append(record.id)
        if rank == RANK["high"] and self._free_slots() == 0:
            self._preempt(rank)
        self._pump()
        return Submission(task_id=record.id)

    def cancel(self, task_id: str) -> CancelOutcome:
        """Stops a task now. A running task that was submitted `cancellable=False` is refused; a queued one never is."""
        record = self._records.get(task_id)
        if record is None:
            return "not_found"
        if record.state in TERMINAL:
            return "already_finished"
        if record.state != "queued" and not record.cancellable:
            return "not_cancellable"
        self._cancel(record)
        self._pump()
        return "cancelled"

    async def close(self, timeout: float = CLOSE_TIMEOUT) -> None:
        """Ends the session's work: every unfinished task is cancelled and awaited, and nothing more is sent or accepted.

        Bounded: a worker that swallows its cancellation is left behind after `timeout` seconds, so it cannot hold the
        session (and its D-04 slot) open. Its task is already marked cancelled and can no longer tell Otto anything."""
        self._closed = True
        for record in list(self._records.values()):
            if record.state not in TERMINAL:
                self._cancel(record)
        self._queue.clear()
        if self._runners:
            await asyncio.wait(set(self._runners), timeout=timeout)

    # ---- reading ----

    def get(self, task_id: str) -> TaskSnapshot | None:
        record = self._records.get(task_id)
        return record.snapshot() if record else None

    def snapshots(self) -> list[TaskSnapshot]:
        return [r.snapshot() for r in self._records.values()]

    # ---- the run ----

    def _pump(self) -> None:
        """Starts queued tasks, oldest first, while there is a free slot."""
        if self._closed:
            return
        while self._queue and self._free_slots() > 0:
            # Highest priority first, oldest first within a priority.
            best = max(self._queue, key=lambda task_id: (RANK[self._records[task_id].priority], -self._records[task_id].seq))
            self._queue.remove(best)
            record = self._records[best]
            if record.state != "queued":
                continue
            # Take the slot now, not when the task first runs, or two pumps in a row would start too many.
            self._transition(record, "running")
            record.runner = asyncio.get_running_loop().create_task(self._run(record), name=record.id)
            self._runners.add(record.runner)
            record.runner.add_done_callback(self._runners.discard)

    def _free_slots(self) -> int:
        return MAX_RUNNING - sum(1 for r in self._records.values() if r.state in _RUNNING)

    def _preempt(self, rank: int) -> bool:
        """Cancels one running task below `rank` to free a slot: the lowest priority, then the newest (it has done the
        least work). A task submitted `cancellable=False` is never chosen, and neither is one already `verifying`, whose
        work is done. True when one was cancelled.

        A slot is held by a task's state, not its coroutine: a worker that swallows its cancellation frees its slot at
        once but may keep running until `close`, which is bounded."""
        candidates = [
            r for r in self._records.values()
            if r.state in ("running", "waiting") and RANK[r.priority] < rank and r.cancellable
        ]
        if not candidates:
            return False
        victim = min(candidates, key=lambda r: (RANK[r.priority], -r.seq))
        self._cancel(victim, "preempted")
        return True

    async def _run(self, record: _Record) -> None:
        try:
            result: str | None = None
            while True:
                record.attempts += 1
                try:
                    async with asyncio.timeout(record.timeout):
                        result = await record.worker(TaskContext(self, record))
                    break
                except RetryableError:
                    if record.attempts > record.retries:
                        return self._fail(record, "error")
                    self._resume(record)
                    await self._sleep(record.backoff)
                except TimeoutError:  # a worker's own timeout (a socket, say) counts too: it is not retried either
                    return self._fail(record, "timeout")
                except Exception:  # noqa: BLE001 - a worker may raise anything; its text is never kept
                    return self._fail(record, "error")
            if record.state in TERMINAL:  # cancelled while the worker ignored it: skip the check and the result
                return
            self._resume(record)
            if record.verify is not None:
                self._transition(record, "verifying")
                try:
                    async with asyncio.timeout(record.timeout):
                        verified = await record.verify(result)
                except Exception:  # noqa: BLE001 - a check that cannot finish confirms nothing
                    verified = False
                if record.state in TERMINAL:
                    return
                if verified is not True:
                    return self._fail(record, "verification_failed")
            record.result = _clip(result, RESULT_CHARS)
            record.progress = 1.0
            self._transition(record, "completed")
        except asyncio.CancelledError:
            self._cancel(record)  # a no-op when cancel() or close() already marked it
            raise
        finally:
            self._pump()

    # ---- state ----

    def _transition(self, record: _Record, new: State) -> None:
        if new not in TRANSITIONS[record.state]:
            raise ValueError(f"task {record.id}: {record.state} -> {new} is not allowed")
        first = new == "running" and not record.started
        record.state = new
        if new == "running":
            record.started = True
        self._announce(record, first)
        self._notify(record)
        if new in TERMINAL:
            self._forget_old()

    def _fail(self, record: _Record, reason: Reason) -> None:
        if record.state in TERMINAL:
            return
        record.reason = reason
        self._transition(record, "failed")

    def _cancel(self, record: _Record, reason: Reason = "cancelled") -> None:
        if record.state in TERMINAL:
            return
        record.reason = reason
        if record.id in self._queue:
            self._queue.remove(record.id)
        self._transition(record, "cancelled")
        # A task that has not started its coroutine never reaches its own `except CancelledError`, so the state is set above.
        if record.runner is not None and not record.runner.done():
            record.runner.cancel()

    def _resume(self, record: _Record) -> None:
        if record.state == "waiting":
            self._transition(record, "running")

    def _progress(self, record: _Record, fraction: object, note: object) -> None:
        if record.state in TERMINAL:
            return
        if self._number(fraction):
            record.progress = min(1.0, max(0.0, float(fraction)))
        record.note = _clip(note, NOTE_CHARS) if note is not None else record.note
        self._resume(record)
        self._notify(record)

    def _wait_on(self, record: _Record, note: object) -> None:
        if record.state not in ("running", "waiting"):
            return
        record.note = _clip(note, NOTE_CHARS) if note is not None else record.note
        if record.state == "running":
            self._transition(record, "waiting")

    def _forget_old(self) -> None:
        """Drops the oldest finished tasks past MAX_KEPT, so results do not pile up for a long session."""
        finished = [r.id for r in self._records.values() if r.state in TERMINAL]
        for task_id in finished[:-MAX_KEPT] if len(finished) > MAX_KEPT else []:
            del self._records[task_id]

    @staticmethod
    def _number(value: object) -> bool:
        return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)

    # ---- telling Otto (the existing avatar path) ----

    def _announce(self, record: _Record, first: bool) -> None:
        """`working` when it starts, and `success` or `failure` when it ends. Progress and waiting stay readable through
        `get`; the avatar vocabulary has no progress, and a bare `waiting` has no task id."""
        if self._closed or self._emit is None:
            return
        topic = record.title
        if first:
            event: dict | None = {"kind": "working", "id": record.id, "topic": topic}
        elif record.state == "completed":
            event = {"kind": "success", "id": record.id, "topic": topic}
        elif record.state in ("failed", "cancelled") and record.started:
            event = {"kind": "failure", "id": record.id, "topic": topic, "message": _FAILURE_MESSAGES[record.reason or "error"]}
        else:
            event = None
        if event is not None:
            try:
                self._emit(event)
            except Exception:  # noqa: BLE001 - telling Otto must never be able to stop the work
                pass

    def _notify(self, record: _Record) -> None:
        """The typed step, for the engine's owner. Never able to stop the work, and silent once the engine is closed."""
        if self._closed or self._on_event is None:
            return
        try:
            self._on_event(TaskEvent(
                record.id, record.title, record.state, record.reason, record.progress,
                record.priority, record.started,
                _clip(record.result, RESULT_CHARS) if record.state == "completed" else None,
            ))
        except Exception:  # noqa: BLE001
            pass


def clean_task_status(item: object) -> dict | None:
    """One task as the model may read it: closed fields only, each checked, never a worker's result or note.

    Used on both sides of the session state (the bridge writes it, the tool re-reads it), so a bad entry is dropped either way."""
    if not isinstance(item, dict):
        return None
    task_id, state, reason, priority, progress = item.get("id"), item.get("state"), item.get("reason"), item.get("priority"), item.get("progress")
    if not is_runtime_id(task_id) or state not in STATES or priority not in RANK:
        return None
    if reason is not None and reason not in REASONS:
        return None
    if not TaskEngine._number(progress):
        return None
    return {
        "id": task_id,
        "title": runtime_title(item.get("title"), "Task"),
        "state": state,
        "progress": round(min(1.0, max(0.0, float(progress))), 2),
        "reason": reason,
        "priority": priority,
    }


def background_task_status(snapshots: list[TaskSnapshot]) -> list[dict]:
    """What the bridge mirrors into session state for the `get_background_tasks` tool."""
    shown = [clean_task_status({"id": t.id, "title": t.title, "state": t.state, "progress": t.progress,
                                "reason": t.reason, "priority": t.priority}) for t in snapshots]
    return [item for item in shown if item is not None]
