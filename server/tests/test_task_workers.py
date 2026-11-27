from __future__ import annotations

import asyncio

import pytest

from app.voice.tasks import TaskEngine
from app.voice.task_workers import TaskWorkerAdapter


def test_only_registered_workers_can_be_submitted_and_the_registry_is_sealed():
    async def go():
        engine = TaskEngine()
        adapter = TaskWorkerAdapter(engine)
        rejected_before_seal = adapter.submit("summarize", "Summarize")
        calls = []

        async def worker(ctx):
            calls.append("ran")
            ctx.progress(0.5, "Halfway")
            return "summary"

        adapter.register("summarize", worker)
        adapter.seal()
        accepted = adapter.submit("summarize", "Summarize")
        unknown = adapter.submit("not_registered", "Unknown")
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        snapshot = engine.get(accepted.task_id)
        await engine.close()
        return rejected_before_seal, accepted, unknown, calls, snapshot

    before, accepted, unknown, calls, snapshot = asyncio.run(go())
    assert before.rejected == "closed"
    assert accepted.ok and accepted.task_id == "task-1"
    assert unknown.rejected == "invalid"
    assert calls == ["ran"]
    assert snapshot.state == "completed" and snapshot.result == "summary"


def test_worker_registry_rejects_invalid_or_duplicate_names_and_late_registration():
    async def worker(ctx):
        return "ok"

    adapter = TaskWorkerAdapter(TaskEngine())
    with pytest.raises(ValueError):
        adapter.register("../worker", worker)
    with pytest.raises(ValueError):
        adapter.register("valid", None)  # type: ignore[arg-type]
    adapter.register("valid", worker)
    with pytest.raises(ValueError):
        adapter.register("valid", worker)
    adapter.seal()
    with pytest.raises(RuntimeError):
        adapter.register("late", worker)
