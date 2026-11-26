from __future__ import annotations

import asyncio
from types import SimpleNamespace

from google.adk.sessions.state import State

from app.voice import bridge as bridge_module
from app.voice.bridge import Bridge
from app.voice.continuity import ContinuityContext
from app.voice.memory_consent import (
    MAX_PENDING_MEMORY,
    MEMORY_PROPOSAL_TTL_SECONDS,
    PENDING_MEMORY_KEY,
    consume_memory_proposal,
    discard_memory_proposal,
    pending_memory_proposal,
    stage_memory_proposal,
)
from app.voice.policy import PermissionPolicy
from app.voice.tool_registry import TOOL_METADATA
from app.voice import tools


def test_adk_state_object_can_stage_pending_proposals_and_consume_them_once():
    state = State({}, {})
    assert not isinstance(state, dict)
    proposal = stage_memory_proposal(state, "Prefers concise answers", "semantic", now=100)
    assert proposal is not None
    assert pending_memory_proposal(state, proposal["request_id"], now=101) == proposal
    assert state.has_delta()

    status, consumed = consume_memory_proposal(state, proposal["request_id"], True, now=102)

    assert status == "accepted"
    assert consumed == {
        "content": "Prefers concise answers", "kind": "semantic", "sensitive": False,
        "redacted_categories": (),
    }
    assert pending_memory_proposal(state, proposal["request_id"], now=103) is None


def test_adk_state_object_can_reject_and_discard_a_proposal():
    state = State({}, {})
    proposal = stage_memory_proposal(state, "Temporary note", "episodic", now=100)
    assert proposal is not None
    discard_memory_proposal(state, proposal["request_id"], now=101)
    assert pending_memory_proposal(state, proposal["request_id"], now=101) is None


def test_pending_lookup_drops_malformed_entries_without_dict_pop_support():
    state = State({}, {})
    malformed_id = "a" * 32
    state[PENDING_MEMORY_KEY] = {
        malformed_id: {"kind": "unknown", "content": "bad", "created_at": 100},
    }

    assert pending_memory_proposal(state, malformed_id, now=101) is None
    assert malformed_id not in state[PENDING_MEMORY_KEY]


def test_proposal_is_redacted_before_it_is_exposed_and_marked_sensitive():
    state = {}
    proposal = stage_memory_proposal(
        state, "Contact me at visitor@example.com about the project", "semantic", now=100,
    )
    assert proposal is not None
    assert proposal["content"] == "Contact me at [email] about the project"
    assert proposal["redacted"] is True
    assert "visitor@example.com" not in str(state)
    assert state[PENDING_MEMORY_KEY][proposal["request_id"]]["sensitive"] is True
    assert state[PENDING_MEMORY_KEY][proposal["request_id"]]["redacted_categories"] == ["email"]


def test_rejects_invalid_kind_empty_text_and_overlong_text():
    state = {}
    assert stage_memory_proposal(state, "A preference", "working", now=100) is None
    assert stage_memory_proposal(state, "A preference", [], now=100) is None
    assert stage_memory_proposal(state, "  ", "semantic", now=100) is None
    assert stage_memory_proposal(state, "x" * 601, "semantic", now=100) is None
    assert state.get(PENDING_MEMORY_KEY, {}) == {}


def test_pending_proposals_are_bounded_and_expired_entries_are_pruned():
    state = {}
    proposals = [
        stage_memory_proposal(state, f"Preference {index}", "semantic", now=100)
        for index in range(MAX_PENDING_MEMORY)
    ]
    assert all(proposals)
    assert stage_memory_proposal(state, "One more", "semantic", now=100) is None
    replacement = stage_memory_proposal(
        state, "Replacement", "semantic", now=100 + MEMORY_PROPOSAL_TTL_SECONDS + 1,
    )
    assert replacement is not None
    assert list(state[PENDING_MEMORY_KEY]) == [replacement["request_id"]]


def test_browser_confirmation_consumes_a_matching_proposal_once():
    state = {}
    proposal = stage_memory_proposal(state, "Prefers concise answers", "semantic", now=100)
    assert proposal is not None
    assert pending_memory_proposal(state, proposal["request_id"], now=101) == proposal
    status, saved = consume_memory_proposal(state, proposal["request_id"], True, now=102)
    assert status == "accepted"
    assert saved == {
        "content": "Prefers concise answers", "kind": "semantic", "sensitive": False,
        "redacted_categories": (),
    }
    assert pending_memory_proposal(state, proposal["request_id"], now=102) is None
    assert consume_memory_proposal(state, proposal["request_id"], True, now=103) == (None, None)


def test_not_now_discards_and_expired_confirmation_is_rejected():
    state = {}
    proposal = stage_memory_proposal(state, "Temporary note", "episodic", now=100)
    assert proposal is not None
    assert consume_memory_proposal(state, proposal["request_id"], False, now=101) == ("discarded", None)
    expired = stage_memory_proposal(state, "Old note", "semantic", now=200)
    assert expired is not None
    assert consume_memory_proposal(
        state, expired["request_id"], True, now=200 + MEMORY_PROPOSAL_TTL_SECONDS + 1,
    ) == ("expired", None)


def test_invalid_or_untrusted_confirmation_is_ignored():
    state = {}
    proposal = stage_memory_proposal(state, "Prefers concise answers", "semantic", now=100)
    assert proposal is not None
    assert consume_memory_proposal(state, "not-an-id", True, now=101) == (None, None)
    assert consume_memory_proposal(state, proposal["request_id"], "true", now=101) == (None, None)
    assert proposal["request_id"] in state[PENDING_MEMORY_KEY]


def test_memory_policy_accepts_adk_state_like_objects_and_denies_missing_opt_in():
    state = State({}, {})
    context = SimpleNamespace(session=SimpleNamespace(id="session"), state=state)
    assert PermissionPolicy().evaluate("memory_opt_in", context)[0] == "deny"
    state["memory_enabled"] = True
    assert PermissionPolicy().evaluate("memory_opt_in", context)[0] == "allow"


def test_propose_memory_registry_entry_has_a_proposal_only_side_effect():
    metadata = next(item for item in TOOL_METADATA if item.name == "propose_memory")
    assert metadata.family == "memory"
    assert metadata.required_permission == "memory_opt_in"
    assert metadata.side_effects == ("memory_proposal",)
    assert metadata.risk_level == "medium"


def test_bridge_persists_only_after_a_matching_browser_confirmation(monkeypatch):
    writes = []

    class MemoryStub:
        def __init__(self):
            self.context_calls = 0

        def get_context(self, scope, identity):
            self.context_calls += 1
            if self.context_calls > 1:
                raise RuntimeError("context refresh unavailable")
            return "[]"

        def remember(self, scope, identity, content, **kwargs):
            writes.append((scope, identity, content, kwargs))

    monkeypatch.setattr(bridge_module, "memory_service", MemoryStub())
    live = SimpleNamespace(
        session_id="memory-confirmation",
        continuity=ContinuityContext(scope="app", identity="opaque-host-id"),
        state={"screens": {}},
    )
    from app.voice.sink import sink
    class ContinuityStub:
        def enable(self, scope, identity):
            pass

        def load(self, scope, identity):
            return None

        def disable(self, scope, identity):
            pass

    sink.open(live.session_id)
    try:
        bridge = Bridge(object(), live, store=ContinuityStub())
        tool_context = SimpleNamespace(
            state=State(bridge.live.state, {}),
            session=SimpleNamespace(id=live.session_id),
        )
        staged = tools.propose_memory("Contact me at visitor@example.com", "semantic", tool_context)
        assert staged["ok"] is True and staged["awaiting_confirmation"] is True
        request_id = next(iter(bridge.live.state[PENDING_MEMORY_KEY]))
        proposal = pending_memory_proposal(bridge.live.state, request_id)
        assert proposal is not None
        assert writes == []
        saved = asyncio.run(bridge.resolve_memory_consent({
            "type": "memory_consent", "request_id": request_id, "accepted": True,
        }))
        assert saved == {"type": "memory_result", "request_id": request_id, "status": "saved"}
        assert writes == [(
            "app", "opaque-host-id", "Contact me at [email]",
            {
                "kind": "semantic", "provenance": "visitor approved in voice panel",
                "sensitivity": "sensitive", "redacted_categories": ("email",), "explicit": True,
            },
        )]
        assert asyncio.run(bridge.resolve_memory_consent({
            "type": "memory_consent", "request_id": request_id, "accepted": True,
        })) is None

        staged_after = tools.propose_memory("Likes green tea", "semantic", tool_context)
        assert staged_after["ok"] is True
        pending_after = next(
            item for item in bridge.live.state[PENDING_MEMORY_KEY] if item != request_id
        )
        bridge.withdraw_continuity()
        withdrawn = asyncio.run(bridge.resolve_memory_consent({
            "type": "memory_consent", "request_id": pending_after, "accepted": True,
        }))
        assert withdrawn == {
            "type": "memory_result", "request_id": pending_after, "status": "unavailable",
        }
        assert len(writes) == 1
        assert bridge.live.state["memory_enabled"] is False
        assert bridge.live.state["memory_context"] == "[]"
    finally:
        sink.close(live.session_id)
