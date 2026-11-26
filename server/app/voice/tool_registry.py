"""The authoritative registry and gateway for Otto's ADK tools.

The registry owns tool metadata and JSON schemas. The gateway validates arguments
before calling the existing checked tool function and wraps every return value in
one stable result envelope. Tool functions remain the enforcement points for
runtime authority (D-22); this module does not introduce an orchestrator.
"""
from __future__ import annotations

import inspect
from dataclasses import dataclass
from functools import wraps
from typing import Any, Callable, get_type_hints

from google.adk.tools import FunctionTool
from pydantic import TypeAdapter, ValidationError

from app.voice.policy import POLICY_ENGINE


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


# These are policy labels, not a second permission system. Existing tool
# functions and the browser remain authoritative for consent and action checks.
# The canonical capability taxonomy. A family is populated only when a real,
# permission-bounded implementation is registered; no placeholder tools are exposed.
TOOL_FAMILIES = frozenset({
    "browser", "computer", "files", "screen", "camera",
    "web_research", "memory", "tasks",
})


TOOL_METADATA: tuple[ToolMetadata, ...] = (
    ToolMetadata("navigate_to", "browser", "Navigate to a known page or reported destination.", "medium", "voice_session", 10, False, False),
    ToolMetadata("explain_page", "browser", "Explain a known page and its usage.", "low", "voice_session", 5, False, False),
    ToolMetadata("get_screen_context", "screen", "Read the current page and its reported context.", "low", "voice_session", 5, False, False),
    ToolMetadata("get_perception_context", "camera", "Read metadata from an actively shared camera or screen observation.", "medium", "active_capture", 5, False, False),
    ToolMetadata("get_desktop_context", "computer", "Read limited desktop metadata when desktop awareness is enabled.", "medium", "desktop_awareness", 5, False, False),
    ToolMetadata("run_command", "browser", "Run a command from the app's known command list.", "medium", "voice_session", 10, False, False),
    ToolMetadata("show_target", "browser", "Point to a target reported by the current page.", "low", "voice_session", 10, False, False),
    ToolMetadata("start_guided_task", "tasks", "Start a task reported by the current page.", "medium", "voice_session", 10, False, False),
    ToolMetadata("move_guided_task", "tasks", "Move or stop the currently running guided task.", "medium", "voice_session", 10, False, False),
    ToolMetadata("move_desktop", "computer", "Request a permission-gated move of Otto on the desktop.", "high", "desktop_action_approval", 15, False, True),
    ToolMetadata("desktop_action", "computer", "Request an allow-listed, user-approved desktop action.", "high", "desktop_action_approval", 15, False, True),
    ToolMetadata("show_card", "browser", "Show bounded plain text in the voice panel.", "low", "voice_session", 5, False, False),
    ToolMetadata("notice_environmental_observation", "camera", "Propose a bounded attention event from a fresh, actively shared camera frame.", "medium", "active_camera_share", 5, False, True),
)


@dataclass(frozen=True)
class RegisteredTool:
    metadata: ToolMetadata
    function: Callable[..., Any]
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]


class ToolRegistry:
    """Immutable name-to-tool registry plus the validated ADK gateway."""

    def __init__(self, functions: tuple[Callable[..., Any], ...] | list[Callable[..., Any]]) -> None:
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
            },
            "required": ["status", "data", "policy"],
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
    def _gateway(function: Callable[..., Any], metadata: ToolMetadata | None = None) -> Callable[..., dict[str, Any]]:
        signature = inspect.signature(function)
        hints = get_type_hints(function)
        metadata = metadata or next((item for item in TOOL_METADATA if item.name == function.__name__), None)
        if metadata is None:
            raise ValueError(f"No policy metadata registered for {function.__name__}")
        validators = {
            name: TypeAdapter(hints.get(name, parameter.annotation))
            for name, parameter in signature.parameters.items()
            if name != "tool_context" and parameter.annotation is not inspect.Parameter.empty
        }

        @wraps(function)
        def call(*args: Any, **kwargs: Any) -> dict[str, Any]:
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
                return {
                    "status": "error",
                    "data": {"code": "invalid_arguments", "message": "Tool arguments did not match the declared schema."},
                    "policy": decision.as_dict(),
                }

            context = bound.arguments.get("tool_context")
            decision = POLICY_ENGINE.evaluate(metadata, context, bound.arguments)
            if decision.decision == "deny":
                POLICY_ENGINE.audit(context, metadata, decision, "denied")
                return {
                    "status": "error",
                    "data": {"code": "permission_denied", "message": "The tool request was not permitted by session policy."},
                    "policy": decision.as_dict(),
                }

            try:
                result = function(*bound.args, **bound.kwargs)
            except Exception:
                POLICY_ENGINE.audit(context, metadata, decision, "failed")
                return {
                    "status": "error",
                    "data": {"code": "tool_failed", "message": "The tool could not complete the request."},
                    "policy": decision.as_dict(),
                }

            failed = (
                isinstance(result, dict)
                and (result.get("ok") is False or result.get("accepted") is False or "error" in result)
            )
            awaiting_approval = isinstance(result, dict) and result.get("status") == "awaiting_user_approval"
            execution_status = (
                "awaiting_confirmation" if awaiting_approval or decision.decision == "confirmation_required"
                else "failed" if failed else "returned"
            )
            POLICY_ENGINE.audit(context, metadata, decision, execution_status)
            return {
                "status": "error" if failed else "success",
                "data": result,
                "policy": decision.as_dict(),
            }

        # ADK derives the function declaration from the callable signature.
        call.__signature__ = signature  # type: ignore[attr-defined]
        return call

    def adk_tools(self) -> tuple[FunctionTool, ...]:
        """Build the ADK adapters from this registry; no parallel tool list exists."""
        return tuple(FunctionTool(self._gateway(item.function, item.metadata)) for item in self._tools.values())
