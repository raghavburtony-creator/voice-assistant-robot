"""The visitor stops a running background task (TASK-01, #49): the `cancel_task` message, checked on the server.

Only the visitor can do it (D-22): the message comes from the browser, and no tool reaches it.
"""
from __future__ import annotations

import asyncio

from app.voice import tools
from app.voice.bridge import Bridge
from tests.test_task_start import SlowSearch
from tests.test_tasks import Gate, run, settle
from tests.test_voice import FakeLive, ScriptedSocket


def cancel(task_id: object) -> dict:
    return {"type": "cancel_task", "id": task_id}


async def drive(*messages: dict, setup=None):
    """A bridge that reads `messages` from the browser after `setup(bridge)` has started its tasks."""
    ws, live = ScriptedSocket(*messages), FakeLive()
    bridge = Bridge(ws, live)  # type: ignore[arg-type]
    pump = asyncio.create_task(bridge.output_pump())
    if setup is not None:
        setup(bridge)
    await settle(10)
    await bridge.browser_to_model()
    await settle(10)
    await bridge.out.flush()
    pump.cancel()
    states = {s.id: (s.state, s.reason) for s in bridge.tasks.snapshots()}
    sent_text = list(live.sent_text)
    await bridge.close()
    return states, ws.sent, sent_text


def avatars(sent: list) -> list[dict]:
    return [m["event"] for m in sent if isinstance(m, dict) and m.get("type") == "avatar"]


def test_the_visitor_stops_a_running_task_and_the_model_hears_it_was_cancelled():
    gate = Gate()
    states, sent, sent_text = run(drive(cancel("task-1"), setup=lambda b: b.tasks.submit("A long job", gate)))
    assert states == {"task-1": ("cancelled", "cancelled")}
    assert {"kind": "failure", "id": "task-1", "topic": "A long job", "message": "Cancelled."} in avatars(sent)
    assert len(sent_text) == 1 and "State: cancelled" in sent_text[0] and "not an instruction or permission" in sent_text[0]


def test_stopping_a_project_search_shows_no_card_and_forgets_its_title(monkeypatch):
    monkeypatch.setattr(tools, "PROJECT_RESEARCH_SERVICE", SlowSearch(asyncio.Event()))  # never opened

    async def go():
        holder: dict = {}

        def start(bridge):
            holder["bridge"] = bridge
            bridge._start_task({"kind": "project_research", "query": "anything"})

        states, sent, sent_text = await drive(cancel("task-1"), setup=start)
        return states, sent, sent_text, holder["bridge"]._card_titles

    states, sent, sent_text, titles = run(go())
    assert states == {"task-1": ("cancelled", "cancelled")} and titles == {}
    assert not [m for m in sent if isinstance(m, dict) and m.get("action") == "card"]
    assert len(sent_text) == 1


def test_a_bad_unknown_or_finished_id_changes_nothing_and_says_nothing():
    async def done(ctx):
        return "ok"

    def setup(bridge):
        bridge.tasks.submit("Running", Gate())
        bridge.tasks.submit("Finished", done)

    bad = (None, 5, True, [], {}, "", " task-1", "bad id", "../task-1", "x" * 200, "task-99", "task-2")
    before_after, sent, sent_text = run(drive(*[cancel(i) for i in bad], setup=setup))
    assert before_after == {"task-1": ("running", None), "task-2": ("completed", None)}
    assert [e["kind"] for e in avatars(sent)] == ["working", "working", "success"]  # nothing about a cancel
    assert len(sent_text) == 1  # only the finished task's own ending


def test_a_task_that_cannot_be_stopped_safely_keeps_running_and_otto_says_so():
    states, sent, sent_text = run(drive(
        cancel("task-1"), setup=lambda b: b.tasks.submit("Sensitive", Gate(), cancellable=False)))
    assert states == {"task-1": ("running", None)}
    assert {"kind": "waiting", "message": "That can't be stopped safely right now."} in avatars(sent)
    assert sent_text == []


def test_stopping_a_task_twice_is_harmless():
    states, sent, sent_text = run(drive(cancel("task-1"), cancel("task-1"), setup=lambda b: b.tasks.submit("Job", Gate())))
    assert states == {"task-1": ("cancelled", "cancelled")}
    assert [e["kind"] for e in avatars(sent)].count("failure") == 1 and len(sent_text) == 1


def test_no_model_tool_can_cancel_a_task():
    # D-22: stopping a task is the visitor's act. A tool that did it would let the model undo what the visitor asked for.
    assert not [name for name in tools.TOOL_NAMES if "cancel" in name or name == "stop_task"]
    registered = {fn.__name__: fn.__doc__ or "" for fn in tools.TOOL_FUNCTIONS}
    assert "cancel_task" not in registered
