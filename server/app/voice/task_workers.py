"""Worker adapters for the task engine (TASK-01, #49): one existing read-only capability, run as a background task.

A worker is built by the server from a request the model's *checked tool* already validated (`start_project_research` in
tools.py), never from model text alone. This module is a leaf: it imports the task engine's types and the research service's,
and nothing above them (no tools, bridge, route or SDK), so a worker cannot start another task, call a tool or reach the
browser. Its only way out is the string it returns. The engine keeps that string (500 characters, one line), and the bridge
shows it on a card (D-18). It never goes to the model (`tasks.py` keeps results out of every event).
"""
from __future__ import annotations

from typing import Awaitable, Callable, Protocol

from app.voice.research import ResearchRequest
from app.voice.tasks import TaskContext

#: The server-set label of this task. Never built from the query: a title reaches the model, and a query is model text.
PROJECT_RESEARCH_TITLE = "Search the project docs"
#: How long the whole search may take. The research service has its own, shorter, per-provider timeout.
PROJECT_RESEARCH_TIMEOUT = 15.0
MAX_QUERY_CHARS = 200
#: At most this many matches go on the card, each with a short excerpt. The engine clips the whole result again.
MAX_CARD_MATCHES = 3
EXCERPT_CHARS = 110
NO_MATCH = "No matching section in the project docs."


class _Searches(Protocol):
    async def search(self, request: ResearchRequest): ...


def project_research_worker(service: _Searches, query: str) -> Callable[[TaskContext], Awaitable[str]]:
    """A worker that searches the allow-listed project docs and returns a short plain-text summary.

    The summary names each match by its document and section title and a short excerpt. It never carries a locator or a
    URL (D-18: nothing on a card is a link). A search that finds nothing still completes, with `NO_MATCH`: an empty answer is
    an answer, and the verifier below only rejects a worker that returned nothing at all."""

    async def work(ctx: TaskContext) -> str:
        ctx.progress(0.1, "Searching the project docs")
        result = await service.search(ResearchRequest(query=query, limit=MAX_CARD_MATCHES, sources=("project",)))
        ctx.progress(0.8, "Writing up what I found")
        parts = [
            f"{item.evidence.title}: {' '.join(item.evidence.excerpt.split())[:EXCERPT_CHARS]}"
            for item in result.evidence[:MAX_CARD_MATCHES]
        ]
        return " | ".join(parts) if parts else NO_MATCH

    return work


async def has_summary(result: str | None) -> bool:
    """The task's check (`verify`): a worker that returned no text did not do its job, so the task is `failed`, not `completed`."""
    return isinstance(result, str) and bool(result.strip())
