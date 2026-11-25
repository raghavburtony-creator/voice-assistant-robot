"""Provider-neutral contract and checks for environmental awareness proposals (D-30).

A proposal is not an action or a statement of fact. It can only ask Otto to pay
minor attention to a bounded topic while a fresh, visitor-shared camera frame
belongs to this live session. No frame bytes or explanation history are kept.
"""
from __future__ import annotations

import re
import time
from dataclasses import dataclass
from typing import Literal, Protocol

EnvironmentalTopic = Literal["object", "activity", "scene_change", "potential_hazard"]
EnvironmentalConfidence = Literal["sufficient", "uncertain"]
TOPICS = ("object", "activity", "scene_change", "potential_hazard")
MAX_MESSAGE_CHARS = 120
MAX_OBSERVATION_AGE_SECONDS = 5.0
MIN_PROPOSAL_GAP_SECONDS = 15.0
DUPLICATE_TOPIC_WINDOW_SECONDS = 60.0
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


@dataclass(frozen=True)
class EnvironmentalProposal:
    """A location-free, low-authority proposal for the existing attention event."""

    topic: EnvironmentalTopic
    message: str


class EnvironmentalAdapter(Protocol):
    """Provider-neutral seam: adapters return candidate data, never actions."""

    def propose(self, observation: object) -> EnvironmentalProposal | None: ...


class DeterministicFakeEnvironmentalAdapter:
    """A deterministic adapter for tests and the lab; it never captures or reads frames."""

    def __init__(self, proposal: object | None) -> None:
        self._proposal = proposal

    def propose(self, observation: object) -> EnvironmentalProposal | None:
        del observation  # The fake's result is fixed; no frame or observation is retained.
        return clean_environmental_proposal(self._proposal)


def clean_environmental_proposal(value: object) -> EnvironmentalProposal | None:
    """Parse untrusted proposal data, drop extra fields and refuse uncertainty."""
    if not isinstance(value, dict):
        return None
    topic, message, confidence = value.get("topic"), value.get("message"), value.get("confidence")
    if topic not in TOPICS or confidence != "sufficient" or not isinstance(message, str):
        return None
    clean = " ".join(_CONTROL.sub(" ", message).split())
    clean = re.sub(r"(?:https?://|www\.)\S+", "", clean)
    clean = " ".join(clean.split())[:MAX_MESSAGE_CHARS].strip()
    if not clean:
        return None
    return EnvironmentalProposal(topic=topic, message=clean)  # type: ignore[arg-type]


def accept_environmental_proposal(
    state: dict,
    value: object,
    *,
    now: float | None = None,
) -> EnvironmentalProposal | None:
    """Validate proposal, camera consent/freshness and per-session limits.

    The state is the current ephemeral ADK session state. Only a topic and
    monotonic timestamps are stored for rate/duplicate suppression; no message,
    frame or model reasoning is persisted.
    """
    proposal = clean_environmental_proposal(value)
    if proposal is None:
        return None
    if state.get("capture_source") != "camera":
        return None

    perception = state.get("perception")
    latest = perception.get("latest") if isinstance(perception, dict) else None
    camera = next((
        item for item in latest
        if isinstance(item, dict) and item.get("source") == "camera"
        and item.get("kind") == "frame" and item.get("consent") == "granted"
    ), None) if isinstance(latest, list) else None
    observed_at = camera.get("timestamp") if isinstance(camera, dict) else None
    current = time.monotonic() if now is None else now
    if (not isinstance(observed_at, (int, float)) or isinstance(observed_at, bool)
            or observed_at > current or current - observed_at > MAX_OBSERVATION_AGE_SECONDS):
        return None

    previous_at = state.get("_environmental_last_at")
    previous_topic = state.get("_environmental_last_topic")
    previous_topic_at = state.get("_environmental_last_topic_at")
    if isinstance(previous_at, (int, float)) and current - previous_at < MIN_PROPOSAL_GAP_SECONDS:
        return None
    if (previous_topic == proposal.topic and isinstance(previous_topic_at, (int, float))
            and current - previous_topic_at < DUPLICATE_TOPIC_WINDOW_SECONDS):
        return None

    state["_environmental_last_at"] = current
    state["_environmental_last_topic"] = proposal.topic
    state["_environmental_last_topic_at"] = current
    return proposal
