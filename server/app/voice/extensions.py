"""Trusted, bounded extension contracts for Otto (EXT-01, D-19, D-22).

This module discovers nothing and imports no plugin code. The host explicitly supplies
trusted manifests. Extension handlers are read-only in this first slice; ToolRegistry
wraps each call in Otto's existing policy gateway.
"""
from __future__ import annotations

import asyncio
import inspect
import re
import types
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Literal, Union, get_args, get_origin, get_type_hints

ExtensionKind = Literal["skill", "plugin", "mcp"]
ExtensionLifecycle = Literal["active", "disabled", "stopped"]

MAX_EXTENSIONS = 12
MAX_TOOLS_PER_EXTENSION = 8
MAX_EXTENSION_TOOLS = 32
MAX_EXTENSION_ID_CHARS = 24
MAX_TOOL_NAME_CHARS = 32
MAX_DESCRIPTION_CHARS = 200
MAX_TOOL_TIMEOUT_SECONDS = 10
DEFAULT_LIFECYCLE_TIMEOUT_SECONDS = 5.0

_EXTENSION_ID = re.compile(r"^[a-z][a-z0-9_]{1,23}$")
_TOOL_NAME = re.compile(r"^[a-z][a-z0-9_]{0,31}$")


@dataclass(frozen=True)
class ExtensionToolSpec:
    """One async, read-only handler. No ToolContext or authority object is exposed."""

    name: str
    description: str
    handler: Callable[..., Awaitable[Any]]
    timeout_seconds: int = 5


@dataclass(frozen=True)
class ExtensionManifest:
    """A host-authored declaration for a trusted installed package."""

    extension_id: str
    kind: ExtensionKind
    version: str
    description: str
    tools: tuple[ExtensionToolSpec, ...]
    on_start: Callable[[], Awaitable[None]] | None = None
    on_stop: Callable[[], Awaitable[None]] | None = None


@dataclass(frozen=True)
class ExtensionStatus:
    extension_id: str
    kind: str
    status: ExtensionLifecycle
    reason: str | None = None


@dataclass(frozen=True)
class AvailableExtensionTool:
    """A validated tool descriptor ready for the existing ToolRegistry."""

    name: str
    description: str
    extension_id: str
    kind: ExtensionKind
    timeout_seconds: int
    handler: Callable[..., Awaitable[Any]]

    def as_function(self) -> Callable[..., Awaitable[Any]]:
        """Create an ADK-shaped callable; its ToolContext is removed before plugin code runs."""
        original = inspect.signature(self.handler)
        hints = get_type_hints(self.handler)
        context_parameter = inspect.Parameter(
            "tool_context", inspect.Parameter.KEYWORD_ONLY, annotation=Any
        )
        signature = original.replace(
            parameters=[*original.parameters.values(), context_parameter],
            return_annotation=Any,
        )

        async def invoke(**kwargs: Any) -> Any:
            kwargs.pop("tool_context", None)
            return await self.handler(**kwargs)

        invoke.__name__ = self.name
        invoke.__qualname__ = self.name
        invoke.__doc__ = self.description
        invoke.__signature__ = signature  # type: ignore[attr-defined]
        invoke.__annotations__ = {
            **{name: hints.get(name, parameter.annotation) for name, parameter in original.parameters.items()},
            "tool_context": Any,
            "return": Any,
        }
        return invoke


def _json_annotation(annotation: object) -> bool:
    """Keep manifests to data types that have predictable JSON tool schemas."""
    if annotation in (str, int, float, bool):
        return True
    origin = get_origin(annotation)
    args = get_args(annotation)
    if origin is Literal:
        return bool(args) and all(type(value) in (str, int, float, bool) for value in args)
    if origin in (Union, types.UnionType):
        return bool(args) and all(_json_annotation(item) or item is type(None) for item in args)
    if origin in (list, tuple):
        return len(args) in (1, 2) and all(_json_annotation(item) for item in args if item is not Ellipsis)
    if origin is dict:
        return len(args) == 2 and args[0] is str and _json_annotation(args[1])
    return False


def _validate_hook(hook: object) -> bool:
    return hook is None or (callable(hook) and inspect.iscoroutinefunction(hook)
                            and len(inspect.signature(hook).parameters) == 0)


class ExtensionManager:
    """Explicit manifest registry with per-extension lifecycle and failure isolation."""

    def __init__(
        self,
        manifests: tuple[ExtensionManifest, ...] | list[ExtensionManifest] = (),
        *,
        lifecycle_timeout_seconds: float = DEFAULT_LIFECYCLE_TIMEOUT_SECONDS,
    ) -> None:
        if isinstance(lifecycle_timeout_seconds, bool) or not isinstance(lifecycle_timeout_seconds, (int, float)):
            raise ValueError("Lifecycle timeout must be between 0 and 30 seconds")
        if not 0 < float(lifecycle_timeout_seconds) <= 30:
            raise ValueError("Lifecycle timeout must be between 0 and 30 seconds")
        self.lifecycle_timeout_seconds = float(lifecycle_timeout_seconds)
        self._manifests: list[ExtensionManifest] = []
        self._active: list[tuple[ExtensionManifest, tuple[AvailableExtensionTool, ...]]] = []
        self._statuses: list[ExtensionStatus] = []
        self._started = False
        for manifest in manifests:
            self.register(manifest)

    def register(self, manifest: ExtensionManifest) -> None:
        if self._started:
            raise RuntimeError("Extensions must be registered before startup")
        if len(self._manifests) >= MAX_EXTENSIONS:
            raise ValueError(f"At most {MAX_EXTENSIONS} extensions may be registered")
        if not isinstance(manifest, ExtensionManifest):
            raise TypeError("An ExtensionManifest is required")
        if any(item.extension_id == manifest.extension_id for item in self._manifests):
            raise ValueError("Extension ids must be unique")
        self._manifests.append(manifest)

    @staticmethod
    def _validate_manifest(manifest: ExtensionManifest) -> tuple[AvailableExtensionTool, ...]:
        if not isinstance(manifest.extension_id, str) or not _EXTENSION_ID.fullmatch(manifest.extension_id):
            raise ValueError("invalid_id")
        if manifest.kind not in {"skill", "plugin", "mcp"}:
            raise ValueError("invalid_kind")
        if not isinstance(manifest.version, str) or not 1 <= len(manifest.version) <= 32:
            raise ValueError("invalid_version")
        if not isinstance(manifest.description, str) or not 1 <= len(manifest.description) <= MAX_DESCRIPTION_CHARS:
            raise ValueError("invalid_description")
        if not isinstance(manifest.tools, tuple) or not 1 <= len(manifest.tools) <= MAX_TOOLS_PER_EXTENSION:
            raise ValueError("invalid_tool_count")
        if not _validate_hook(manifest.on_start) or not _validate_hook(manifest.on_stop):
            raise ValueError("invalid_lifecycle_hook")

        available: list[AvailableExtensionTool] = []
        for spec in manifest.tools:
            if not isinstance(spec, ExtensionToolSpec):
                raise ValueError("invalid_tool")
            if not isinstance(spec.name, str) or not _TOOL_NAME.fullmatch(spec.name):
                raise ValueError("invalid_tool_name")
            if not isinstance(spec.description, str) or not 1 <= len(spec.description) <= MAX_DESCRIPTION_CHARS:
                raise ValueError("invalid_tool_description")
            if isinstance(spec.timeout_seconds, bool) or not isinstance(spec.timeout_seconds, int) or not 1 <= spec.timeout_seconds <= MAX_TOOL_TIMEOUT_SECONDS:
                raise ValueError("invalid_tool_timeout")
            if not callable(spec.handler) or not inspect.iscoroutinefunction(spec.handler):
                raise ValueError("handler_must_be_async")
            signature = inspect.signature(spec.handler)
            hints = get_type_hints(spec.handler)
            for name, parameter in signature.parameters.items():
                if (name == "tool_context" or parameter.kind not in (
                    inspect.Parameter.POSITIONAL_OR_KEYWORD, inspect.Parameter.KEYWORD_ONLY
                ) or name not in hints or not _json_annotation(hints[name])):
                    raise ValueError("invalid_tool_parameters")
            if "return" not in hints:
                raise ValueError("missing_return_annotation")
            full_name = f"ext_{manifest.extension_id}_{spec.name}"
            if len(full_name) > 64:
                raise ValueError("tool_name_too_long")
            available.append(AvailableExtensionTool(
                name=full_name,
                description=f"{manifest.description}: {spec.description}",
                extension_id=manifest.extension_id,
                kind=manifest.kind,
                timeout_seconds=spec.timeout_seconds,
                handler=spec.handler,
            ))
        if len({item.name for item in available}) != len(available):
            raise ValueError("duplicate_tool_name")
        return tuple(available)

    async def start(self, *, reserved_names: set[str] | frozenset[str] = frozenset()) -> None:
        if self._started:
            return
        self._started = True
        claimed_names = set(reserved_names)
        total_tools = 0
        for manifest in self._manifests:
            try:
                tools = self._validate_manifest(manifest)
                if any(tool.name in claimed_names for tool in tools):
                    raise ValueError("duplicate_tool_name")
                if total_tools + len(tools) > MAX_EXTENSION_TOOLS:
                    raise ValueError("extension_tool_limit")
                if manifest.on_start is not None:
                    await asyncio.wait_for(manifest.on_start(), timeout=self.lifecycle_timeout_seconds)
                claimed_names.update(tool.name for tool in tools)
                total_tools += len(tools)
                self._active.append((manifest, tools))
                self._statuses.append(ExtensionStatus(manifest.extension_id, manifest.kind, "active"))
            except Exception as exc:
                reason = str(exc) if str(exc) in {
                    "invalid_id", "invalid_kind", "invalid_version", "invalid_description", "invalid_tool_count",
                    "invalid_lifecycle_hook", "invalid_tool", "invalid_tool_name", "invalid_tool_description",
                    "invalid_tool_timeout", "handler_must_be_async", "invalid_tool_parameters",
                    "missing_return_annotation", "tool_name_too_long", "duplicate_tool_name", "extension_tool_limit",
                } else "startup_failed"
                self._statuses.append(ExtensionStatus(
                    manifest.extension_id if isinstance(manifest.extension_id, str) else "invalid",
                    manifest.kind if isinstance(manifest.kind, str) else "plugin",
                    "disabled",
                    reason,
                ))

    def available_tools(self) -> tuple[AvailableExtensionTool, ...]:
        return tuple(tool for _, tools in self._active for tool in tools)

    def status(self) -> tuple[ExtensionStatus, ...]:
        return tuple(self._statuses)

    async def close(self) -> None:
        for manifest, _ in reversed(self._active):
            if manifest.on_stop is not None:
                try:
                    await asyncio.wait_for(manifest.on_stop(), timeout=self.lifecycle_timeout_seconds)
                except Exception:
                    pass
        self._active.clear()
        self._statuses = [
            ExtensionStatus(status.extension_id, status.kind, "stopped" if status.status == "active" else status.status,
                            "shutdown_failed" if status.status == "active" and False else status.reason)
            for status in self._statuses
        ]
