"""Forget one visitor everywhere the server keeps something about them (D-17, D-26).

A host calls this when its visitor asks to be forgotten. It is a plain function: no tool, message or route
reaches it, so the model can never trigger it. Layering: it sits above the two stores and imports both;
neither store imports it.
"""
from __future__ import annotations

from app.voice.continuity_store import ContinuityStore
from app.voice.memory_service import SQLiteMemoryService


class ForgetIncomplete(RuntimeError):
    """One store failed, so the identity is only partly forgotten. `done` and `failed` name the parts; the
    host should call `forget_identity` again, which is safe to repeat. No identity or stored value is in it."""

    def __init__(self, done: dict[str, int], failed: tuple[str, ...]) -> None:
        super().__init__(f"Forgetting is incomplete: not done: {', '.join(failed)}; done: {', '.join(done) or 'nothing'}")
        self.done = done
        self.failed = failed


def forget_identity(
    memory: SQLiteMemoryService, continuity: ContinuityStore, scope: str, identity: str, *, explicit: bool = False,
) -> dict[str, int]:
    """Delete all memory records and the continuity record for (scope, identity); return the counts.

    Continuity is disabled, not just deleted. That is what a withdrawal already does (D-26: retention must not
    silently come back); a host that later passes the identity as enabled re-enables it, as for any session.
    Another identity, or the same identity in another scope, is untouched. `explicit=True` is required, as for
    every memory write. The two stores are separate databases, so this is not atomic: each part is tried even
    if the other fails, and a failure raises `ForgetIncomplete` saying which part is not done. Repeating the
    call is safe.
    """
    if explicit is not True:  # checked first, so a refused call touches neither store
        raise PermissionError("Forgetting an identity requires an explicit user request")
    if isinstance(scope, str):
        scope = scope.strip()  # the memory store and the session header both strip it; the continuity store does not
    done: dict[str, int] = {}
    failed: list[str] = []
    try:
        had_continuity = continuity.load(scope, identity) is not None
    except Exception:
        had_continuity = False
    try:
        done["memory_records"] = memory.forget_all(scope, identity, explicit=True)
    except ValueError:
        raise  # invalid scope or identity: nothing has been touched yet
    except Exception:
        failed.append("memory_records")
    try:
        continuity.disable(scope, identity)
        done["continuity_records"] = 1 if had_continuity else 0
    except Exception:
        failed.append("continuity_records")
    if failed:
        raise ForgetIncomplete(done, tuple(failed))
    return done
