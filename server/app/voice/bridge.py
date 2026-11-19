"""The voice guide on ADK's `Runner.run_live`.

`LiveSession` is the seam: `connect_adk` is the real one; tests replace it with a fake that yields scripted events.
`Bridge` turns browser messages into calls on a `LiveSession`, and its events back into browser messages (protocol: route.py).
Nothing here logs user text or the API key.
"""
from __future__ import annotations

import asyncio
import json
import uuid
import warnings
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Protocol

from fastapi import WebSocket

from app.config import settings
from app.voice.app_config import PAGES, event_prompt, system_instruction
from app.voice.sink import sink

APP_ID = "echo-voice"
USER_ID = "visitor"
#: ADK fills this from session state each time it builds the instruction, so Echo always knows the current page.
PAGE_PLACEHOLDER = "{page_title}"

MAX_AUDIO_FRAME_BYTES = 64 * 1024
MAX_TEXT_CHARS = 2000
#: A page's context: a JSON object (or null), at most this big when serialised.
MAX_CONTEXT_BYTES = 16 * 1024
MAX_CONTEXT_KEYS = 8
CONTEXT_KEY_CHARS = 40
#: At least this long between two unprompted event prompts, so a busy page cannot make Echo talk non-stop.
ANNOUNCE_GAP_SECONDS = 4.0


class LiveSession(Protocol):
    session_id: str
    state: dict

    def events(self) -> AsyncIterator[Any]: ...
    async def send_audio(self, pcm: bytes) -> None: ...  # 16 kHz PCM16
    async def send_text(self, text: str) -> None: ...
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

    async def audio_end(self) -> None:
        self._queue.send_audio_stream_end()

    def close(self) -> None:
        self._queue.close()


@asynccontextmanager
async def connect_adk(language: str, page: str, detail: str) -> AsyncIterator[LiveSession]:
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
        state={"page": page, "page_title": PAGES[page]["title"], "language": language, "screens": {}},
    )
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI,
        response_modalities=[types.Modality.AUDIO],
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
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


def _set_page(state: dict, page: str) -> None:
    state["page"] = page
    state["page_title"] = PAGES[page]["title"]


class Bridge:
    def __init__(self, ws: WebSocket, live: LiveSession) -> None:
        self.ws = ws
        self.live = live
        self.last_announce = 0.0
        # Gemini sends transcript chunks and then the whole text again; per role, did a chunk of this turn go out?
        self._chunked = {"user": False, "assistant": False}

    # ---- browser to model ----

    async def update_context(self, event: dict) -> None:
        key, data = event.get("key"), event.get("data")
        if not isinstance(key, str) or not 0 < len(key) <= CONTEXT_KEY_CHARS:
            return
        if data is not None and (not isinstance(data, dict) or len(json.dumps(data)) > MAX_CONTEXT_BYTES):
            return
        screens = self.live.state.get("screens")
        screens = dict(screens) if isinstance(screens, dict) else {}
        if key not in screens and len(screens) >= MAX_CONTEXT_KEYS:
            return
        screens[key] = data
        self.live.state["screens"] = screens
        announce = event.get("announce")
        prompt = event_prompt(announce) if isinstance(announce, str) else None
        now = asyncio.get_running_loop().time()
        if prompt and now - self.last_announce >= ANNOUNCE_GAP_SECONDS:
            self.last_announce = now
            await self.live.send_text(prompt)

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
            if kind == "page" and event.get("page") in PAGES:
                _set_page(self.live.state, event["page"])
            elif kind == "context":
                await self.update_context(event)
            elif kind == "text" and isinstance(event.get("text"), str) and event["text"].strip():
                await self.live.send_text(event["text"][:MAX_TEXT_CHARS])
            elif kind == "mic_off":
                await self.live.audio_end()
            elif kind == "stop":
                return

    # ---- model to browser ----

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
