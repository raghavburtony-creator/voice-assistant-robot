"""The tools get ADK's `State`, not a dict (ADK wraps the session's dict in it), and the policy chain must work on it.

Until these tests, every context in the suite was a plain dict, so a check written for `dict` alone denied every tool in a
real session without a single test failing. Each case here wraps the SAME dict the bridge reads in a real `State`, the way
`ToolContext.state` does, and follows the whole authority chain.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from google.adk.sessions.state import State

from app.voice import tools
from app.voice.policy import AUDIT_STATE_KEY, PENDING_STATE_KEY, POLICY_ENGINE, clear_state_key, supports_state
from app.voice.sink import sink
from tests.test_integration_chain import Live, deliver, host_report


def state_context(session: Live) -> SimpleNamespace:
    """What ADK hands a tool: a State over the session's dict. Writes go through to that dict, which the bridge reads."""
    return SimpleNamespace(state=State(session.state, {}), session=SimpleNamespace(id=session.session_id))


@pytest.fixture
def session():
    made = Live("adk-state")
    yield made
    made.close()


def test_state_is_not_a_dict_and_the_policy_still_accepts_it():
    state = State({}, {})
    assert not isinstance(state, dict)  # the premise: a `dict` check cannot be the right one
    assert supports_state(state) and supports_state({}) and not supports_state(None) and not supports_state("text")


def test_a_voice_session_tool_is_allowed_on_a_real_state_and_a_denied_one_is_still_audited(session):
    ctx = state_context(session)
    allowed = tools.REGISTRY._gateway(tools.get_screen_context, tools.REGISTRY["get_screen_context"].metadata)(ctx)
    assert allowed["status"] == "success" and allowed["policy"]["decision"] == "allow"
    background = tools.REGISTRY._gateway(tools.get_background_tasks, tools.REGISTRY["get_background_tasks"].metadata)(ctx)
    assert background["status"] == "success"

    denied = tools.REGISTRY._gateway(tools.get_perception_context, tools.REGISTRY["get_perception_context"].metadata)(ctx)
    assert denied["status"] == "error" and denied["error"]["code"] == "permission_denied"
    # The audit row reached the session's own dict, where the bridge and the forget path read it.
    assert [row["execution_status"] for row in session.state[AUDIT_STATE_KEY]][-1] == "denied"
    assert len(session.state[AUDIT_STATE_KEY]) == 3  # allowed, allowed, denied: nothing went unrecorded


def test_a_real_state_that_is_missing_a_session_is_still_denied():
    ctx = SimpleNamespace(state=State({}, {}), session=None)
    result = tools.REGISTRY._gateway(tools.get_screen_context, tools.REGISTRY["get_screen_context"].metadata)(ctx)
    assert result["status"] == "error" and result["error"]["code"] == "permission_denied"


def test_the_whole_desktop_action_chain_works_on_a_real_state(session):
    """The request id the policy engine records is the one the browser gets, and a host receipt completes it once."""
    session.state["screens"] = {"desktop_context": {"enabled": True}}
    ctx = state_context(session)
    envelope = tools.REGISTRY._gateway(tools.desktop_action, tools.REGISTRY["desktop_action"].metadata)("launch_calculator", ctx)
    assert envelope["status"] == "success" and envelope["policy"]["decision"] == "confirmation_required"
    request_id = envelope["policy"]["request_id"]

    # D-25: the queued action carries the policy engine's request id. Before the fix it was missing on a State.
    [queued] = sink.drain(session.session_id)
    assert queued == {"action": "desktop_action", "desktop_action": "launch_calculator", "request_id": request_id}
    # The scratch decision is gone again, so a later tool call cannot pick up this request's id.
    assert ctx.state.get("_active_policy_decision") is None
    assert request_id in session.state[PENDING_STATE_KEY]
    assert session.state[AUDIT_STATE_KEY][-1]["execution_status"] == "awaiting_confirmation"

    deliver(session, host_report(request_id, decision="approved", status="completed", ok=True, verification="verified"))
    row = next(r for r in session.state[AUDIT_STATE_KEY] if r["request_id"] == request_id)
    assert (row["consent_status"], row["execution_status"], row["verification_status"]) == ("approved", "completed", "passed")
    assert request_id not in session.state[PENDING_STATE_KEY]
    assert "Verification: verified." in session.sent_text[0]


def test_a_receipt_for_an_unrequested_action_is_still_refused_on_a_real_state(session):
    deliver(session, host_report("f" * 32, decision="approved", status="completed", ok=True, verification="verified"))
    assert session.sent_text == []
    assert not session.state.get(AUDIT_STATE_KEY)


def test_clearing_a_key_works_on_a_dict_and_on_a_state_that_cannot_delete():
    plain = {"k": 1}
    clear_state_key(plain, "k")
    assert "k" not in plain
    wrapped = State({"k": 1}, {})
    clear_state_key(wrapped, "k")
    assert wrapped.get("k") is None
    clear_state_key(wrapped, "never-set")  # a missing key is not an error
    assert POLICY_ENGINE is not None


def test_a_memory_proposal_is_staged_on_a_real_state_and_confirmed_once_from_the_bridges_dict(session):
    """The tool stages through the State; the bridge consumes from the session's own dict. Both must see the same record."""
    from app.voice.memory_consent import consume_memory_proposal

    session.state["memory_enabled"] = True
    ctx = state_context(session)
    envelope = tools.REGISTRY._gateway(tools.propose_memory, tools.REGISTRY["propose_memory"].metadata)(
        "Prefers short answers", "semantic", ctx,
    )
    assert envelope["status"] == "success", envelope
    [queued] = sink.drain(session.session_id)
    request_id = queued["memory_proposal"]["request_id"]
    assert request_id not in repr(envelope)  # the model never sees the id
    status, proposal = consume_memory_proposal(session.state, request_id, True)
    assert (status, proposal["content"]) == ("accepted", "Prefers short answers")
    assert consume_memory_proposal(session.state, request_id, True) == (None, None)


def test_memory_stays_denied_on_a_real_state_without_the_hosts_opt_in(session):
    ctx = state_context(session)
    envelope = tools.REGISTRY._gateway(tools.propose_memory, tools.REGISTRY["propose_memory"].metadata)(
        "Prefers short answers", "semantic", ctx,
    )
    assert envelope["status"] == "error" and envelope["error"]["code"] == "permission_denied"
    assert sink.drain(session.session_id) == []
