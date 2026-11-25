"""Provider-independent perception gateway for Otto's live session.

The gateway is the server-side boundary between browser perception providers and the ADK
orchestrator. It keeps only the latest observation in memory for the lifetime of a live
session; it never writes frames or camera data to disk.
"""
from __future__ import annotations

import base64
import time
import uuid
from dataclasses import dataclass
from typing import Literal

ObservationSource = Literal["camera", "screen", "browser", "document", "image"]
ObservationKind = Literal["frame", "context", "snapshot"]
ConsentState = Literal["granted", "revoked"]

MAX_FRAME_BYTES = 256 * 1024
FRAME_GAP_SECONDS = 1.0
JPEG_MAGIC = b"\xff\xd8\xff"


@dataclass(frozen=True)
class Observation:
    id: str
    source: ObservationSource
    kind: ObservationKind
    timestamp: float
    consent: ConsentState
    size_bytes: int = 0
    metadata: dict[str, object] | None = None
    data: bytes | None = None


class PerceptionRejected(ValueError):
    """A perception input was rejected by the gateway."""


class PerceptionGateway:
    """Normalize and enforce all perception inputs for one Otto live session.

    The gateway deliberately has no model, planner, or routing logic. It only validates
    consent, normalizes observations, and exposes the latest in-memory observation.
    """

    def __init__(self) -> None:
        self._consent: dict[ObservationSource, ConsentState] = {}
        self._latest: dict[ObservationSource, Observation] = {}
        self._last_frame: dict[ObservationSource, float] = {}

    def set_consent(self, source: ObservationSource, granted: bool) -> None:
        state: ConsentState = "granted" if granted else "revoked"
        self._consent[source] = state
        if state == "revoked":
            self._latest.pop(source, None)
            self._last_frame.pop(source, None)

    def consent(self, source: ObservationSource) -> ConsentState:
        return self._consent.get(source, "revoked")

    def ingest_frame(self, source: ObservationSource, jpeg: bytes, *, timestamp: float | None = None) -> Observation:
        if source not in ("camera", "screen"):
            raise PerceptionRejected("Only camera and screen sources may send frames.")
        if self.consent(source) != "granted":
            raise PerceptionRejected(f"{source} perception is not consented.")
        if not 0 < len(jpeg) <= MAX_FRAME_BYTES or not jpeg.startswith(JPEG_MAGIC):
            raise PerceptionRejected("Frame must be a non-empty JPEG within the size limit.")

        now = time.monotonic() if timestamp is None else timestamp
        previous = self._last_frame.get(source)
        if previous is not None and now - previous < FRAME_GAP_SECONDS:
            raise PerceptionRejected("Frame arrived before the source rate limit.")

        observation = Observation(
            id=uuid.uuid4().hex,
            source=source,
            kind="frame",
            timestamp=now,
            consent="granted",
            size_bytes=len(jpeg),
            data=bytes(jpeg),
        )
        self._latest[source] = observation
        self._last_frame[source] = now
        return observation

    def ingest_context(
        self,
        source: ObservationSource,
        metadata: dict[str, object],
        *,
        timestamp: float | None = None,
    ) -> Observation:
        if source not in ("browser", "document", "image"):
            raise PerceptionRejected("Context source must be browser, document, or image.")
        if self.consent(source) != "granted":
            raise PerceptionRejected(f"{source} perception is not consented.")
        if not isinstance(metadata, dict):
            raise PerceptionRejected("Observation metadata must be an object.")

        observation = Observation(
            id=uuid.uuid4().hex,
            source=source,
            kind="context",
            timestamp=time.monotonic() if timestamp is None else timestamp,
            consent="granted",
            metadata=dict(metadata),
        )
        self._latest[source] = observation
        return observation

    def latest(self, source: ObservationSource) -> Observation | None:
        observation = self._latest.get(source)
        if observation is None or self.consent(source) != "granted":
            return None
        return observation

    def summary(self) -> list[dict[str, object]]:
        """Return provider-independent metadata only; never expose frame bytes."""
        return [
            {
                "id": item.id,
                "source": item.source,
                "kind": item.kind,
                "timestamp": item.timestamp,
                "consent": item.consent,
                "size_bytes": item.size_bytes,
                "metadata": item.metadata or {},
            }
            for item in self._latest.values()
            if self.consent(item.source) == "granted"
        ]

    def clear(self) -> None:
        """Drop all in-memory perception data at session teardown."""
        self._latest.clear()
        self._last_frame.clear()
        self._consent.clear()


def decode_frame(data: str) -> bytes:
    """Decode a browser base64 payload without accepting malformed input."""
    try:
        return base64.b64decode(data, validate=True)
    except (ValueError, TypeError) as exc:
        raise PerceptionRejected("Frame payload is not valid base64.") from exc
