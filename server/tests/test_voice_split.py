"""Listening is separate from speaking (issue #50): typed model events, one output writer, interruption as an event."""
from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from app.voice.bridge import Bridge
from app.voice.events import Action, EventTranslator, Interrupted, Speech, Transcript, TurnComplete
from app.voice.output import OutputChannel
from app.voice.sink import sink


def audio(data: bytes):
    return SimpleNamespace(content=SimpleNamespace(parts=[SimpleNamespace(inline_data=SimpleNamespace(data=data))]))


class RecordingSocket:
    """Records what the writer sends. `stall` blocks every send until released, like a browser that stopped reading."""

    def __init__(self, stall: bool = False) -> None:
        self.sent: list = []
        self.gate = asyncio.Event()
        if not stall:
            self.gate.set()

    async def send_bytes(self, data: bytes) -> None:
        await self.gate.wait()
        self.sent.append(data)

    async def send_json(self, message: dict) -> None:
        await self.gate.wait()
        self.sent.append(message)


# ---- EventTranslator ----

def test_translator_orders_interrupted_before_the_new_audio_and_dedupes_transcripts():
    t = EventTranslator()
    event = SimpleNamespace(interrupted=True, content=audio(b"ab").content,
                            output_transcription=SimpleNamespace(text="Hi", finished=False))
    assert t.translate(event) == [Interrupted(), Speech(b"ab"), Transcript("assistant", "Hi")]
    # The whole text that follows its chunks is not repeated; after the turn ends a finished text goes out again.
    assert t.translate(SimpleNamespace(output_transcription=SimpleNamespace(text="Hi there", finished=True))) == []
    assert t.translate(SimpleNamespace(turn_complete=True)) == [TurnComplete()]
    assert t.translate(SimpleNamespace(input_transcription=SimpleNamespace(text="ok", finished=True))) == [Transcript("user", "ok")]


def test_translator_ignores_events_with_nothing_to_say():
    assert EventTranslator().translate(SimpleNamespace()) == []
    assert EventTranslator().translate(SimpleNamespace(content=SimpleNamespace(parts=[SimpleNamespace(inline_data=None)]))) == []


# ---- OutputChannel ----

def test_output_keeps_audio_and_messages_in_order():
    async def go():
        ws = RecordingSocket()
        out = OutputChannel(ws)
        out.control({"type": "action", "action": "navigate", "page": "about"})
        out.audio(b"1")
        out.control({"type": "turn_complete"})
        task = asyncio.create_task(out.run())
        await out.flush()
        task.cancel()
        return ws.sent

    assert asyncio.run(go()) == [{"type": "action", "action": "navigate", "page": "about"}, b"1", {"type": "turn_complete"}]


def test_interrupt_drops_queued_speech_but_keeps_messages():
    out = OutputChannel(RecordingSocket())
    out.audio(b"aaaa")
    out.control({"type": "action", "action": "navigate", "page": "about"})
    out.audio(b"bb")
    out.interrupt()
    kinds = [kind for kind, _ in out._queue]
    assert kinds == ["json", "json"]  # the action stays, then `interrupted`; no audio
    assert out._queue[-1][1] == {"type": "interrupted"}
    assert out.dropped_audio_bytes == 6 and out.interruptions == 1
    out.audio(b"new")  # the next turn's speech is queued after the interruption
    assert [kind for kind, _ in out._queue] == ["json", "json", "audio"]


def test_a_stalled_browser_cannot_block_the_producers_and_audio_stays_bounded():
    async def go():
        ws = RecordingSocket(stall=True)
        out = OutputChannel(ws, max_audio_bytes=100)
        task = asyncio.create_task(out.run())
        for _ in range(1000):  # a plain loop with no await: it would hang here if a producer waited on the socket
            out.audio(b"x" * 10)
        out.control({"type": "turn_complete"})
        await asyncio.sleep(0)
        queued = out._audio_bytes
        ws.gate.set()  # the browser reads again
        await out.flush()
        task.cancel()
        return queued, out.dropped_audio_bytes, ws.sent

    queued, dropped, sent = asyncio.run(go())
    assert queued <= 100 and dropped >= 9000
    assert sent[-1] == {"type": "turn_complete"}  # control is never dropped
    assert sum(len(item) for item in sent if isinstance(item, bytes)) <= 110


def test_the_writer_ends_quietly_when_the_browser_is_gone():
    class Gone(RecordingSocket):
        async def send_json(self, message: dict) -> None:
            raise RuntimeError('Cannot call "send" once a close message has been sent.')

    async def go():
        out = OutputChannel(Gone())
        out.control({"type": "turn_complete"})
        await asyncio.wait_for(out.run(), timeout=1)

    asyncio.run(go())  # returns, does not raise


# ---- the bridge: input and output are independent ----

class ScriptedLive:
    """Yields `count` audio events then ends; counts how many the bridge pulled."""

    def __init__(self, count: int) -> None:
        self.session_id = "split"
        self.continuity = None
        self.state = {"page": "home", "page_title": "Home", "screens": {}}
        self.count, self.pulled, self.sent_text = count, 0, []
        sink.open(self.session_id)

    async def events(self):
        for _ in range(self.count):
            self.pulled += 1
            yield audio(b"\x00\x01")
            await asyncio.sleep(0)

    async def send_audio(self, pcm: bytes) -> None: ...
    async def send_text(self, text: str) -> None: self.sent_text.append(text)
    async def send_image(self, jpeg: bytes) -> None: ...
    async def audio_end(self) -> None: ...
    def close(self) -> None: sink.close(self.session_id)


def test_model_events_keep_flowing_while_the_browser_is_stalled():
    async def go():
        ws = RecordingSocket(stall=True)
        live = ScriptedLive(200)
        bridge = Bridge(ws, live)  # type: ignore[arg-type]
        pumps = [asyncio.create_task(bridge.output_pump()), asyncio.create_task(bridge.model_to_browser())]
        for _ in range(400):
            await asyncio.sleep(0)
        pulled = live.pulled  # every event was read although the first send never finished
        ws.gate.set()
        await asyncio.wait_for(pumps[1], timeout=2)  # then the model pump ends once the queue has gone out
        pumps[0].cancel()
        live.close()
        return pulled, len(ws.sent)

    pulled, sent = asyncio.run(go())
    assert pulled == 200 and sent == 200


def test_visitor_input_is_processed_while_otto_output_is_stuck():
    """Text typed while Otto's speech cannot be delivered still reaches the model: input never waits on output."""
    class Socket(RecordingSocket):
        def __init__(self) -> None:
            super().__init__(stall=True)
            self.inbox = [{"type": "websocket.receive", "text": json.dumps({"type": "text", "text": "stop, wait"})}]

        async def receive(self) -> dict:
            return self.inbox.pop(0) if self.inbox else {"type": "websocket.disconnect"}

    async def go():
        ws = Socket()
        live = ScriptedLive(50)
        bridge = Bridge(ws, live)  # type: ignore[arg-type]
        output = asyncio.create_task(bridge.output_pump())
        model = asyncio.create_task(bridge.model_to_browser())
        await asyncio.sleep(0)
        await asyncio.wait_for(bridge.browser_to_model(), timeout=1)
        text = list(live.sent_text)
        model.cancel(); output.cancel()
        live.close()
        return text

    assert asyncio.run(go()) == ["stop, wait"]


def test_an_interruption_event_voids_speech_not_yet_sent_end_to_end():
    class InterruptingLive(ScriptedLive):
        async def events(self):
            for chunk in (b"1", b"2", b"3"):
                yield audio(chunk)
            yield SimpleNamespace(interrupted=True)
            yield audio(b"next")
            yield SimpleNamespace(turn_complete=True)

    async def go():
        ws = RecordingSocket(stall=True)  # nothing was delivered when the visitor spoke over Otto
        live = InterruptingLive(0)
        bridge = Bridge(ws, live)  # type: ignore[arg-type]
        output = asyncio.create_task(bridge.output_pump())
        model = asyncio.create_task(bridge.model_to_browser())
        for _ in range(20):
            await asyncio.sleep(0)
        ws.gate.set()
        await asyncio.wait_for(model, timeout=2)
        output.cancel()
        live.close()
        return ws.sent

    sent = asyncio.run(go())
    # At most the chunk already in flight when the browser stalled got out; the rest of the old turn never does.
    assert [item for item in sent if isinstance(item, bytes)] in ([b"next"], [b"1", b"next"])
    assert {"type": "interrupted"} in sent and sent[-1] == {"type": "turn_complete"}


def test_actions_are_delivered_as_typed_events_before_the_speech_that_follows():
    class ActingLive(ScriptedLive):
        async def events(self):
            sink.put(self.session_id, {"action": "navigate", "page": "about"})
            yield audio(b"\x01")

    async def go():
        ws = RecordingSocket()
        live = ActingLive(0)
        bridge = Bridge(ws, live)  # type: ignore[arg-type]
        output = asyncio.create_task(bridge.output_pump())
        await bridge.model_to_browser()
        output.cancel()
        live.close()
        return ws.sent

    assert asyncio.run(go()) == [{"type": "action", "action": "navigate", "page": "about"}, b"\x01"]
    assert Action({"action": "navigate"}).payload == {"action": "navigate"}
