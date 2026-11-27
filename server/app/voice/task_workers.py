"""Trusted, in-process adapters from named server workers to a session task engine.

This is deliberately not an ADK tool or an execution router. Only server code that
already holds the bridge may register workers or submit them. The model cannot
choose a worker name, supply a closure, or bypass the existing policy chain.
"""
from __future__ import annotations

import re
from typing import Any

from app.voice.tasks import TaskEngine, Submission, Worker

_WORKER_NAME = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


class TaskWorkerAdapter:
    """A per-session allow-list of trusted async workers backed by the bridge's TaskEngine."""

    def __init__(self, engine: TaskEngine) -> None:
        self._engine = engine
        self._workers: dict[str, Worker] = {}
        self._sealed = False

    def register(self, name: str, worker: Worker) -> None:
        """Register one trusted worker before the session starts accepting work."""
        if self._sealed:
            raise RuntimeError("worker registry is sealed")
        if not isinstance(name, str) or _WORKER_NAME.fullmatch(name) is None:
            raise ValueError("invalid worker name")
        if not callable(worker):
            raise ValueError("worker must be callable")
        if name in self._workers:
            raise ValueError("worker name already registered")
        self._workers[name] = worker

    def seal(self) -> None:
        """Prevent runtime code from widening the worker allow-list after setup."""
        self._sealed = True

    def submit(self, name: str, title: str, **options: Any) -> Submission:
        """Submit a registered worker; unknown names fail closed without starting work."""
        if not self._sealed:
            return Submission(rejected="closed")
        worker = self._workers.get(name) if isinstance(name, str) else None
        if worker is None:
            return Submission(rejected="invalid")
        return self._engine.submit(title, worker, **options)
