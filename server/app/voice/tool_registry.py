"""Structured, evidence-aware results for Otto's registered ADK tools.

The gateway validates model arguments, calls the existing checked tool function,
and returns a stable envelope. Result status describes tool execution; verification
is a separate field so a successful request is never confused with a verified effect.
Tool functions remain the enforcement points for runtime authority (D-22).
"""
from __future__ import annotations

import inspect
from dataclasses import dataclass
from datetime import datetime, timezone
from functools import wraps
from typing import Any, Callable, get_type_hints

from google.adk.tools import FunctionTool
from pydantic import TypeAdapter, ValidationError


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


# These are descriptive labels, not a permission system. Existing tool functions,
# browser validation and visitor approval remain authoritative.
TOOL_FAMILIES = frozenset({
    "browser", "computer", "files", "screen", "camera",
    "web_research", "memory", "tasks",
})


TOOL_METADATA: tuple[ToolMetadata, ...] = (
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
    ToolMetadata("notice_environmental_observation", "camera", "Propose a bounded attention event from a fresh, actively shared camera frame.", "medium", "active_camera_share", 5, False, True, ("awareness_event_proposal",)),
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
                "status", "data", "evidence", "provenance", "verification",
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
    ) -> dict[str, Any]:
        completed_at = cls._timestamp()
        return {
            "status": status,
            "data": data or {},
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
    def _gateway(cls, function: Callable[..., Any], metadata: ToolMetadata) -> Callable[..., dict[str, Any]]:
        signature = inspect.signature(function)
        hints = get_type_hints(function)
        validators = {
            name: TypeAdapter(hints.get(name, parameter.annotation))
            for name, parameter in signature.parameters.items()
            if name != "tool_context" and parameter.annotation is not inspect.Parameter.empty
        }

        @wraps(function)
        def call(*args: Any, **kwargs: Any) -> dict[str, Any]:
            started_at = cls._timestamp()
            try:
                bound = signature.bind(*args, **kwargs)
                bound.apply_defaults()
                for name, validator in validators.items():
                    if name in bound.arguments:
                        bound.arguments[name] = validator.validate_python(bound.arguments[name])
            except (TypeError, ValidationError):
                # Never echo model-supplied values into an error message or log.
                return cls._envelope(
                    metadata=metadata, status="error", data={},
                    started_at=started_at,
                    error={"code": "invalid_arguments", "message": "Tool arguments did not match the declared schema."},
                )

            try:
                raw_result = function(*bound.args, **bound.kwargs)
            except Exception:
                # Keep implementation details and potentially sensitive arguments out of model-visible errors.
                return cls._envelope(
                    metadata=metadata, status="error", data={},
                    started_at=started_at,
                    error={"code": "tool_execution_error", "message": "The tool could not complete its operation."},
                )

            result = raw_result if isinstance(raw_result, dict) else {"value": raw_result}
            failed = (
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
            return cls._envelope(
                metadata=metadata,
                status="error" if failed else "success",
                data=result,
                started_at=started_at,
                evidence=evidence,
                provenance=provenance,
                verification=verification,
                error=(
                    {"code": "tool_execution_failed", "message": "The tool reported that its operation was not completed."}
                    if failed else None
                ),
            )

        # ADK derives the function declaration from the callable signature.
        call.__signature__ = signature  # type: ignore[attr-defined]
        return call

    def adk_tools(self) -> tuple[FunctionTool, ...]:
        """Build the ADK adapters from this registry; no parallel tool list exists."""
        return tuple(
            FunctionTool(self._gateway(item.function, item.metadata))
            for item in self._tools.values()
        )
