"""Static, reviewed server extensions inside Otto's existing tool/policy chain.

This first slice deliberately supports only namespaced, low-risk read-only functions
and bounded per-session lifecycle hooks. Manifests are Python code: installing one is
a trusted server deployment change, not a sandbox for untrusted third-party packages.
"""
from __future__ import annotations

import asyncio
import inspect
import logging
import re
from dataclasses import dataclass
from functools import wraps
from typing import Any, Callable, get_type_hints

from pydantic import TypeAdapter

from app.voice.policy import KNOWN_PERMISSIONS, KNOWN_RISKS
from app.voice.tool_registry import TOOL_FAMILIES, ToolMetadata

logger = logging.getLogger(__name__)

_EXTENSION_ID = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
_VERSION = re.compile(r"^\d+\.\d+\.\d+$")
_FUNCTION_NAME = re.compile(r"^[a-z][a-z0-9_]{0,63}$")
MAX_TOOLS_PER_EXTENSION = 20
HOOK_TIMEOUT_SECONDS = 2.0
MAX_ACTIVE_SESSIONS = 8


@dataclass(frozen=True)
class ExtensionTool:
    metadata: ToolMetadata
    function: Callable[..., Any]


@dataclass(frozen=True)
class ExtensionManifest:
    """A reviewed extension declaration loaded at server startup."""

    extension_id: str
    version: str
    tools: tuple[ExtensionTool, ...]
    on_session_start: Callable[[str], Any] | None = None
    on_session_end: Callable[[str], Any] | None = None


@dataclass(frozen=True)
class ExtensionLifecycleResult:
    extension_id: str
    hook: str
    success: bool


class ExtensionRegistry:
    """Validate static manifests and isolate each extension's session hooks."""

    def __init__(self, manifests: tuple[ExtensionManifest, ...] | list[ExtensionManifest] = ()) -> None:
        self._manifests = tuple(manifests)
        self._active_sessions: dict[str, frozenset[str]] = {}
        self._validate_manifests()
        self._tools = self._tools_for_registry()

    @property
    def manifests(self) -> tuple[ExtensionManifest, ...]:
        return self._manifests

    def _validate_manifests(self) -> None:
        extension_ids: set[str] = set()
        tool_names: set[str] = set()
        for manifest in self._manifests:
            if not isinstance(manifest, ExtensionManifest):
                raise TypeError("Extension manifests must use ExtensionManifest.")
            if not isinstance(manifest.extension_id, str) or not _EXTENSION_ID.fullmatch(manifest.extension_id):
                raise ValueError("Extension ids must be lowercase kebab-case names.")
            if manifest.extension_id in extension_ids:
                raise ValueError("Extension ids must be unique.")
            extension_ids.add(manifest.extension_id)
            if not isinstance(manifest.version, str) or not _VERSION.fullmatch(manifest.version):
                raise ValueError("Extension versions must use MAJOR.MINOR.PATCH.")
            if not isinstance(manifest.tools, tuple) or not 1 <= len(manifest.tools) <= MAX_TOOLS_PER_EXTENSION:
                raise ValueError(f"An extension must declare 1 to {MAX_TOOLS_PER_EXTENSION} tools as a tuple.")
            self._validate_hook(manifest.on_session_start, "on_session_start")
            self._validate_hook(manifest.on_session_end, "on_session_end")
            for item in manifest.tools:
                self._validate_tool(manifest.extension_id, item, tool_names)
                tool_names.add(item.metadata.name)

    @staticmethod
    def _validate_hook(hook: Callable[[str], Any] | None, name: str) -> None:
        if hook is None:
            return
        if not inspect.iscoroutinefunction(hook):
            raise ValueError(f"{name} must be an async function.")
        signature = inspect.signature(hook)
        parameters = tuple(signature.parameters.values())
        try:
            hints = get_type_hints(hook)
        except (NameError, TypeError) as exc:
            raise ValueError(f"{name} must have resolvable type annotations.") from exc
        if (len(parameters) != 1 or parameters[0].name != "session_id"
                or parameters[0].kind is not inspect.Parameter.POSITIONAL_OR_KEYWORD
                or hints.get("session_id") is not str):
            raise ValueError(f"{name} must accept exactly one typed session_id: str parameter.")

    @staticmethod
    def _validate_tool(extension_id: str, item: ExtensionTool, known_names: set[str]) -> None:
        if not isinstance(item, ExtensionTool) or not isinstance(item.metadata, ToolMetadata):
            raise TypeError("Each extension tool must pair a ToolMetadata entry with a function.")
        metadata, function = item.metadata, item.function
        prefix = f"ext_{extension_id.replace('-', '_')}_"
        if (not isinstance(metadata.name, str) or not metadata.name.startswith(prefix)
                or not _FUNCTION_NAME.fullmatch(metadata.name) or metadata.name in known_names):
            raise ValueError("Extension tool names must be unique and use their extension namespace.")
        if not inspect.isfunction(function) or function.__name__ != metadata.name:
            raise ValueError("An extension tool function name must match its metadata name.")
        if (not isinstance(metadata.description, str) or not 1 <= len(metadata.description) <= 200
                or any(ord(char) < 0x20 for char in metadata.description)):
            raise ValueError("Extension tool descriptions must be plain text between 1 and 200 characters.")
        if metadata.family not in TOOL_FAMILIES:
            raise ValueError("Extension tool family is not recognised.")
        if metadata.risk_level not in KNOWN_RISKS or metadata.risk_level != "low":
            raise ValueError("The first extension slice permits low-risk tools only.")
        if metadata.required_permission not in KNOWN_PERMISSIONS or metadata.required_permission != "voice_session":
            raise ValueError("Extensions must use the existing voice_session permission.")
        if (type(metadata.timeout_seconds) is not int or not 1 <= metadata.timeout_seconds <= 10
                or metadata.supports_async or metadata.verification_required
                or metadata.side_effects or metadata.model_visible_errors):
            raise ValueError("Extensions must be bounded synchronous read-only tools with no declared side effects.")
        if inspect.iscoroutinefunction(function):
            raise ValueError("Extension tools must be synchronous; asynchronous work belongs in a future worker adapter.")

        signature = inspect.signature(function)
        parameters = tuple(signature.parameters.values())
        if not parameters or parameters[-1].name != "tool_context":
            raise ValueError("Extension tool functions must end with a tool_context parameter.")
        try:
            hints = get_type_hints(function)
            if "tool_context" not in hints:
                raise ValueError("tool_context must be annotated.")
            for parameter in parameters:
                if parameter.kind not in (inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY):
                    raise ValueError("Extension tool parameters must be named arguments.")
                if parameter.name != "tool_context":
                    annotation = hints.get(parameter.name)
                    if annotation is None:
                        raise ValueError(f"Extension argument {parameter.name} must be annotated.")
                    try:
                        TypeAdapter(annotation).json_schema()
                    except Exception as exc:  # noqa: BLE001 - unsupported schemas are rejected at registration
                        raise ValueError(f"Extension argument {parameter.name} cannot be represented as a JSON schema.") from exc
        except (NameError, TypeError) as exc:
            raise ValueError("Extension tool argument annotations must produce JSON schemas.") from exc

    def _guarded_function(self, extension_id: str, function: Callable[..., Any]) -> Callable[..., Any]:
        signature = inspect.signature(function)

        @wraps(function)
        def call(*args: Any, **kwargs: Any) -> Any:
            context = kwargs.get("tool_context")
            if context is None and len(args) >= len(signature.parameters):
                context = args[-1]
            session = getattr(context, "session", None)
            session_id = getattr(session, "id", None)
            if not isinstance(session_id, str) or not self.is_active(session_id, extension_id):
                return {"ok": False, "error": "This extension is not active for the current session."}
            return function(*args, **kwargs)

        call.__signature__ = signature  # type: ignore[attr-defined]
        return call

    def _tools_for_registry(self) -> tuple[ExtensionTool, ...]:
        result: list[ExtensionTool] = []
        for manifest in self._manifests:
            for item in manifest.tools:
                guarded = self._guarded_function(manifest.extension_id, item.function)
                result.append(ExtensionTool(item.metadata, guarded))
        return tuple(result)

    def tools(self) -> tuple[ExtensionTool, ...]:
        """Tools ready to combine with built-ins in the one ToolRegistry."""
        return self._tools

    def is_active(self, session_id: str, extension_id: str) -> bool:
        return extension_id in self._active_sessions.get(session_id, frozenset())

    async def start_session(self, session_id: str) -> tuple[ExtensionLifecycleResult, ...]:
        """Run each start hook independently; a failed extension is inactive only for this session."""
        if not isinstance(session_id, str) or not session_id:
            return ()
        if session_id in self._active_sessions:
            return tuple(ExtensionLifecycleResult(key, "start", True)
                         for key in sorted(self._active_sessions[session_id]))
        if len(self._active_sessions) >= MAX_ACTIVE_SESSIONS:
            return tuple(ExtensionLifecycleResult(m.extension_id, "start", False) for m in self._manifests)

        active: set[str] = set()
        # Publish each successful start immediately so cancellation during a later hook
        # still leaves earlier extensions reachable from Bridge.close().
        self._active_sessions[session_id] = frozenset()
        results: list[ExtensionLifecycleResult] = []
        for manifest in self._manifests:
            hook = manifest.on_session_start
            try:
                if hook is not None:
                    await asyncio.wait_for(hook(session_id), timeout=HOOK_TIMEOUT_SECONDS)
                active.add(manifest.extension_id)
                self._active_sessions[session_id] = frozenset(active)
                results.append(ExtensionLifecycleResult(manifest.extension_id, "start", True))
            except Exception as exc:  # noqa: BLE001 - a plugin must not take down a voice session
                logger.warning("Extension %s start hook failed (%s)", manifest.extension_id, type(exc).__name__)
                results.append(ExtensionLifecycleResult(manifest.extension_id, "start", False))
        return tuple(results)

    async def stop_session(self, session_id: str) -> tuple[ExtensionLifecycleResult, ...]:
        """Stop successful extensions in reverse registration order; isolate every end hook."""
        active = self._active_sessions.pop(session_id, frozenset())
        results: list[ExtensionLifecycleResult] = []
        for manifest in reversed(self._manifests):
            if manifest.extension_id not in active:
                continue
            hook = manifest.on_session_end
            if hook is None:
                continue
            try:
                await asyncio.wait_for(hook(session_id), timeout=HOOK_TIMEOUT_SECONDS)
                results.append(ExtensionLifecycleResult(manifest.extension_id, "stop", True))
            except Exception as exc:  # noqa: BLE001 - continue stopping the other extensions
                logger.warning("Extension %s stop hook failed (%s)", manifest.extension_id, type(exc).__name__)
                results.append(ExtensionLifecycleResult(manifest.extension_id, "stop", False))
        return tuple(results)


# Install extensions by adding reviewed manifests here. No filesystem discovery, dynamic
# imports, remote package loading or MCP transport runs implicitly at startup.
EXTENSION_MANIFESTS: tuple[ExtensionManifest, ...] = ()
EXTENSION_REGISTRY = ExtensionRegistry(EXTENSION_MANIFESTS)
