"""What the model side of a voice conversation says, as typed events (issue #50).

The Gemini Live session yields ADK events that carry several things at once (audio, transcripts, "interrupted",
"turn complete"). `EventTranslator` turns each one into a list of these small events, in the order the browser must see
them. Nothing here touches a socket or the model: the input service (`Bridge.browser_to_model`) feeds the model, this
module names what comes back, and the output channel (`output.py`) delivers it. An orchestrator (#44) reads these events
and never ADK's raw ones.

Pure: no FastAPI, no ADK, no I/O. Nothing here logs user text.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

Role = Literal["user", "assistant"]


@dataclass(frozen=True)
class Transcript:
    """A piece of the visitor's speech (role "user") or of Otto's (role "assistant"), as text."""
    role: Role
    text: str


@dataclass(frozen=True)
class Speech:
    """A chunk of Otto's voice: 24 kHz mono PCM16."""
    pcm: bytes


@dataclass(frozen=True)
class Interrupted:
    """The visitor spoke over Otto. Speech that has not played yet is void."""


@dataclass(frozen=True)
class TurnComplete:
    """The model finished its turn."""


@dataclass(frozen=True)
class Action:
    """A checked tool action (server/app/voice/sink.py), ready for the browser."""
    payload: dict


VoiceEvent = Transcript | Speech | Interrupted | TurnComplete | Action


class EventTranslator:
    """ADK live events to `VoiceEvent`s. Keeps one bit of state: whether a transcript chunk of this turn already went out."""

    def __init__(self) -> None:
        # Gemini sends transcript chunks and then the whole text again; per role, did a chunk of this turn go out?
        self._chunked: dict[str, bool] = {"user": False, "assistant": False}

    def _transcript(self, role: Role, transcription: Any) -> list[VoiceEvent]:
        text = getattr(transcription, "text", None)
        if not text:
            return []
        if getattr(transcription, "finished", False):
            already, self._chunked[role] = self._chunked[role], False
            if already:
                return []
        else:
            self._chunked[role] = True
        return [Transcript(role, text)]

    def translate(self, event: Any) -> list[VoiceEvent]:
        out: list[VoiceEvent] = []
        if getattr(event, "interrupted", None):
            out.append(Interrupted())
        content = getattr(event, "content", None)
        for part in (getattr(content, "parts", None) or []):
            blob = getattr(part, "inline_data", None)
            if blob is not None and getattr(blob, "data", None):
                out.append(Speech(blob.data))
        out += self._transcript("user", getattr(event, "input_transcription", None))
        out += self._transcript("assistant", getattr(event, "output_transcription", None))
        if getattr(event, "turn_complete", None):
            self._chunked = {"user": False, "assistant": False}
            out.append(TurnComplete())
        return out
