"""Structured, evidence-aware results for Otto's registered ADK tools.

The gateway validates model arguments, calls the existing checked tool function,
and returns a stable envelope. Result status describes tool execution; verification
is a separate field so a successful request is never confused with a verified effect.
Tool functions remain the enforcement points for runtime authority (D-22).
"""
from __future__ import annotations

import asyncio
import inspect
import logging
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Callable, get_type_hints

from google.adk.tools import FunctionTool, ToolContext
from pydantic import TypeAdapter, ValidationError

from app.voice.policy import POLICY_ENGINE, clear_state_key, supports_state


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ToolMetadata:
    name: str
    family: str
    description: str
    risk_level: str
    required_permission: str
    timeout_seconds: int
    supports_async: bool
    verification_required: bool
    side_effects: tuple[str, ...] = ()
    #: The tool's own `error` text is reviewed to be safe for the model to read (it says how to correct the call). Off by
    #: default: an unreviewed tool's error text is dropped from `data`, and the envelope's `error` carries a code instead.
    model_visible_errors: bool = False


# These are descriptive labels, not a permission system. Existing tool functions,
# browser validation and visitor approval remain authoritative.
TOOL_FAMILIES = frozenset({
    "browser", "computer", "files", "screen", "camera",
    "web_research", "memory", "tasks", "extension",
})


_FIRST_PARTY_METADATA: tuple[ToolMetadata, ...] = (
    ToolMetadata("navigate_to", "browser", "Navigate to a known page or reported destination.", "medium", "voice_session", 10, False, False, ("browser_navigation",)),
    ToolMetadata("explain_page", "browser", "Explain a known page and its usage.", "low", "voice_session", 5, False, False),
    ToolMetadata("get_screen_context", "screen", "Read the current page and its reported context.", "low", "voice_session", 5, False, False),
    ToolMetadata("get_perception_context", "camera", "Read metadata from an actively shared camera or screen observation.", "medium", "active_capture", 5, False, False),
    ToolMetadata("get_desktop_context", "computer", "Read limited desktop metadata when desktop awareness is enabled.", "medium", "desktop_awareness", 5, False, False),
    ToolMetadata("run_command", "browser", "Run a command from the app's known command list.", "medium", "voice_session", 10, False, False, ("browser_command",)),
    ToolMetadata("show_target", "browser", "Point to a target reported by the current page.", "low", "voice_session", 10, False, False, ("visual_pointer",)),
    ToolMetadata("start_guided_task", "tasks", "Start a task reported by the current page.", "medium", "voice_session", 10, False, False, ("guided_task_start",)),
    ToolMetadata("move_guided_task", "tasks", "Move or stop the currently running guided task.", "medium", "voice_session", 10, False, False, ("guided_task_control",)),
    ToolMetadata("move_desktop", "computer", "Request a permission-gated move of Otto on the desktop.", "high", "desktop_action_approval", 15, False, True, ("desktop_action_request",)),
    ToolMetadata("desktop_action", "computer", "Request an allow-listed, user-approved desktop action.", "high", "desktop_action_approval", 15, False, True, ("desktop_action_request",)),
    ToolMetadata("show_card", "browser", "Show bounded plain text in the voice panel.", "low", "voice_session", 5, False, False, ("voice_panel_card",)),
    ToolMetadata("get_background_tasks", "tasks", "Read the status of the server's background tasks.", "low", "voice_session", 5, False, False),
    ToolMetadata("notice_environmental_observation", "camera", "Propose a bounded attention event from a fresh, actively shared camera frame.", "medium", "active_camera_share", 5, False, True, ("awareness_event_proposal",)),
    ToolMetadata("propose_memory", "memory", "Ask the visitor to confirm saving one fact they explicitly asked Otto to remember.", "medium", "memory_opt_in", 5, False, False, ("memory_proposal",)),
)

# Every tool above is first-party, and its error strings are written for the model to read.
TOOL_METADATA: tuple[ToolMetadata, ...] = tuple(replace(item, model_visible_errors=True) for item in _FIRST_PARTY_METADATA)


@dataclass(frozen=True)
class RegisteredTool:
    metadata: ToolMetadata
    function: Callable[..., Any]
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]


class ToolRegistry:
    """Immutable name-to-tool registry plus the validated ADK gateway."""

    def __init__(
        self,
        functions: tuple[Callable[..., Any], ...] | list[Callable[..., Any]],
        *,
        additional_tools: tuple[tuple[ToolMetadata, Callable[..., Any]], ...] | list[tuple[ToolMetadata, Callable[..., Any]]] = (),
    ) -> None:
        by_name = {fn.__name__: fn for fn in functions}
        if len(by_name) != len(functions):
            raise ValueError("Tool function names must be unique")
        metadata_by_name = {item.name: item for item in TOOL_METADATA}
        if len(metadata_by_name) != len(TOOL_METADATA):
            raise ValueError("Tool metadata names must be unique")
        if set(by_name) != set(metadata_by_name):
            missing = sorted(set(by_name) - set(metadata_by_name))
            stale = sorted(set(metadata_by_name) - set(by_name))
            raise ValueError(f"Tool registry mismatch; missing metadata={missing}, missing functions={stale}")

        # The built-in function/metadata parity remains exact. Runtime extensions are
        # appended only by the bridge and are individually constrained to low-risk,
        # read-only, async tools with a namespaced host allow-list permission.
        for metadata, function in additional_tools:
            if not isinstance(metadata, ToolMetadata) or not callable(function):
                raise ValueError("Additional tools need valid metadata and a callable")
            name = metadata.name
            if name != getattr(function, "__name__", None) or name in by_name:
                raise ValueError("Additional tool names must be unique and match their function")
            if (
                metadata.family != "extension"
                or metadata.risk_level != "low"
                or not metadata.required_permission.startswith("extension:")
                or metadata.side_effects
                or metadata.verification_required
                or not metadata.supports_async
                or not inspect.iscoroutinefunction(function)
                or not 1 <= metadata.timeout_seconds <= 10
            ):
                raise ValueError("Extensions may register only bounded, read-only async tools")
            by_name[name] = function
            metadata_by_name[name] = metadata

        self._tools = {
            name: RegisteredTool(
                metadata=metadata_by_name[name],
                function=fn,
                input_schema=self._input_schema(fn),
                output_schema=self._output_schema(),
            )
            for name, fn in by_name.items()
        }

    @staticmethod
    def _input_schema(function: Callable[..., Any]) -> dict[str, Any]:
        signature = inspect.signature(function)
        hints = get_type_hints(function)
        properties: dict[str, Any] = {}
        required: list[str] = []
        for name, parameter in signature.parameters.items():
            if name == "tool_context":
                continue
            annotation = hints.get(name, parameter.annotation)
            if annotation is inspect.Parameter.empty:
                raise TypeError(f"{function.__name__}.{name} needs an input annotation")
            properties[name] = TypeAdapter(annotation).json_schema()
            if parameter.default is inspect.Parameter.empty:
                required.append(name)
        return {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        }

    @staticmethod
    def _output_schema() -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["success", "error"]},
                "data": {"type": "object"},
                "policy": {
                    "type": "object",
                    "properties": {
                        "request_id": {"type": "string"},
                        "decision": {"type": "string", "enum": ["allow", "confirmation_required", "deny"]},
                        "risk_level": {"type": "string", "enum": ["low", "medium", "high", "invalid"]},
                        "required_permission": {"type": "string"},
                        "reason": {"type": "string"},
                        "scope": {"type": ["string", "null"]},
                        "verification_status": {"type": "string", "enum": ["pending", "not_required"]},
                    },
                    "required": ["request_id", "decision", "risk_level", "required_permission", "reason", "scope", "verification_status"],
                    "additionalProperties": False,
                },
                "evidence": {"type": "array", "items": {"type": "object"}},
                "provenance": {"type": "object"},
                "verification": {
                    "type": "object",
                    "properties": {
                        "required": {"type": "boolean"},
                        "status": {"type": "string", "enum": ["not_required", "pending", "passed", "failed", "not_run"]},
                        "details": {"type": ["string", "null"]},
                    },
                    "required": ["required", "status", "details"],
                    "additionalProperties": False,
                },
                "error": {"type": ["object", "null"]},
                "timestamps": {
                    "type": "object",
                    "properties": {
                        "started_at": {"type": "string", "format": "date-time"},
                        "completed_at": {"type": "string", "format": "date-time"},
                    },
                    "required": ["started_at", "completed_at"],
                    "additionalProperties": False,
                },
                "side_effects": {"type": "array", "items": {"type": "string"}},
            },
            "required": [
                "status", "data", "policy", "evidence", "provenance", "verification",
                "error", "timestamps", "side_effects",
            ],
            "additionalProperties": False,
        }

    def __contains__(self, name: str) -> bool:
        return name in self._tools

    def __getitem__(self, name: str) -> RegisteredTool:
        return self._tools[name]

    def names(self) -> frozenset[str]:
        return frozenset(self._tools)

    def metadata(self) -> tuple[ToolMetadata, ...]:
        return tuple(item.metadata for item in self._tools.values())

    @staticmethod
    def _timestamp() -> str:
        return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

    @classmethod
    def _envelope(
        cls,
        *,
        metadata: ToolMetadata,
        status: str,
        data: dict[str, Any] | None,
        started_at: str,
        evidence: list[dict[str, Any]] | None = None,
        provenance: dict[str, Any] | None = None,
        verification: dict[str, Any] | None = None,
        error: dict[str, str] | None = None,
        policy: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        completed_at = cls._timestamp()
        return {
            "status": status,
            "data": data or {},
            "policy": policy or {},
            "evidence": evidence or [],
            "provenance": provenance or {"tool": metadata.name, "source": "registered_tool"},
            "verification": verification or {
                "required": metadata.verification_required,
                "status": "pending" if status == "success" and metadata.verification_required else (
                    "not_run" if status == "error" and metadata.verification_required else "not_required"
                ),
                "details": None,
            },
            "error": error,
            "timestamps": {"started_at": started_at, "completed_at": completed_at},
            "side_effects": list(metadata.side_effects),
        }

    @classmethod
    def _gateway(cls, function: Callable[..., Any], metadata: ToolMetadata) -> Callable[..., Any]:
        signature = inspect.signature(function)
        hints = get_type_hints(function)
        validators = {
            name: TypeAdapter(hints.get(name, parameter.annotation))
            for name, parameter in signature.parameters.items()
            if name != "tool_context" and parameter.annotation is not inspect.Parameter.empty
        }
        # ADK injects ToolContext by type, not just by the conventional parameter name.
        # Extension callbacks never see this object; only this gateway receives it for policy checks.
        if "tool_context" in signature.parameters and signature.parameters["tool_context"].annotation is object:
            signature = signature.replace(parameters=[
                parameter.replace(annotation=ToolContext) if parameter.name == "tool_context" else parameter
                for parameter in signature.parameters.values()
            ])
        is_async = inspect.iscoroutinefunction(function)

        def prepare(args: tuple[Any, ...], kwargs: dict[str, Any], started_at: str):
            context = None
            try:
                bound = signature.bind(*args, **kwargs)
                bound.apply_defaults()
                context = bound.arguments.get("tool_context")
                for name, validator in validators.items():
                    if name in bound.arguments:
                        bound.arguments[name] = validator.validate_python(bound.arguments[name])
            except (TypeError, ValidationError):
                if context is None:
                    try:
                        context = signature.bind_partial(*args, **kwargs).arguments.get("tool_context")
                    except TypeError:
                        context = kwargs.get("tool_context")
                decision = POLICY_ENGINE.invalid_arguments(metadata)
                POLICY_ENGINE.audit(context, metadata, decision, "denied")
                return cls._envelope(
                    metadata=metadata, status="error", data={}, started_at=started_at,
                    error={"code": "invalid_arguments", "message": "Tool arguments did not match the declared schema."},
                    policy=decision.as_dict(),
                )

            context = bound.arguments.get("tool_context")
            decision = POLICY_ENGINE.evaluate(metadata, context, bound.arguments)
            if decision.decision == "deny":
                POLICY_ENGINE.audit(context, metadata, decision, "denied")
                return cls._envelope(
                    metadata=metadata, status="error", data={}, started_at=started_at,
                    error={"code": "permission_denied", "message": "The tool request was not permitted by session policy."},
                    policy=decision.as_dict(),
                )
            state = getattr(context, "state", None)
            previous_policy = state.get("_active_policy_decision") if supports_state(state) else None
            if supports_state(state):
                state["_active_policy_decision"] = decision.as_dict()
            return bound, context, decision, state, previous_policy

        def restore(state: Any, previous_policy: Any) -> None:
            if supports_state(state):
                if previous_policy is None:
                    clear_state_key(state, "_active_policy_decision")
                else:
                    state["_active_policy_decision"] = previous_policy

        def failed(context: Any, decision: Any, started_at: str, exc: BaseException) -> dict[str, Any]:
            # Log only the tool name and exception class; never exception text or arguments.
            logger.error("Registered tool %s raised %s", metadata.name, type(exc).__name__)
            POLICY_ENGINE.audit(context, metadata, decision, "failed")
            return cls._envelope(
                metadata=metadata, status="error", data={}, started_at=started_at,
                error={"code": "tool_execution_error", "message": "The tool could not complete its operation."},
                policy=decision.as_dict(),
            )

        def finish(raw_result: Any, context: Any, decision: Any, started_at: str) -> dict[str, Any]:
            result = raw_result if isinstance(raw_result, dict) else {"value": raw_result}
            failed_result = (
                result.get("ok") is False
                or result.get("accepted") is False
                or "error" in result
            )
            supplied_verification = result.get("verification")
            verification = None
            if isinstance(supplied_verification, dict):
                verification_status = supplied_verification.get("status")
                if verification_status in {"not_required", "pending", "passed", "failed", "not_run"}:
                    verification = {
                        "required": metadata.verification_required,
                        "status": verification_status,
                        "details": supplied_verification.get("details") if isinstance(supplied_verification.get("details"), str) else None,
                    }

            evidence = result.get("evidence") if isinstance(result.get("evidence"), list) else []
            provenance = result.get("provenance") if isinstance(result.get("provenance"), dict) else None
            execution_status = (
                "failed" if failed_result else
                "awaiting_confirmation" if decision.decision == "confirmation_required" else
                "returned"
            )
            POLICY_ENGINE.audit(context, metadata, decision, execution_status)
            return cls._envelope(
                metadata=metadata,
                status="error" if failed_result else "success",
                # An unreviewed tool's error text may be internal detail; the envelope carries a safe code instead.
                data={k: v for k, v in result.items() if k != "error"} if failed_result and not metadata.model_visible_errors else result,
                started_at=started_at,
                evidence=evidence,
                provenance=provenance,
                verification=verification,
                error=(
                    {"code": "tool_execution_failed", "message": "The tool reported that its operation was not completed."}
                    if failed_result else None
                ),
                policy=decision.as_dict(),
            )

        if is_async:
            @wraps(function)
            async def async_call(*args: Any, **kwargs: Any) -> dict[str, Any]:
                started_at = cls._timestamp()
                prepared = prepare(args, kwargs, started_at)
                if isinstance(prepared, dict):
                    return prepared
                bound, context, decision, state, previous_policy = prepared
                try:
                    raw_result = await asyncio.wait_for(
                        function(*bound.args, **bound.kwargs),
                        timeout=metadata.timeout_seconds,
                    )
                except asyncio.CancelledError:
                    POLICY_ENGINE.audit(context, metadata, decision, "cancelled")
                    raise
                except Exception as exc:
                    return failed(context, decision, started_at, exc)
                finally:
                    restore(state, previous_policy)
                return finish(raw_result, context, decision, started_at)

            async_call.__signature__ = signature  # type: ignore[attr-defined]
            annotations = dict(getattr(async_call, "__annotations__", {}))
            if "tool_context" in signature.parameters:
                annotations["tool_context"] = ToolContext
            async_call.__annotations__ = annotations
            return async_call

        @wraps(function)
        def call(*args: Any, **kwargs: Any) -> dict[str, Any]:
            started_at = cls._timestamp()
            prepared = prepare(args, kwargs, started_at)
            if isinstance(prepared, dict):
                return prepared
            bound, context, decision, state, previous_policy = prepared
            try:
                raw_result = function(*bound.args, **bound.kwargs)
            except Exception as exc:
                return failed(context, decision, started_at, exc)
            finally:
                restore(state, previous_policy)
            return finish(raw_result, context, decision, started_at)

        # ADK derives the function declaration from the callable signature.
        call.__signature__ = signature  # type: ignore[attr-defined]
        annotations = dict(getattr(call, "__annotations__", {}))
        if "tool_context" in signature.parameters:
            annotations["tool_context"] = ToolContext
        call.__annotations__ = annotations
        return call

    def adk_tools(self) -> tuple[FunctionTool, ...]:
        """Build the ADK adapters from this registry; no parallel tool list exists."""
        return tuple(
            FunctionTool(self._gateway(item.function, item.metadata))
            for item in self._tools.values()
        )
