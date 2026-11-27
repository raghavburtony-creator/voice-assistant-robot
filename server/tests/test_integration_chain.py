"""Integration tests across the seams of the D-22 authority chain (TEST-01, #59).

Each module already has unit tests. These start where a real call starts (an ADK tool, a browser message, a session opening)
and follow it through the registry, the policy engine, the sink, the bridge and the stores, so a change that disconnects two
parts fails here even when both parts still pass their own tests. They are deterministic: no sleeps, no network, no model.

What this file does not cover: an orchestrator (D-22 keeps a chain), a worker adapter, remote MCP transport/server/client
support, or a skill-package loader. The first static extension manifest catalog (#55) has dedicated validation and lifecycle
tests in test_extensions.py; its declared tools enter the same registry and policy chain as built-in tools.
"""
from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import jsonschema
import pytest

from app.voice import bridge as bridge_module, tools
from app.voice.bridge import Bridge
from app.voice.continuity import ContinuityContext
from app.voice.continuity_store import SQLiteContinuityStore
from app.voice.forget import forget_identity
from app.voice.memory_service import SQLiteMemoryService
from app.voice.policy import AUDIT_STATE_KEY, PENDING_STATE_KEY, POLICY_ENGINE
from app.voice.sink import sink
from app.voice.tool_registry import TOOL_METADATA


class Socket:
    """Hands the bridge browser messages and records what it sends back."""

    def __init__(self, *messages: dict) -> None:
        self.messages = [{"type": "websocket.receive", "text": json.dumps(m)} for m in messages]
        self.sent: list = []

    async def receive(self) -> dict:
        return self.messages.pop(0) if self.messages else {"type": "websocket.disconnect"}

    async def send_json(self, message: dict) -> None:
        self.sent.append(message)

    async def send_bytes(self, data: bytes) -> None:
        self.sent.append(data)


class Live:
    """A stand-in for the Gemini session that records what the model is told. One ADK session id, one state dict."""

    def __init__(self, session_id: str, continuity: ContinuityContext | None = None) -> None:
        self.session_id = session_id
        self.continuity = continuity
        self.state: dict = {"page": "home", "page_title": "Home", "screens": {}}
        self.sent_text: list[str] = []
        self.images: list[bytes] = []
        sink.open(session_id)

    async def events(self):
        return
        yield  # pragma: no cover - makes this an async generator

    async def send_audio(self, pcm: bytes) -> None: ...
    async def send_text(self, text: str) -> None: self.sent_text.append(text)
    async def send_image(self, jpeg: bytes) -> None: self.images.append(jpeg)
    async def audio_end(self) -> None: ...
    def close(self) -> None: sink.close(self.session_id)


@pytest.fixture
def live():
    made: list[Live] = []

    def make(session_id: str = "chain", continuity: ContinuityContext | None = None) -> Live:
        item = Live(session_id, continuity)
        made.append(item)
        return item

    yield make
    for item in made:
        item.close()


def adk_tool(name: str):
    """The callable ADK would run: the registry's gateway, not the bare function."""
    return next(t for t in tools.TOOLS if t.name == name).func


def context_for(live_session: Live) -> SimpleNamespace:
    return SimpleNamespace(state=live_session.state, session=SimpleNamespace(id=live_session.session_id))


def host_report(request_id: str, *, decision: str, status: str, ok: bool, verification: str, action: str = "launch_calculator") -> dict:
    issued = 1700000000000
    return {
        "type": "desktop_result", "request_id": request_id, "action": action,
        "consent_certificate": {
            "certificate_id": f"{request_id}-{issued}", "request_id": request_id, "action": action,
            "decision": decision, "method": "native_os_dialog", "issued_at_unix_ms": issued,
        },
        "result": {"ok": ok, "status": status, "verification": verification},
    }


def request_desktop_action(session: Live) -> dict:
    """Step 1 of the chain: the model's tool call, with the visitor having enabled desktop awareness."""
    session.state["screens"] = {"desktop_context": {"enabled": True}}
    envelope = adk_tool("desktop_action")("launch_calculator", context_for(session))
    assert envelope["status"] == "success" and envelope["policy"]["decision"] == "confirmation_required"
    [queued] = sink.drain(session.session_id)
    # The browser gets the same request id the policy engine recorded; that id is the only thing a host receipt can answer.
    assert queued == {"action": "desktop_action", "desktop_action": "launch_calculator", "request_id": envelope["policy"]["request_id"]}
    return envelope


def deliver(session: Live, report: dict) -> None:
    asyncio.run(Bridge(Socket(report), session).browser_to_model())


def audit_row(session: Live, request_id: str) -> dict:
    return next(r for r in session.state[AUDIT_STATE_KEY] if r["request_id"] == request_id)


# ---- tool -> registry -> policy -> sink -> browser -> host receipt -> audit -> model ----

def test_an_approved_and_verified_desktop_action_runs_the_whole_chain(live):
    session = live()
    envelope = request_desktop_action(session)
    request_id = envelope["policy"]["request_id"]
    assert audit_row(session, request_id)["execution_status"] == "awaiting_confirmation"
    assert request_id in session.state[PENDING_STATE_KEY]

    deliver(session, host_report(request_id, decision="approved", status="completed", ok=True, verification="verified"))

    row = audit_row(session, request_id)
    assert (row["consent_status"], row["execution_status"], row["verification_status"]) == ("approved", "completed", "passed")
    assert row["result_provenance"] == "native_host_reported"
    assert request_id not in session.state[PENDING_STATE_KEY]  # a request completes once
    [told] = session.sent_text
    assert "Action: launch_calculator. Execution: completed. Verification: verified." in told
    assert "not permission" in told


def test_observe_act_verify_failure_is_reported_as_a_failure_and_never_as_success(live):
    session = live()
    request_id = request_desktop_action(session)["policy"]["request_id"]

    # The host acted but could not confirm the result.
    deliver(session, host_report(request_id, decision="approved", status="failed", ok=False, verification="not_verified"))

    row = audit_row(session, request_id)
    assert row["verification_status"] == "failed"
    assert row["result_ok"] is False
    [told] = session.sent_text
    assert "Execution: failed. Verification: not_verified." in told
    assert "Verification: verified" not in told
    assert "tell the visitor it was not completed" in told


def test_a_started_process_is_pending_verification_not_passed(live):
    session = live()
    request_id = request_desktop_action(session)["policy"]["request_id"]
    deliver(session, host_report(request_id, decision="approved", status="started", ok=True, verification="process_spawned"))
    assert audit_row(session, request_id)["verification_status"] == "pending"
    assert "only 'verified' confirms the outcome" in session.sent_text[0]


def test_a_denied_action_is_cancelled_and_the_model_is_told_it_did_not_happen(live):
    session = live()
    request_id = request_desktop_action(session)["policy"]["request_id"]
    deliver(session, host_report(request_id, decision="denied", status="denied", ok=False, verification="not_verified"))
    row = audit_row(session, request_id)
    assert (row["consent_status"], row["execution_status"], row["verification_status"]) == ("denied", "cancelled", "not_run")
    assert "Execution: denied" in session.sent_text[0]


def test_consent_cancelled_before_the_dialog_is_recorded_as_cancelled_not_approved(live):
    session = live()
    request_id = request_desktop_action(session)["policy"]["request_id"]
    cancelled = {
        "type": "desktop_result", "request_id": request_id, "action": "launch_calculator", "consent_certificate": None,
        "result": {"ok": False, "status": "failed", "verification": "unavailable"},
    }
    deliver(session, cancelled)
    row = audit_row(session, request_id)
    assert row["consent_status"] == "not_presented"
    assert row["execution_status"] == "cancelled_before_execution"
    assert row["result_provenance"] == "browser_preflight_reported"


def test_a_receipt_cannot_approve_what_the_policy_engine_never_asked_for(live):
    # A forged id, an id from another session and a replay must all leave the model silent and the audit unchanged.
    first, second = live("chain-a"), live("chain-b")
    request_id = request_desktop_action(first)["policy"]["request_id"]
    approved = host_report(request_id, decision="approved", status="completed", ok=True, verification="verified")

    deliver(second, approved)  # another session never saw this request
    deliver(first, host_report("f" * 32, decision="approved", status="completed", ok=True, verification="verified"))
    assert first.sent_text == [] and second.sent_text == []
    assert audit_row(first, request_id)["execution_status"] == "awaiting_confirmation"

    deliver(first, approved)
    deliver(first, approved)  # replay
    assert len(first.sent_text) == 1


def test_a_receipt_for_a_different_action_than_was_requested_is_refused(live):
    session = live()
    request_id = request_desktop_action(session)["policy"]["request_id"]
    deliver(session, host_report(request_id, decision="approved", status="completed", ok=True, verification="verified", action="open_notepad"))
    assert session.sent_text == []
    assert audit_row(session, request_id)["execution_status"] == "awaiting_confirmation"


def test_revoked_desktop_awareness_blocks_the_next_request_before_anything_is_queued(live):
    session = live()
    request_desktop_action(session)
    session.state["screens"] = {"desktop_context": {"enabled": False}}
    envelope = adk_tool("desktop_action")("launch_calculator", context_for(session))
    assert envelope["error"]["code"] == "permission_denied"
    assert sink.drain(session.session_id) == []


# ---- every registered tool goes through the gate ----

def _sample_arguments(schema: dict) -> dict:
    out: dict = {}
    for name in schema["required"]:
        prop = schema["properties"][name]
        if "enum" in prop:
            out[name] = prop["enum"][0]
        elif prop.get("type") == "integer":
            out[name] = 1
        else:
            out[name] = "x"
    return out


def test_every_registered_tool_returns_a_schema_valid_audited_envelope_with_no_grants(live):
    # A session with no consent of any kind. Whatever the model asks for, the answer has the full envelope, the gate
    # leaves one audit row carrying the same request id, and a refused call leaves nothing for the browser.
    for metadata in TOOL_METADATA:
        for attempt, arguments in enumerate(({}, _sample_arguments(tools.REGISTRY[metadata.name].input_schema))):
            session = live(f"sweep-{metadata.name}-{attempt}")
            before = len(session.state.get(AUDIT_STATE_KEY, []))
            envelope = adk_tool(metadata.name)(**arguments, tool_context=context_for(session))
            jsonschema.validate(envelope, tools.REGISTRY[metadata.name].output_schema)
            rows = session.state[AUDIT_STATE_KEY]
            assert len(rows) == before + 1, f"{metadata.name} left no audit row"
            assert rows[-1]["request_id"] == envelope["policy"]["request_id"]
            if envelope["policy"]["decision"] == "deny":
                assert envelope["status"] == "error"
                assert sink.drain(session.session_id) == [], f"{metadata.name} queued an action after a deny"
            if metadata.required_permission != "voice_session":
                assert envelope["policy"]["decision"] != "allow" or envelope["status"] == "error", (
                    f"{metadata.name} needs {metadata.required_permission} but ran with no grant"
                )


def test_no_high_risk_tool_can_ever_be_allowed_without_the_host_approval_boundary():
    # Even a session that has every grant: a high-risk tool is confirmation_required or denied, never allow.
    granted = SimpleNamespace(
        state={
            "page": "home", "screens": {"desktop_context": {"enabled": True}},
            "capture_source": "camera", "capture_generation": 1,
        },
        session=SimpleNamespace(id="all-grants"),
    )
    high = [m for m in TOOL_METADATA if m.risk_level == "high"]
    assert high, "the registry should still have high-risk tools; if not, this test needs a new target"
    for metadata in high:
        decision = POLICY_ENGINE.evaluate(metadata, granted, {"action": "launch_calculator"})
        assert decision.decision in {"confirmation_required", "deny"}, metadata.name


def test_the_high_risk_guard_holds_on_its_own_when_the_permission_would_have_allowed_it():
    # The permission check already stops today's high-risk tools. This pins the second layer: a high-risk tool whose
    # permission is an ordinary voice_session (which allows) must still be refused, so a mislabelled new tool fails closed.
    from dataclasses import replace

    ordinary = next(m for m in TOOL_METADATA if m.name == "show_card")
    session = SimpleNamespace(state={"screens": {}}, session=SimpleNamespace(id="guard"))
    assert POLICY_ENGINE.evaluate(ordinary, session, {}).decision == "allow"
    mislabelled = replace(ordinary, risk_level="high")
    decision = POLICY_ENGINE.evaluate(mislabelled, session, {})
    assert decision.decision == "deny"
    assert "explicit host approval" in decision.reason


def test_the_tools_the_model_can_call_are_exactly_the_registered_ones(live):
    # A tool added to the ADK list without metadata (and so without a policy decision) would be a bypass.
    assert {t.name for t in tools.TOOLS} == tools.REGISTRY.names() == {m.name for m in TOOL_METADATA}
    for tool in tools.TOOLS:
        assert tool.func is not tools.REGISTRY[tool.name].function  # the gateway wraps it; the bare function is not exposed


# ---- memory: write, recall into the model's context, forget ----

def test_memory_reaches_the_model_redacted_and_forgetting_removes_it(tmp_path, monkeypatch, live):
    memory = SQLiteMemoryService(tmp_path / "memory.sqlite3")
    continuity = SQLiteContinuityStore(tmp_path / "continuity.sqlite3")
    monkeypatch.setattr(bridge_module, "memory_service", memory)
    context = ContinuityContext(scope="demo", identity="visitor-1")

    memory.remember("demo", "visitor-1", "Prefers short answers", provenance="said so", explicit=True)
    # Redaction forces a record to sensitive (PRIV-01), and a sensitive record is never put in the model's instruction.
    leaky = memory.remember("demo", "visitor-1", "Reach me at jo@example.com", provenance="said so", explicit=True)
    memory.remember("demo", "visitor-1", "Allergic to penicillin", provenance="said so", sensitivity="sensitive", explicit=True)
    memory.remember("demo", "other-visitor", "Belongs to someone else", provenance="said so", explicit=True)
    assert leaky.sensitivity == "sensitive" and "jo@example.com" not in leaky.content

    session = live("memory-chain", context)
    Bridge(Socket(), session, store=continuity)
    shown = session.state["memory_context"]
    assert "Prefers short answers" in shown            # recall works
    assert "jo@example.com" not in shown and "Reach me" not in shown   # redacted, so sensitive, so withheld
    assert "penicillin" not in shown                   # sensitive records never reach the model's instruction
    assert "someone else" not in shown                 # another identity is invisible
    stored = [r.content for r in memory.recall("demo", "visitor-1", include_sensitive=True)]
    assert not any("jo@example.com" in c for c in stored)   # the value is not on disk either

    counts = forget_identity(memory, continuity, "demo", "visitor-1", explicit=True)
    assert counts["memory_records"] == 3

    again = live("memory-chain-2", context)
    Bridge(Socket(), again, store=continuity)
    assert again.state["memory_context"] == "[]"
    other = live("memory-chain-3", ContinuityContext(scope="demo", identity="other-visitor"))
    Bridge(Socket(), other, store=continuity)
    assert "someone else" in other.state["memory_context"]  # forgetting one identity leaves the other


def test_a_session_without_a_host_identity_gets_no_memory_even_when_records_exist(tmp_path, monkeypatch, live):
    memory = SQLiteMemoryService(tmp_path / "memory.sqlite3")
    monkeypatch.setattr(bridge_module, "memory_service", memory)
    memory.remember("demo", "visitor-1", "Likes tea", provenance="said so", explicit=True)
    session = live("no-identity", None)
    Bridge(Socket(), session, store=SQLiteContinuityStore(tmp_path / "c.sqlite3"))
    assert session.state["memory_context"] == "[]"
