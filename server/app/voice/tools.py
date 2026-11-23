"""Otto's tools. Model output is untrusted, so every argument is checked here, and the browser checks every action again.

A tool that should change something in the browser returns a `client_action`; it is queued in the sink and sent to the browser.
To add a tool: write the function below, add it to TOOLS, and (if it sends an action) handle that action in
web/src/otto.config.ts `isAllowedAction` and in App's `onAction`.
"""
from __future__ import annotations

import logging
import re
from typing import Literal, get_args

from google.adk.tools import FunctionTool, ToolContext

from app.voice.app_config import COMMANDS, PAGE_IDS, PAGES
from app.voice.sink import sink

logger = logging.getLogger(__name__)

#: ADK turns a Literal into an enum the model sees. Written out because a Literal must be static; a test checks it equals PAGE_IDS.
PageId = Literal["home", "features", "about"]
Command = Literal["show_message", "toggle_theme"]
#: The voice's moves on a running guided task; a test checks it equals GUIDE_TASK_MOVES in web/src/otto/guidance/task.ts.
TaskMove = Literal["stop", "back", "next"]


def _send(tool_context: ToolContext, action: dict) -> None:
    sink.put(tool_context.session.id, action)


def navigate_to(page: PageId, tool_context: ToolContext) -> dict:
    """Take the user to a page of the app."""
    if page not in PAGES:
        return {"error": f"Unknown page. Valid pages: {', '.join(PAGE_IDS)}"}
    _send(tool_context, {"action": "navigate", "page": page})
    # Later tools in this turn see the new page.
    tool_context.state["page"] = page
    tool_context.state["page_title"] = PAGES[page]["title"]
    return {"ok": True, "now_on": PAGES[page]["title"]}


def explain_page(page: PageId, tool_context: ToolContext) -> dict:
    """Get what a page is for and the exact steps to use it."""
    if page not in PAGES:
        return {"error": f"Unknown page. Valid pages: {', '.join(PAGE_IDS)}"}
    return {"page": page, **PAGES[page]}


def get_screen_context(tool_context: ToolContext) -> dict:
    """What the user has open right now: the current page and whatever the page reported about itself."""
    state = tool_context.state
    page = state.get("page", "home")
    screens = {key: value for key, value in (state.get("screens") or {}).items() if value is not None}
    return {"current_page": {"id": page, "title": PAGES.get(page, PAGES["home"])["title"]},
            **(screens or {"note": "The page has reported nothing else."})}


def run_command(command: Command, tool_context: ToolContext) -> dict:
    """Run one of the app's commands in the browser: show_message shows an example message, toggle_theme switches light and dark."""
    if command not in COMMANDS:
        return {"error": f"Unknown command. Valid commands: {', '.join(COMMANDS)}"}
    _send(tool_context, {"action": "command", "name": command})
    logger.info("Otto ran a %s command", command)
    return {"ok": True, "command": command}


def show_target(target_id: str, tool_context: ToolContext) -> dict:
    """Have Otto point at something on the user's current page. Use it when the user asks where something is, what something is,
    how to do something on this page, or says "show me". target_id must be one of the ids from get_screen_context under
    guide_targets; never invent one. Then explain it in one or two plain sentences."""
    screens = tool_context.state.get("screens") or {}
    reported = (screens.get("guide_targets") or {}).get("targets")
    targets = {t["id"]: t for t in reported if isinstance(t, dict) and isinstance(t.get("id"), str)} if isinstance(reported, list) else {}
    if not isinstance(target_id, str) or not target_id or len(target_id) > 64 or target_id not in targets:
        return {"ok": False, "error": "Unknown target. Use one of the known ids.", "known": list(targets)}
    found = targets[target_id]
    # The page reports a target it has but is not drawing (collapsed, display: none): Otto can't point at it. Say so, don't pretend.
    if found.get("hidden") is True:
        return {"ok": False, "error": "That target is on this page but hidden right now. Tell the user how to reveal it, "
                "or offer another target.", "target": target_id}
    _send(tool_context, {"action": "guide", "target": target_id})
    out = {"ok": True, "label": found.get("label"), "description": found.get("description")}
    if found.get("disabled") is True:
        out["disabled"] = True
        out["note"] = "It is disabled right now: say so, and what usually enables it if the page says."
    return out


def start_guided_task(task_id: str, tool_context: ToolContext) -> dict:
    """Have Otto walk the user through a task on this page, step by step: he shows each part in turn and notices as the
    user does each step. Use it when the user asks for help doing something ("how do I...", "help me with...") and a task
    in get_screen_context under guide_tasks fits. task_id must be one of those ids; never invent one. Otto says each step
    himself, so only introduce it in one short sentence; don't read the steps out."""
    screens = tool_context.state.get("screens") or {}
    reported = (screens.get("guide_tasks") or {}).get("tasks")
    tasks = {t["id"]: t for t in reported if isinstance(t, dict) and isinstance(t.get("id"), str)} if isinstance(reported, list) else {}
    if not isinstance(task_id, str) or not task_id or len(task_id) > 64 or task_id not in tasks:
        return {"ok": False, "error": "Unknown task. Use one of the known ids.", "known": list(tasks)}
    _send(tool_context, {"action": "task", "task": task_id})
    found = tasks[task_id]
    return {"ok": True, "title": found.get("title"), "steps": found.get("steps")}



def move_guided_task(move: TaskMove, tool_context: ToolContext) -> dict:
    """Steer the guided task Otto is walking the user through (guide_task_running in get_screen_context): stop ends it,
    back returns to the previous step, next counts the current step as done and moves on. Use it when the user says
    "stop the tour", "go back" or "I've done that, skip it", and only while a task is running. Otto then shows the new
    step himself; say in a few words what you did."""
    if move not in get_args(TaskMove):
        return {"ok": False, "error": "Unknown move. Use stop, back or next."}
    running = (tool_context.state.get("screens") or {}).get("guide_task_running")
    if not isinstance(running, dict) or not isinstance(running.get("id"), str):
        return {"ok": False, "error": "No guided task is running."}
    if move == "back" and running.get("step") == 1:
        return {"ok": False, "error": "The user is already on the first step."}
    _send(tool_context, {"action": "task_move", "move": move})
    return {"ok": True, "move": move, "task": running.get("title")}

#: Caps for show_card. The card is text in the panel (never HTML, never a link: D-02, D-18), so these only bound its size.
CARD_TITLE_CHARS = 80
CARD_BODY_CHARS = 600
CARD_CODE_CHARS = 2000
CARD_FOLLOW_UPS = 3
CARD_FOLLOW_UP_CHARS = 80
_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")


def _card_text(value: object, cap: int, keep_lines: bool = False) -> str:
    if not isinstance(value, str):
        return ""
    text = _CONTROL.sub(" ", value)
    if not keep_lines:
        text = re.sub(r"\s+", " ", text)
    return text.strip()[:cap]


# `follow_ups: list[str] = []`, not `list[str] | None`: the Optional form becomes an anyOf in the function schema, which the
# Live API's function declarations may not accept (ASSUMPTION, unverified: Q-01). The default is never mutated.
def show_card(title: str, body: str, tool_context: ToolContext, code: str = "", follow_ups: list[str] = []) -> dict:  # noqa: B006
    """Put a card in the user's voice panel, for what is better read than heard: exact steps, a value to copy, code.
    title: a few words. body: plain text, at most a short paragraph (no markdown, no links). code: optional text to copy,
    shown as-is. follow_ups: up to 3 short questions the user can tap to ask next. Don't read the card out: say in one
    sentence that it's in the panel."""
    clean_title = _card_text(title, CARD_TITLE_CHARS)
    clean_body = _card_text(body, CARD_BODY_CHARS)
    if not clean_title or not clean_body:
        return {"ok": False, "error": "A card needs a title and a body."}
    card: dict = {"title": clean_title, "body": clean_body}
    clean_code = _card_text(code, CARD_CODE_CHARS, keep_lines=True)
    if clean_code:
        card["code"] = clean_code
    if isinstance(follow_ups, list):
        chips = [c for c in (_card_text(f, CARD_FOLLOW_UP_CHARS) for f in follow_ups) if c][:CARD_FOLLOW_UPS]
        if chips:
            card["follow_ups"] = chips
    _send(tool_context, {"action": "card", "card": card})
    return {"ok": True, "shown": "in the voice panel"}


TOOLS = [FunctionTool(fn) for fn in (navigate_to, explain_page, get_screen_context, run_command, show_target, start_guided_task, move_guided_task, show_card)]
TOOL_NAMES = frozenset(tool.name for tool in TOOLS)
