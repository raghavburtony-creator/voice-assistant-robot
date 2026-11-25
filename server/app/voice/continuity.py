"""Host-supplied continuity identity for cross-session Otto state.

The browser cannot set arbitrary WebSocket handshake headers, so the trusted host/deployment
boundary injects these headers before forwarding the upgrade to Otto. The server must only
honour them when CONTINUITY_TRUST_PROXY is enabled. The identity is deliberately kept out of
browser messages, page context, model prompts, logs, and ADK session state.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

CONTINUITY_ENABLED_HEADER = "x-otto-continuity-enabled"
CONTINUITY_IDENTITY_HEADER = "x-otto-continuity-identity"
MAX_CONTINUITY_IDENTITY_CHARS = 256


@dataclass(frozen=True)
class ContinuityContext:
    """The minimum host boundary data needed by later continuity storage."""

    scope: str
    identity: str


def from_headers(
    headers: Mapping[str, str],
    *,
    trusted_proxy: bool,
    scope: str,
) -> ContinuityContext | None:
    """Read an opt-in identity from the trusted host/server boundary.

    Missing/disabled continuity deliberately returns None, preserving D-20 same-tab-only
    behaviour. Invalid values are also ignored rather than becoming an identity.
    """
    if not trusted_proxy:
        return None

    enabled = headers.get(CONTINUITY_ENABLED_HEADER, "").strip().lower()
    if enabled not in {"1", "true", "yes"}:
        return None

    identity = headers.get(CONTINUITY_IDENTITY_HEADER, "")
    if not identity or len(identity) > MAX_CONTINUITY_IDENTITY_CHARS:
        return None
    if any(ord(char) < 0x20 or ord(char) == 0x7f for char in identity):
        return None

    clean_scope = scope.strip()
    if not clean_scope:
        return None
    return ContinuityContext(scope=clean_scope, identity=identity)
