"""The voice WebSocket, between the browser and Gemini Live. The API key never leaves the server.

    client -> server  text   {"type":"start","language":"en","page":"home","title":"Home","detail":"short"|"detailed"}   (first message)
                      binary 16 kHz mono PCM16 microphone audio
                      text   {"type":"page","page":...,"title":...} | {"type":"text","text":...} | {"type":"mic_off"}
                             | {"type":"context","key":...,"data":{...}|null,"announce":...} | {"type":"stop"}
                             | {"type":"capture","source":"camera"|"screen"|null}   (a share starts or stops, D-21)
                             | {"type":"frame","data":<base64 JPEG>}   (while sharing: at most 1/s, 256 KB; others dropped)
                             | {"type":"continuity_clear"}   (visitor withdrawal: deletes the saved task and suppresses saves for this session)
    server -> client  text   {"type":"ready","limitSeconds":600} | {"type":"transcript","role":"user"|"assistant","text":...}
                             {"type":"action","action":"navigate","page":...} | {"type":"action","action":"command","name":...}
                             {"type":"action","action":"guide","target":...} | {"type":"action","action":"task","task":...}
                             {"type":"action","action":"task_move","move":"stop"|"back"|"next"}
                             {"type":"action","action":"card","card":{"title":...,"body":...,"code"?:...,"follow_ups"?:[...]}}
                             {"type":"interrupted"} | {"type":"turn_complete"}
                             {"type":"avatar","event":{"kind":"working","id":...,"topic"?:...,"message"?:...}}   (avatar.py: how things are
                              going, for Otto's face and body; presentation only. Kinds: thinking, listening, speaking, working, waiting,
                              permission {id,state}, success, failure, interruption, emotion, gesture, movement)
                             (everything goes out in the order the model made it, through one writer. "interrupted" first
                              drops speech still queued, and a stalled browser cannot stall the model: output.py)
                             {"type":"ended","reason":"closed"|"service_ended"|"time_limit"}
                             {"type":"error","code":"not_configured"|"busy"|"bad_start"|"upstream","message":...}
                      binary 24 kHz mono PCM16 speech

Origin: when CORS_ORIGINS lists any non-local origin (production), a connection with no Origin or a foreign one is refused (1008).
"""
from __future__ import annotations

import asyncio
import contextlib
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import settings
from app.voice.app_config import LANGUAGE_NAMES, PAGES
from app.voice.continuity import ContinuityContext, from_headers
from app.voice.runtime import is_runtime_id, runtime_title

router = APIRouter(prefix="/api/v1/voice", tags=["voice"])
logger = logging.getLogger(__name__)

_active = 0


def connect_adk(language: str, page: str, page_title: str, detail: str):
    """Replaced in tests."""
    from app.voice.bridge import connect_adk as real
    return real(language, page, page_title, detail)


def _scrub(text: str) -> str:
    key = settings.gemini_api_key.get_secret_value()
    return text.replace(key, "[redacted]") if key else text


async def _close(ws: WebSocket, payload: dict) -> None:
    with contextlib.suppress(Exception):
        await ws.send_json(payload)
        await ws.close()


async def _wait(tasks: set[asyncio.Task]) -> str:
    """Runs the three pumps (browser input, model events, browser output) until one ends or the time limit passes. Returns the `ended` reason; raises what a pump raised."""
    done, pending = await asyncio.wait(tasks, timeout=settings.max_session_seconds, return_when=asyncio.FIRST_COMPLETED)
    for task in pending:
        task.cancel()
    for task in pending:
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
    if not done:
        return "time_limit"
    reason = "closed"
    for task in done:
        error = task.exception()
        if error and not isinstance(error, WebSocketDisconnect):
            raise error
        if task.get_name() == "model":
            reason = "service_ended"
    return reason


async def _run(ws: WebSocket, language: str, page: str, page_title: str, detail: str, continuity: ContinuityContext | None) -> str:
    from app.voice.bridge import Bridge
    async with connect_adk(language, page, page_title, detail) as live:
        # Keep the host identity outside browser messages and ADK session state. CI-2 will use this
        # server-side seam for persistence; the model never receives the identity as context.
        live.continuity = continuity  # type: ignore[attr-defined]
        bridge = Bridge(ws, live)
        await ws.send_json({"type": "ready", "limitSeconds": settings.max_session_seconds})
        return await _wait({
            asyncio.create_task(bridge.browser_to_model(), name="browser"),
            asyncio.create_task(bridge.model_to_browser(), name="model"),
            asyncio.create_task(bridge.output_pump(), name="output"),
        })


@router.websocket("/live")
async def voice_live(ws: WebSocket) -> None:
    global _active
    origin = ws.headers.get("origin")
    if (origin or settings.origin_required) and origin not in settings.cors_origin_list:
        logger.warning("voice refused origin %r; allowed: %s (set CORS_ORIGINS to add it)", origin, settings.cors_origins)
        await ws.close(code=1008)
        return
    await ws.accept()

    if not settings.gemini_api_key.get_secret_value():
        await _close(ws, {"type": "error", "code": "not_configured", "message": "The voice guide is not set up on this server."})
        return
    if _active >= settings.max_sessions:
        await _close(ws, {"type": "error", "code": "busy", "message": "The voice guide is busy. Try again in a minute."})
        return

    try:
        start = await asyncio.wait_for(ws.receive_json(), timeout=10)
    except (asyncio.TimeoutError, ValueError, WebSocketDisconnect):
        start = None
    if not isinstance(start, dict) or start.get("type") != "start":
        await _close(ws, {"type": "error", "code": "bad_start", "message": "The voice guide could not start."})
        return
    language, page, page_title, detail = start.get("language"), start.get("page"), start.get("title"), start.get("detail")
    language = language if isinstance(language, str) and language in LANGUAGE_NAMES else "en"
    page = page if isinstance(page, str) and (page in PAGES or is_runtime_id(page)) else next(iter(PAGES))
    page_title = PAGES[page]["title"] if page in PAGES else runtime_title(page_title, page)
    detail = "detailed" if detail == "detailed" else "short"
    continuity = from_headers(ws.headers, trusted_proxy=settings.continuity_trust_proxy, scope=settings.app_name)

    _active += 1
    try:
        reason = await _run(ws, language, page, page_title, detail, continuity)
    except WebSocketDisconnect:
        return
    except Exception as exc:
        logger.warning("voice session failed: %s: %s", type(exc).__name__, _scrub(str(exc)))
        logger.debug("voice traceback", exc_info=True)
        await _close(ws, {"type": "error", "code": "upstream", "message": "The voice guide stopped unexpectedly."})
        return
    finally:
        _active -= 1
    await _close(ws, {"type": "ended", "reason": reason})
