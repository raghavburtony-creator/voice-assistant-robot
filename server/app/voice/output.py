"""The output channel: everything the browser is sent, through one queue and one writer (issue #50).

Before this, the task that read the model's events also awaited every `send` to the browser. A slow or stalled browser
then stopped the server reading the model (and ADK runs tools inside that stream), and an interruption could not reach
audio that was already past the reader. Now the model side only *queues*; `run` is the single writer.

- Audio and control messages keep their order, so a tool's action still arrives before the speech that follows it.
- `interrupt()` drops the audio still waiting, queues `{"type":"interrupted"}`, and keeps every control message (an
  action the model already took must still reach the page).
- The audio queue is capped (`MAX_QUEUED_AUDIO_BYTES`). Past it the oldest audio goes: a stalled browser costs a gap in
  speech it was never going to hear in time, never the whole conversation.

Nothing here logs what is sent.
"""
from __future__ import annotations

import asyncio
from collections import deque
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect

#: About 43 seconds of 24 kHz mono PCM16. A normal burst (Gemini sends speech faster than it plays) is far below this.
MAX_QUEUED_AUDIO_BYTES = 2 * 1024 * 1024


class OutputChannel:
    def __init__(self, ws: WebSocket, max_audio_bytes: int = MAX_QUEUED_AUDIO_BYTES) -> None:
        self._ws = ws
        self._max_audio_bytes = max_audio_bytes
        self._queue: deque[tuple[str, Any]] = deque()
        self._audio_bytes = 0
        self._wake = asyncio.Event()
        self._idle = asyncio.Event()
        self._idle.set()
        #: Counts, for tests and diagnostics. Never the audio.
        self.dropped_audio_bytes = 0
        self.interruptions = 0

    # ---- producers: never wait on the socket ----

    def _put(self, kind: str, payload: Any) -> None:
        self._queue.append((kind, payload))
        self._idle.clear()
        self._wake.set()

    def audio(self, pcm: bytes) -> None:
        self._put("audio", pcm)
        self._audio_bytes += len(pcm)
        self._trim()

    def control(self, message: dict) -> None:
        self._put("json", message)

    def interrupt(self) -> None:
        """The visitor spoke over Otto: audio not yet sent is void. Control messages stay, then `interrupted` follows."""
        self.interruptions += 1
        kept = deque(item for item in self._queue if item[0] != "audio")
        self.dropped_audio_bytes += self._audio_bytes
        self._queue, self._audio_bytes = kept, 0
        self.control({"type": "interrupted"})

    def _trim(self) -> None:
        while self._audio_bytes > self._max_audio_bytes:
            index = next((i for i, item in enumerate(self._queue) if item[0] == "audio"), None)
            if index is None:
                return
            _, pcm = self._queue[index]
            del self._queue[index]
            self._audio_bytes -= len(pcm)
            self.dropped_audio_bytes += len(pcm)

    # ---- the single writer ----

    async def run(self) -> None:
        """Sends the queue in order until cancelled. Returns (not raises) when the browser has gone."""
        try:
            while True:
                if not self._queue:
                    self._idle.set()
                    self._wake.clear()
                    await self._wake.wait()
                    continue
                kind, payload = self._queue.popleft()
                if kind == "audio":
                    self._audio_bytes -= len(payload)
                    await self._ws.send_bytes(payload)
                else:
                    await self._ws.send_json(payload)
        except (WebSocketDisconnect, RuntimeError):
            return  # the socket is closed; the browser pump ends the session

    async def flush(self) -> None:
        """Waits until everything queued has been sent. Only the model pump ending cleanly calls this (before `ended`)."""
        await self._idle.wait()
