"""Server-side policy decisions for the existing D-22 authority chain.

This module is a check inside the server link, not a runtime orchestrator.
It never executes desktop actions or treats a model proposal as consent.
"""
from __future__ import annotations

from contextvars import ContextVar, Token
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


AUDIT_STATE_KEY = "tool_policy_audit"
MAX_AUDIT_RECORDS = 50
_CURRENT_REQUEST_ID: ContextVar[str | None] = ContextVar("otto_policy_request_id", default=None)


def bind_request_id(request_id: str) -> Token[str | None]:
    return _CURRENT_REQUEST_ID.set(request_id)


def reset_request_id(token: Token[str | None]) -> None:
    _CURRENT_REQUEST_ID.reset(token)


def current_request_id() -> str | None:
    return _CURRENT_REQUEST_ID.get()
KNOWN_RISKS = frozenset({"low", "medium", "high"})


@dataclass(frozen=True)
class PolicyDecision:
    request_id: str
    decision: str
    risk_level: str
    required_permission: str
    reason: str
    scope: str | None
    verification_status: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class AuthorizationRecord:
    request_id: str
    tool: str
    decision: str
    risk_level: str
    required_permission: str
    scope: str | None
    execution_status: str
    verification_status: str
    created_at: str


class RiskClassifier:
    """Use reviewed registry metadata; never infer authority from model-supplied text."""

    def classify(self, metadata: Any) -> str:
        risk = getattr(metadata, "risk_level", None)
        return risk if risk in KNOWN_RISKS else "invalid"


class PermissionPolicy:
    """Resolve the small set of permissions currently represented by the registry."""

    def evaluate(self, permission: str, context: Any) -> tuple[str, str]:
        if context is None or not getattr(getattr(context, "session", None), "id", None):
            return "deny", "A live voice session is required."

        state = getattr(context, "state", None)
        if not isinstance(state, dict):
            return "deny", "Session permission state is unavailable."

        if permission == "voice_session":
            return "allow", "The tool is scoped to the active voice session."

        if permission == "active_capture":
            if state.get("capture_source") in {"camera", "screen"}:
                return "allow", "The visitor is actively sharing a capture source."
            return "deny", "An active camera or screen share is required."

        if permission == "active_camera_share":
            if state.get("capture_source") == "camera":
                return "allow", "The visitor is actively sharing the camera."
            return "deny", "An active camera share is required."

        if permission == "desktop_awareness":
            screens = state.get("screens")
            desktop = screens.get("desktop_context") if isinstance(screens, dict) else None
            if isinstance(desktop, dict) and desktop.get("enabled") is True:
                return "allow", "Desktop awareness is enabled for this session."
            return "deny", "The visitor has not enabled desktop awareness."

        if permission == "desktop_action_approval":
            screens = state.get("screens")
            desktop = screens.get("desktop_context") if isinstance(screens, dict) else None
            if not isinstance(desktop, dict) or desktop.get("enabled") is not True:
                return "deny", "The visitor has not enabled desktop awareness."
            return "confirmation_required", "The exact action must be approved in the desktop UI."

        return "deny", "The tool declares an unrecognized permission."


class ConsentManager:
    """Keep consent at the host boundary that actually presents the approval UI.

    A confirmation-required decision permits only dispatching a request to that
    UI. It is not a grant and does not authorize the desktop/native operation.
    """

    def decision(self, permission_decision: str) -> str:
        return "confirmation_required" if permission_decision == "confirmation_required" else permission_decision


class VerificationPolicy:
    def status(self, metadata: Any) -> str:
        return "pending" if getattr(metadata, "verification_required", False) else "not_required"


class AuditLog:
    """Store a bounded, session-local audit trail without tool arguments or user content."""

    def record(
        self,
        context: Any,
        *,
        metadata: Any,
        decision: PolicyDecision,
        execution_status: str,
    ) -> AuthorizationRecord:
        record = AuthorizationRecord(
            request_id=decision.request_id,
            tool=str(getattr(metadata, "name", "unknown")),
            decision=decision.decision,
            risk_level=decision.risk_level,
            required_permission=decision.required_permission,
            scope=decision.scope,
            execution_status=execution_status,
            verification_status=decision.verification_status,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        state = getattr(context, "state", None)
        if isinstance(state, dict):
            records = state.get(AUDIT_STATE_KEY)
            records = list(records) if isinstance(records, list) else []
            records.append(asdict(record))
            state[AUDIT_STATE_KEY] = records[-MAX_AUDIT_RECORDS:]
        return record

    def record_outcome(self, context: Any, outcome: Any) -> bool:
        """Attach a validated, host-reported desktop result to its exact pending request."""
        if not isinstance(outcome, dict):
            return False
        request_id, action = outcome.get("request_id"), outcome.get("action")
        ok, status, verification = outcome.get("ok"), outcome.get("status"), outcome.get("verification")
        if (not isinstance(request_id, str) or len(request_id) != 32
                or any(char not in "0123456789abcdef" for char in request_id)
                or not isinstance(action, str) or not isinstance(ok, bool)
                or status not in {"completed", "started", "failed", "denied"}
                or verification not in {"verified", "native_api_completed", "process_spawned", "not_verified", "unavailable"}):
            return False
        state = getattr(context, "state", None)
        records = state.get(AUDIT_STATE_KEY) if isinstance(state, dict) else None
        if not isinstance(records, list):
            return False
        record = next((item for item in reversed(records)
                       if isinstance(item, dict) and item.get("request_id") == request_id), None)
        if (record is None or record.get("tool") not in {"desktop_action", "move_desktop"}
                or record.get("decision") != "confirmation_required"
                or record.get("execution_status") != "awaiting_confirmation"
                or record.get("scope") != f"action:{action}"
                or record.get("outcome_received") is True):
            return False
        record["execution_status"] = status if ok else ("denied" if status == "denied" else "failed")
        record["verification_result"] = verification
        record["verification_status"] = {
            "verified": "passed",
            "not_verified": "failed",
            "unavailable": "not_run",
            "native_api_completed": "pending",
            "process_spawned": "pending",
        }[verification]
        record["outcome_received"] = True
        record["outcome_source"] = "host_reported"
        return True


class PolicyEngine:
    def __init__(self) -> None:
        self.risk = RiskClassifier()
        self.permissions = PermissionPolicy()
        self.consent = ConsentManager()
        self.verification = VerificationPolicy()
        self.audit_log = AuditLog()

    @staticmethod
    def _scope(arguments: dict[str, Any]) -> str | None:
        # Only action identifiers are recorded; never persist arbitrary arguments.
        for key in ("action", "destination", "command", "move"):
            value = arguments.get(key)
            if isinstance(value, str) and 0 < len(value) <= 80:
                return f"{key}:{value}"
        return None

    def evaluate(self, metadata: Any, context: Any, arguments: dict[str, Any]) -> PolicyDecision:
        risk = self.risk.classify(metadata)
        permission = str(getattr(metadata, "required_permission", ""))
        verification = self.verification.status(metadata)
        request_id = uuid4().hex
        if risk == "invalid":
            return PolicyDecision(request_id, "deny", risk, permission, "The tool risk classification is invalid.", None, verification)

        permission_decision, reason = self.permissions.evaluate(permission, context)
        decision = self.consent.decision(permission_decision)
        if risk == "high" and decision != "confirmation_required":
            decision = "deny"
            reason = "High-risk tools must use the explicit host approval boundary."
        return PolicyDecision(
            request_id=request_id,
            decision=decision,
            risk_level=risk,
            required_permission=permission,
            reason=reason,
            scope=self._scope(arguments),
            verification_status=verification,
        )

    def invalid_arguments(self, metadata: Any) -> PolicyDecision:
        return PolicyDecision(
            request_id=uuid4().hex,
            decision="deny",
            risk_level=self.risk.classify(metadata),
            required_permission=str(getattr(metadata, "required_permission", "")),
            reason="The tool arguments did not match the registered schema.",
            scope=None,
            verification_status=self.verification.status(metadata),
        )

    def audit(self, context: Any, metadata: Any, decision: PolicyDecision, execution_status: str) -> AuthorizationRecord:
        return self.audit_log.record(
            context, metadata=metadata, decision=decision, execution_status=execution_status
        )

    def audit_outcome(self, context: Any, outcome: Any) -> bool:
        return self.audit_log.record_outcome(context, outcome)


POLICY_ENGINE = PolicyEngine()
