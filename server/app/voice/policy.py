"""Server-side policy decisions for the existing D-22 authority chain.

This module is a check inside the server link, not a runtime orchestrator.
It never executes desktop actions or treats a model proposal as consent.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


AUDIT_STATE_KEY = "tool_policy_audit"
PENDING_STATE_KEY = "tool_policy_pending"
MAX_AUDIT_RECORDS = 50
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


def supports_state(state: object) -> bool:
    """True for the session state a tool really receives: a plain dict, or ADK's `State`, which wraps the session's dict.

    `State` is not a `dict` (it has no `pop` or `del`), so a check for `dict` alone denies every tool in a live session while
    passing every test that builds its context by hand. Every place that reads or writes state goes through this check."""
    return all(callable(getattr(state, name, None)) for name in ("get", "__getitem__", "__setitem__", "__contains__"))


def clear_state_key(state: object, key: str) -> None:
    """Removes `key` from a dict, or empties it on a `State`, which cannot delete. A later `get` sees nothing either way."""
    if isinstance(state, dict):
        state.pop(key, None)
    elif supports_state(state) and key in state:  # type: ignore[operator]
        state[key] = None  # type: ignore[index]


class PermissionPolicy:
    """Resolve the small set of permissions currently represented by the registry."""

    def evaluate(self, permission: str, context: Any) -> tuple[str, str]:
        if context is None or not getattr(getattr(context, "session", None), "id", None):
            return "deny", "A live voice session is required."

        state = getattr(context, "state", None)
        if not supports_state(state):
            return "deny", "Session permission state is unavailable."

        if permission == "voice_session":
            return "allow", "The tool is scoped to the active voice session."

        if permission.startswith("extension:"):
            extension_id = permission.removeprefix("extension:")
            installed = state.get("_installed_extensions")
            if isinstance(installed, (list, tuple, set)) and extension_id in installed:
                return "allow", "The host installed this extension for the current voice session."
            return "deny", "This extension is not installed for the current voice session."

        if permission == "memory_opt_in":
            if state.get("memory_enabled") is True:
                return "allow", "The trusted host identity has enabled identity-scoped memory for this session."
            return "deny", "Persistent memory is not enabled for this session."

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
        if supports_state(state):
            records = state.get(AUDIT_STATE_KEY)
            records = list(records) if isinstance(records, list) else []
            records.append(asdict(record))
            state[AUDIT_STATE_KEY] = records[-MAX_AUDIT_RECORDS:]
            if execution_status == "awaiting_confirmation" and decision.decision == "confirmation_required" and decision.scope and decision.scope.startswith("action:"):
                pending = state.get(PENDING_STATE_KEY)
                pending = dict(pending) if isinstance(pending, dict) else {}
                pending[decision.request_id] = {"tool": record.tool, "action": decision.scope.removeprefix("action:"), "created_at": record.created_at}
                state[PENDING_STATE_KEY] = dict(list(pending.items())[-MAX_AUDIT_RECORDS:])
        return record


class PolicyEngine:
    def __init__(self) -> None:
        self.risk = RiskClassifier()
        self.permissions = PermissionPolicy()
        self.consent = ConsentManager()
        self.verification = VerificationPolicy()
        self.audit_log = AuditLog()

    @staticmethod
    def _scope(metadata: Any, arguments: dict[str, Any]) -> str | None:
        # Record the exact closed desktop action, including the compatibility wrapper.
        if getattr(metadata, "name", None) == "move_desktop":
            mapping = {
                "home": "move_home", "desktop-left": "move_left", "desktop-right": "move_right",
                "top": "move_top", "bottom": "move_bottom",
            }
            destination = arguments.get("destination")
            return f"action:{mapping[destination]}" if destination in mapping else None
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
            scope=self._scope(metadata, arguments),
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
        return self.audit_log.record(context, metadata=metadata, decision=decision, execution_status=execution_status)

    def record_host_result(self, state: Any, report: Any) -> bool:
        """Complete one pending request from a host receipt or a preflight cancellation.

        The OS dialog remains the execution authority. Browser-transported reports
        are audit provenance, not cryptographic attestation or execution authority.
        """
        if not supports_state(state) or not isinstance(report, dict):
            return False
        if set(report) not in (
            {"request_id", "action", "consent_certificate", "result"},
            {"type", "request_id", "action", "consent_certificate", "result"},
        ) or report.get("type", "desktop_result") != "desktop_result":
            return False
        request_id, action = report.get("request_id"), report.get("action")
        certificate, result = report.get("consent_certificate"), report.get("result")
        if not isinstance(request_id, str) or len(request_id) != 32 or any(ch not in "0123456789abcdef" for ch in request_id):
            return False
        if not isinstance(action, str) or not isinstance(result, dict) or set(result) != {"ok", "status", "verification"}:
            return False
        status, ok, verification = result.get("status"), result.get("ok"), result.get("verification")
        if not isinstance(status, str) or status not in {"completed", "started", "failed", "denied"} or type(ok) is not bool:
            return False
        if not isinstance(verification, str) or verification not in {"verified", "native_api_completed", "process_spawned", "not_verified", "unavailable"}:
            return False

        pending = state.get(PENDING_STATE_KEY)
        pending = dict(pending) if isinstance(pending, dict) else {}
        expected = pending.get(request_id)
        if not isinstance(expected, dict) or expected.get("tool") not in {"desktop_action", "move_desktop"} or expected.get("action") != action:
            return False

        if certificate is None:
            # The browser may revoke desktop awareness or lack a native host before
            # the OS dialog is opened. This can only cancel, never approve, a request.
            if status not in {"failed", "denied"} or ok is not False or verification != "unavailable":
                return False
            consent_status = "not_presented"
            certificate_id = method = issued_at = None
            execution_status = "cancelled_before_execution"
            verification_status = "not_run"
            provenance = "browser_preflight_reported"
        else:
            if not isinstance(certificate, dict) or set(certificate) != {
                "certificate_id", "request_id", "action", "decision", "method", "issued_at_unix_ms",
            }:
                return False
            decision, issued_at = certificate.get("decision"), certificate.get("issued_at_unix_ms")
            method, certificate_id = certificate.get("method"), certificate.get("certificate_id")
            if (not isinstance(decision, str) or decision not in {"approved", "denied"}
                or certificate.get("request_id") != request_id or certificate.get("action") != action
                or method != "native_os_dialog" or type(issued_at) is not int or issued_at <= 0
                or not isinstance(certificate_id, str) or certificate_id != f"{request_id}-{issued_at}"):
                return False
            if verification == "verified" and (not ok or status != "completed"):
                return False
            if verification == "process_spawned" and (not ok or status != "started"):
                return False
            if verification == "not_verified" and ok:
                return False
            if (decision == "denied" and (status != "denied" or ok is not False)) or (decision == "approved" and status == "denied"):
                return False
            consent_status = decision
            execution_status = "cancelled" if decision == "denied" else status
            verification_status = (
                "not_run" if decision == "denied" else
                "passed" if verification == "verified" else
                "pending" if verification in {"process_spawned", "native_api_completed"} else
                "failed" if verification == "not_verified" else "not_run"
            )
            provenance = "native_host_reported"

        records = state.get(AUDIT_STATE_KEY)
        records = list(records) if isinstance(records, list) else []
        matched = False
        for record in records:
            if isinstance(record, dict) and record.get("request_id") == request_id:
                record.update({
                    "consent_status": consent_status,
                    "consent_certificate_id": certificate_id,
                    "consent_method": method,
                    "consented_at_unix_ms": issued_at,
                    "execution_status": execution_status,
                    "result_ok": ok,
                    "verification_status": verification_status,
                    "result_provenance": provenance,
                })
                matched = True
                break
        if not matched:
            return False
        pending.pop(request_id, None)
        state[PENDING_STATE_KEY] = pending
        state[AUDIT_STATE_KEY] = records[-MAX_AUDIT_RECORDS:]
        return True



POLICY_ENGINE = PolicyEngine()
