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
from app.voice.events import Action, EventTranslator, Interrupted, Speech, Transcript, TurnComplete, VoiceEvent
from app.voice.output import OutputChannel
from app.voice.app_config import PAGES, event_prompt, system_instruction
from app.voice.continuity import ContinuityContext
from app.voice.continuity_store import ContinuityRecord, ContinuityStore, SQLiteContinuityStore
from app.voice.context import clear_page_context
from app.voice.avatar import clean_avatar_event
from app.voice.runtime import is_runtime_id, runtime_title
from app.voice.sink import sink
from app.voice.memory_service import SQLiteMemoryService
from app.voice.perception import PerceptionGateway, PerceptionRejected, decode_frame
from app.voice.policy import POLICY_ENGINE

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
JPEG_MAGIC = b"\\xff\\xd8\\xff"

continuity_store: ContinuityStore = SQLiteContinuityStore(settings.continuity_store_path)
memory_service = SQLiteMemoryService(settings.memory_store_path)


def context_bytes(data: object) -> int:
    """The UTF-8 length of `data` as compact JSON, as `contextBytes` in web/src/otto/contextBudget.ts measures it.

    A lone surrogate arrives escaped (`\\ud800`, 6 bytes) and json.loads makes it one character. It is counted as that
    escape again, so a client can't fit twice the budget into an update with them."""
    return len(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8", "backslashreplace"))


def _task_specs(data: object) -> list[object] | None:
    """Extract the browser's published task registry ({tasks: [...]}) safely."""
    if not isinstance(data, dict):
        return None
    tasks = data.get("tasks")
    return tasks if isinstance(tasks, list) else None


class LiveSession(Protocol):
    session_id: str
    state: dict
    continuity: ContinuityContext | None

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
        # Host-supplied identity stays outside ADK state so it cannot become model context.
        self.continuity: ContinuityContext | None = None

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

    # D-22: keep the existing ADK agent in the voice bridge; do not introduce
    # a separate runtime orchestrator or a parallel tool-routing authority.
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
    # Runtime lists are page-scoped (D-23); never let the page we left authorize the next one.
    screens = state.get("screens")
    if isinstance(screens, dict):
        clear_page_context(screens)


class Bridge:
    def __init__(self, ws: WebSocket, live: LiveSession, store: ContinuityStore | None = None) -> None:
        self.ws = ws
        self.live = live
        self.continuity_store = store or continuity_store
        self.continuity_resumed = False
        self.continuity_withdrawn = False
        self.seen_running_task = False
        self.pending_continuity = None
        if live.continuity is not None:
            # A host-supplied enabled identity is the explicit opt-in that re-enables a prior withdrawal.
            self.continuity_store.enable(live.continuity.scope, live.continuity.identity)
            self.pending_continuity = self.continuity_store.load(live.continuity.scope, live.continuity.identity)
        # The host identity is server-only. Memory is read only when the trusted proxy opted in;
        # the returned JSON is data, not instructions, and contains no sensitive records.
        self.live.state["memory_context"] = (
            memory_service.get_context(live.continuity.scope, live.continuity.identity)
            if live.continuity is not None else "[]"
        )
        self.last_announce = 0.0
        # What the visitor is sharing (D-21), when the last frame went to the model, and how many did: a count, never the data.
        self.capture: str | None = None
        self.capture_generation = 0
        self.live.state["capture_source"] = None
        self.live.state["capture_generation"] = 0
        self.perception = PerceptionGateway()
        # Browser/page context is an explicit conversation input, not camera/screen capture.
        self.perception.set_consent("browser", True)
        self.last_frame = float("-inf")
        self.frames = 0
        # The model side only queues on `out`; `output_pump` is its one writer (output.py), so a slow browser never stalls
        # the model's events. `translator` names what each ADK event means (events.py).
        self.out = OutputChannel(ws)
        self.translator = EventTranslator()

    # ---- browser to model ----

    async def update_context(self, event: dict) -> None:
        key, data = event.get("key"), event.get("data")
        if not isinstance(key, str) or not 0 < len(key) <= CONTEXT_KEY_CHARS:
            return
        # Native outcomes are audit-only: never expose them to the model as page context.
        if key == "desktop_action_result":
            outcomes = data.get("outcomes") if isinstance(data, dict) else None
            if isinstance(outcomes, list):
                for outcome in outcomes[-8:]:
                    POLICY_ENGINE.audit_outcome(self.live, outcome)
            else:
                POLICY_ENGINE.audit_outcome(self.live, data)
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
        if key == "guide_task_running":
            self._persist_running_task(data)
        elif key == "guide_tasks":
            self._resume_saved_task(data)
        try:
            self.perception.ingest_context("browser", {key: data})
        except PerceptionRejected:
            pass
        announce = event.get("announce")
        prompt = event_prompt(announce) if isinstance(announce, str) else None
        now = asyncio.get_running_loop().time()
        if prompt and now - self.last_announce >= ANNOUNCE_GAP_SECONDS:
            self.last_announce = now
            await self.live.send_text(prompt)

    def _persist_running_task(self, data: object) -> None:
        identity = self.live.continuity
        if identity is None or self.continuity_withdrawn:
            self.live.state.pop("continuity_handoff", None)
            return
        if data is None:
            # The first null is a new session's empty browser state. A one-shot marker also
            # distinguishes source-interface unmount during an accepted navigation handoff
            # from task completion/cancellation.
            handoff = self.live.state.pop("continuity_handoff", False) is True
            if self.seen_running_task:
                self.seen_running_task = False
                if handoff:
                    return
                self.continuity_store.delete(identity.scope, identity.identity)
                self.pending_continuity = None
            return
        if not isinstance(data, dict):
            return
        # Any subsequent active progress ends the one-shot handoff window.
        self.live.state.pop("continuity_handoff", None)
        self.seen_running_task = True
        task, step = data.get("id"), data.get("stepId")
        if not isinstance(task, str) or not isinstance(step, str):
            self.continuity_store.delete(identity.scope, identity.identity)
            self.pending_continuity = None
            return
        screens = self.live.state.get("screens", {})
        registry = screens.get("guide_tasks") if isinstance(screens, dict) else None
        offered_tasks = _task_specs(registry)
        spec = next((item for item in offered_tasks if isinstance(item, dict) and item.get("id") == task), None) if offered_tasks is not None else None
        if not isinstance(spec, dict) or not isinstance(spec.get("stepIds"), list) or step not in spec["stepIds"]:
            self.continuity_store.delete(identity.scope, identity.identity)
            self.pending_continuity = None
            return
        import time
        self.continuity_store.save(
            ContinuityRecord(scope=identity.scope, task=task, step=step, savedAt=int(time.time())),
            identity.identity,
        )

    def _resume_saved_task(self, data: object) -> None:
        offered_tasks = _task_specs(data)
        if self.continuity_resumed or self.pending_continuity is None or not offered_tasks:
            # A page may register its tasks in a parent effect after Otto mounts. Wait for a non-empty
            # registry update rather than treating the first empty snapshot as proof the task disappeared.
            return
        self.continuity_resumed = True
        record = self.pending_continuity
        offered = next((item for item in offered_tasks if isinstance(item, dict) and item.get("id") == record.task), None)
        step_ids = offered.get("stepIds") if isinstance(offered, dict) else None
        if not isinstance(step_ids, list) or record.step not in step_ids:
            identity = self.live.continuity
            if identity is not None:
                self.continuity_store.delete(identity.scope, identity.identity)
            self.pending_continuity = None
            return
        self.out.control({"type": "action", "action": "task_resume", "task": record.task, "step": record.step})
        self.pending_continuity = None

    def withdraw_continuity(self) -> None:
        identity = self.live.continuity
        self.continuity_withdrawn = True
        self.pending_continuity = None
        if identity is not None:
            self.continuity_store.disable(identity.scope, identity.identity)

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
        try:
            observation = self.perception.ingest_frame(self.capture, jpeg, timestamp=now)
        except PerceptionRejected:
            return
        self.last_frame = now
        self.frames += 1
        self.live.state["perception"] = {"latest": self.perception.summary(), "last_observation_id": observation.id}
        await self.live.send_image(observation.data or b"")
        # D-21: once the frame has been forwarded successfully, retain only metadata.
        self.perception.drop_frame_data(self.capture, observation.id)

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
                generation = event.get("generation")
                # Every start and Stop advances a client-owned generation. Late proposals from an earlier
                # share cannot become valid again if the visitor starts a new camera share quickly.
                if type(generation) is not int or generation <= self.capture_generation:
                    continue
                self.capture_generation = generation
                self.capture = event.get("source")
                self.live.state["capture_source"] = self.capture
                self.live.state["capture_generation"] = generation
                for source in CAPTURE_SOURCES:
                    self.perception.set_consent(source, source == self.capture)
                if self.capture is None:
                    self.live.state["perception"] = {"latest": self.perception.summary()}
            elif kind == "frame":
                await self.send_frame(event.get("data"))
            elif kind == "mic_off":
                await self.live.audio_end()
            elif kind == "continuity_clear":
                self.withdraw_continuity()
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

    def _deliver(self, event: VoiceEvent) -> None:
        """Queues one event for the browser. Never waits on the socket."""
        if isinstance(event, Speech):
            self.out.audio(event.pcm)
        elif isinstance(event, Interrupted):
            self.out.interrupt()
        elif isinstance(event, Transcript):
            self.out.control({"type": "transcript", "role": event.role, "text": event.text})
        elif isinstance(event, TurnComplete):
            self.out.control({"type": "turn_complete"})
        elif isinstance(event, Action):
            self.out.control({"type": "action", **event.payload})

    async def model_to_browser(self) -> None:
        async for event in self.live.events():
            # A tool runs between its call and response events, so drain after every event, before this event's audio.
            for action in sink.drain(self.live.session_id):
                environmental = action.get("environmental") if isinstance(action, dict) else None
                if isinstance(environmental, dict):
                    generation = environmental.get("generation")
                    if (self.capture == "camera" and type(generation) is int
                            and generation == self.capture_generation
                            and self.live.state.get("capture_source") == "camera"):
                        self.out.control({
                            "type": "environmental",
                            "generation": generation,
                            "proposal": {"topic": environmental.get("topic"), "message": environmental.get("message")},
                        })
                else:
                    self._deliver(Action(action))
            for item in self.translator.translate(event):
                self._deliver(item)
        await self.out.flush()  # the model is done: everything it said goes out before `ended`

    async def output_pump(self) -> None:
        """The one writer to the browser (output.py)."""
        await self.out.run()
