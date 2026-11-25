"""The voice guide on ADK's `Runner.run_live`.

`LiveSession` is the seam: `connect_adk` is the real one; tests replace it with a fake that yields scripted events.
`Bridge` turns browser messages into calls on a `LiveSession`, and its events back into browser messages (protocol: route.py).
Nothing here logs user text or the API key.
"""
from __future__ import annotations

import asyncio
import base64
import json
import logging
import uuid
import warnings
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Protocol

from fastapi import WebSocket

from app.config import settings
from app.voice.app_config import PAGES, event_prompt, system_instruction
from app.voice.avatar import clean_avatar_event
from app.voice.runtime import is_runtime_id, runtime_title
from app.voice.sink import sink

logger = logging.getLogger(__name__)

APP_ID = "otto-voice"
USER_ID = "visitor"
#: ADK fills this from session state each time it builds the instruction, so Otto always knows the current page.
PAGE_PLACEHOLDER = "{page_title}"

MAX_AUDIO_FRAME_BYTES = 64 * 1024
MAX_TEXT_CHARS = 2000
#: A page's context: a JSON object (or null), at most this many UTF-8 bytes as compact JSON (`context_bytes`). The browser caps
#: its lists to the same number (web/src/otto/contextBudget.ts; a test checks they match), and a refused update clears its key (D-23).
MAX_CONTEXT_BYTES = 16 * 1024
MAX_CONTEXT_KEYS = 8
CONTEXT_KEY_CHARS = 40
#: At least this long between two unprompted event prompts, so a busy page cannot make Otto talk non-stop.
ANNOUNCE_GAP_SECONDS = 4.0
#: A shared camera or screen frame (D-21): a JPEG still, at most this big, at most one per second. The browser sends one
#: per 1.1 seconds, so network jitter doesn't squeeze two of them under the full second this side enforces.
CAPTURE_SOURCES = ("camera", "screen")
MAX_FRAME_BYTES = 256 * 1024
FRAME_GAP_SECONDS = 1.0
JPEG_MAGIC = b"\xff\xd8\xff"


def context_bytes(data: object) -> int:
    """The UTF-8 length of `data` as compact JSON, as `contextBytes` in web/src/otto/contextBudget.ts measures it.

    A lone surrogate arrives escaped (`\\ud800`, 6 bytes) and json.loads makes it one character. It is counted as that
    escape again, so a client can't fit twice the budget into an update with them."""
    return len(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8", "backslashreplace"))


class LiveSession(Protocol):
    session_id: str
    state: dict

    def events(self) -> AsyncIterator[Any]: ...
    async def send_audio(self, pcm: bytes) -> None: ...  # 16 kHz PCM16
    async def send_text(self, text: str) -> None: ...
    async def send_image(self, jpeg: bytes) -> None: ...
    async def audio_end(self) -> None: ...
    def close(self) -> None: ...


class _AdkLiveSession:
    def __init__(self, runner: Any, session: Any, queue: Any, run_config: Any) -> None:
        self._runner, self._session, self._queue, self._run_config = runner, session, queue, run_config
        self.session_id: str = session.id
        # The same dict the tools read through tool_context.state.
        self.state: dict = session.state

    async def events(self) -> AsyncIterator[Any]:
        with warnings.catch_warnings():
            # `session=` is deprecated, but it is the only way to share the session whose state the route also updates.
            warnings.simplefilter("ignore", DeprecationWarning)
            stream = self._runner.run_live(session=self._session, live_request_queue=self._queue, run_config=self._run_config)
        async for event in stream:
            yield event

    async def send_audio(self, pcm: bytes) -> None:
        from google.genai import types
        self._queue.send_realtime(types.Blob(data=pcm, mime_type="audio/pcm;rate=16000"))

    async def send_text(self, text: str) -> None:
        from google.genai import types
        self._queue.send_content(types.Content(role="user", parts=[types.Part(text=text)]))

    async def send_image(self, jpeg: bytes) -> None:
        from google.genai import types
        # [verify] (Q-01): ADK 2.13 sends an image/* blob as Live video input; the endpoint's limits are unchecked.
        self._queue.send_realtime(types.Blob(data=jpeg, mime_type="image/jpeg"))

    async def audio_end(self) -> None:
        self._queue.send_audio_stream_end()

    def close(self) -> None:
        self._queue.close()


@asynccontextmanager
async def connect_adk(language: str, page: str, page_title: str, detail: str) -> AsyncIterator[LiveSession]:
    """One ADK live session for one browser connection. ADK is imported here, so a server that never opens one never loads it."""
    from google.adk.agents import LlmAgent
    from google.adk.agents.live_request_queue import LiveRequestQueue
    from google.adk.agents.run_config import RunConfig, StreamingMode
    from google.adk.runners import Runner
    from google.adk.sessions import InMemorySessionService
    from google.genai import types

    from app.voice.model import keyed_model
    from app.voice.tools import TOOLS

    agent = LlmAgent(
        name="voice_guide",
        model=keyed_model(settings.gemini_live_model),
        instruction=system_instruction(settings.app_name, language, PAGE_PLACEHOLDER, detail),
        tools=list(TOOLS),
    )
    service = InMemorySessionService()
    runner = Runner(app_name=APP_ID, agent=agent, session_service=service)
    session = await service.create_session(
        app_name=APP_ID, user_id=USER_ID, session_id=uuid.uuid4().hex,
        state={"page": page, "page_title": PAGES[page]["title"] if page in PAGES else runtime_title(page_title, page),
               "language": language, "screens": {}},
    )
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=[types.Modality.AUDIO],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
        # D-21: nothing the visitor shares is kept, so live audio and frames are never saved as artifacts.
        save_live_blob=False,
    )
    queue = LiveRequestQueue()
    sink.open(session.id)
    live = _AdkLiveSession(runner, session, queue, run_config)
    try:
        yield live
    finally:
        live.close()
        sink.close(session.id)
        try:
            await service.delete_session(app_name=APP_ID, user_id=USER_ID, session_id=session.id)
        except Exception:  # in memory; goes away with the connection anyway
            pass


def _set_page(state: dict, page: object, title: object = None) -> None:
    if not isinstance(page, str) or (page not in PAGES and not is_runtime_id(page)):
        return
    state["page"] = page
    state["page_title"] = PAGES[page]["title"] if page in PAGES else runtime_title(title, page)
    # Lists are page-scoped (D-23); do not let a page update carry the previous page's destinations forward.
    screens = state.get("screens")
    if isinstance(screens, dict):
        screens["destinations"] = None


class Bridge:
    def __init__(self, ws: WebSocket, live: LiveSession) -> None:
        self.ws = ws
        self.live = live
        self.last_announce = 0.0
        # What the visitor is sharing (D-21), when the last frame went to the model, and how many did: a count, never the data.
        self.capture: str | None = None
        self.last_frame = float("-inf")
        self.frames = 0
        # Gemini sends transcript chunks and then the whole text again; per role, did a chunk of this turn go out?
        self._chunked = {"user": False, "assistant": False}

    # ---- browser to model ----

    async def update_context(self, event: dict) -> None:
        key, data = event.get("key"), event.get("data")
        if not isinstance(key, str) or not 0 < len(key) <= CONTEXT_KEY_CHARS:
            return
        screens = self.live.state.get("screens")
        screens = dict(screens) if isinstance(screens, dict) else {}
        if data is not None and (not isinstance(data, dict) or context_bytes(data) > MAX_CONTEXT_BYTES):
            # Never keep the previous value: a stale list must not stay usable (D-23). The content is not logged.
            if key in screens:
                screens[key] = None
                self.live.state["screens"] = screens
            logger.warning("Refused a context update for %r: not an object or over %d bytes; the key is cleared", key, MAX_CONTEXT_BYTES)
            return
        if key not in screens and len(screens) >= MAX_CONTEXT_KEYS:
            logger.warning("Refused a context update for %r: already %d keys", key, MAX_CONTEXT_KEYS)
            return
        screens[key] = data
        self.live.state["screens"] = screens
        announce = event.get("announce")
        prompt = event_prompt(announce) if isinstance(announce, str) else None
        now = asyncio.get_running_loop().time()
        if prompt and now - self.last_announce >= ANNOUNCE_GAP_SECONDS:
            self.last_announce = now
            await self.live.send_text(prompt)

    async def send_frame(self, data: Any) -> None:
        """D-21's limits, again on this side: a share is on, the data is a JPEG within the cap, and not too soon."""
        now = asyncio.get_running_loop().time()
        # The gap is checked first: a client that floods frames costs no decoding.
        if self.capture is None or now - self.last_frame < FRAME_GAP_SECONDS:
            return
        if not isinstance(data, str) or len(data) > MAX_FRAME_BYTES * 4 // 3 + 4:
            return
        try:
            jpeg = base64.b64decode(data, validate=True)
        except ValueError:
            return
        if not 0 < len(jpeg) <= MAX_FRAME_BYTES or not jpeg.startswith(JPEG_MAGIC):
            return
        self.last_frame = now
        self.frames += 1
        await self.live.send_image(jpeg)

    async def browser_to_model(self) -> None:
        while True:
            message = await self.ws.receive()
            if message["type"] == "websocket.disconnect":
                return
            data = message.get("bytes")
            if data is not None:
                if 0 < len(data) <= MAX_AUDIO_FRAME_BYTES:
                    await self.live.send_audio(data)
                continue
            try:
                event = json.loads(message.get("text") or "")
            except ValueError:
                continue
            kind = event.get("type") if isinstance(event, dict) else None
            if kind == "page":
                _set_page(self.live.state, event.get("page"), event.get("title"))
            elif kind == "context":
                await self.update_context(event)
            elif kind == "text" and isinstance(event.get("text"), str) and event["text"].strip():
                await self.live.send_text(event["text"][:MAX_TEXT_CHARS])
            elif kind == "capture" and (event.get("source") in CAPTURE_SOURCES or event.get("source") is None):
                self.capture = event.get("source")
            elif kind == "frame":
                await self.send_frame(event.get("data"))
            elif kind == "mic_off":
                await self.live.audio_end()
            elif kind == "stop":
                return

    # ---- model to browser ----

    def avatar(self, event: object) -> bool:
        """Tells Otto's character how things are going (avatar.py): thinking, working, asking permission, success...

        For the orchestrator, task engine and policy layer to call; it is not a tool, so the model cannot. An event that
        does not fit is dropped (and False returned). It queues like any message, never waiting on the browser."""
        clean = clean_avatar_event(event)
        if clean is None:
            return False
        self.out.control({"type": "avatar", "event": clean})
        return True

    async def _transcript(self, role: str, transcription: Any) -> None:
        text = getattr(transcription, "text", None)
        if not text:
            return
        if getattr(transcription, "finished", False):
            already, self._chunked[role] = self._chunked[role], False
            if already:
                return
        else:
            self._chunked[role] = True
        await self.ws.send_json({"type": "transcript", "role": role, "text": text})

    async def model_to_browser(self) -> None:
        async for event in self.live.events():
            # A tool runs between its call and response events, so drain after every event, before this event's audio.
            for action in sink.drain(self.live.session_id):
                await self.ws.send_json({"type": "action", **action})
            if getattr(event, "interrupted", None):
                await self.ws.send_json({"type": "interrupted"})
            content = getattr(event, "content", None)
            for part in (getattr(content, "parts", None) or []):
                blob = getattr(part, "inline_data", None)
                if blob is not None and getattr(blob, "data", None):
                    await self.ws.send_bytes(blob.data)
            await self._transcript("user", getattr(event, "input_transcription", None))
            await self._transcript("assistant", getattr(event, "output_transcription", None))
            if getattr(event, "turn_complete", None):
                self._chunked = {"user": False, "assistant": False}
                await self.ws.send_json({"type": "turn_complete"})
