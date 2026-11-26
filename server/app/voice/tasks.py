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

Pure asyncio: no FastAPI, no ADK, no I/O of its own.
"""
from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Literal

from app.voice.runtime import runtime_title

State = Literal["created", "queued", "running", "waiting", "verifying", "completed", "failed", "cancelled"]
Reason = Literal["error", "timeout", "verification_failed", "cancelled"]
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
TERMINAL = frozenset({"completed", "failed", "cancelled"})
#: States that hold a running slot.
_RUNNING = frozenset({"running", "waiting", "verifying"})

MAX_ACTIVE = 4
MAX_RUNNING = 2
MAX_KEPT = 20
MAX_RETRIES = 2
DEFAULT_TIMEOUT = 30.0
MAX_TIMEOUT = 300.0
MAX_BACKOFF = 10.0
RESULT_CHARS = 500
NOTE_CHARS = 140

#: What Otto shows when a task ends badly. Fixed text: nothing a worker or an exception says reaches the visitor.
_FAILURE_MESSAGES = {
    "error": "Something went wrong.",
    "timeout": "It took too long.",
    "verification_failed": "I could not confirm it worked.",
    "cancelled": "Cancelled.",
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


@dataclass(frozen=True)
class Submission:
    """The result of `submit`: a task id, or why there is none. Never an exception for an expected refusal."""
    task_id: str | None = None
    rejected: Literal["busy", "closed", "invalid"] | None = None

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
    state: State = "created"
    progress: float = 0.0
    note: str | None = None
    result: str | None = None
    reason: Reason | None = None
    attempts: int = 0
    runner: asyncio.Task | None = None
    announced: bool = False  # `working` was sent, so an ending must be sent too

    def snapshot(self) -> TaskSnapshot:
        return TaskSnapshot(self.id, self.title, self.state, self.progress, self.note, self.result, self.reason, self.attempts)


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
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._emit = emit
        self._sleep = sleep
        self._records: dict[str, _Record] = {}
        self._queue: list[str] = []
        self._count = 0
        self._closed = False

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
    ) -> Submission:
        """Queues `worker` and returns at once; it never waits for the work. Call from the running event loop."""
        if self._closed:
            return Submission(rejected="closed")
        if not callable(worker) or (verify is not None and not callable(verify)) or not self._number(timeout) or not self._number(backoff):
            return Submission(rejected="invalid")
        if sum(1 for r in self._records.values() if r.state not in TERMINAL) >= MAX_ACTIVE:
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
        )
        record.retries = min(record.retries, MAX_RETRIES)
        self._records[record.id] = record
        self._transition(record, "queued")
        self._queue.append(record.id)
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

    async def close(self) -> None:
        """Ends the session's work: every unfinished task is cancelled and awaited, and nothing more is sent or accepted."""
        self._closed = True
        runners = []
        for record in list(self._records.values()):
            if record.state not in TERMINAL:
                self._cancel(record)
            if record.runner is not None:
                runners.append(record.runner)
        if runners:
            await asyncio.gather(*runners, return_exceptions=True)
        self._queue.clear()

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
        while self._queue and sum(1 for r in self._records.values() if r.state in _RUNNING) < MAX_RUNNING:
            record = self._records[self._queue.pop(0)]
            if record.state != "queued":
                continue
            # Take the slot now, not when the task first runs, or two pumps in a row would start too many.
            self._transition(record, "running")
            record.runner = asyncio.get_running_loop().create_task(self._run(record), name=record.id)

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
                except TimeoutError:
                    return self._fail(record, "timeout")
                except Exception:  # noqa: BLE001 - a worker may raise anything; its text is never kept
                    return self._fail(record, "error")
            self._resume(record)
            if record.verify is not None:
                self._transition(record, "verifying")
                try:
                    async with asyncio.timeout(record.timeout):
                        verified = await record.verify(result)
                except Exception:  # noqa: BLE001 - a check that cannot finish confirms nothing
                    verified = False
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
        record.state = new
        self._announce(record)
        if new in TERMINAL:
            self._forget_old()

    def _fail(self, record: _Record, reason: Reason) -> None:
        if record.state in TERMINAL:
            return
        record.reason = reason
        self._transition(record, "failed")

    def _cancel(self, record: _Record) -> None:
        if record.state in TERMINAL:
            return
        record.reason = "cancelled"
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

    def _announce(self, record: _Record) -> None:
        """`working` when it starts, and `success` or `failure` when it ends. Progress and waiting stay readable through
        `get`; the avatar vocabulary has no progress, and a bare `waiting` has no task id."""
        if self._closed or self._emit is None:
            return
        topic = record.title
        if record.state == "running" and not record.announced:
            record.announced = True
            event: dict | None = {"kind": "working", "id": record.id, "topic": topic}
        elif record.state == "completed":
            event = {"kind": "success", "id": record.id, "topic": topic}
        elif record.state in ("failed", "cancelled") and record.announced:
            event = {"kind": "failure", "id": record.id, "topic": topic, "message": _FAILURE_MESSAGES[record.reason or "error"]}
        else:
            event = None
        if event is not None:
            try:
                self._emit(event)
            except Exception:  # noqa: BLE001 - telling Otto must never be able to stop the work
                pass
