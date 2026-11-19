"""Echo's tools. Model output is untrusted, so every argument is checked here, and the browser checks every action again.

A tool that should change something in the browser returns a `client_action`; it is queued in the sink and sent to the browser.
To add a tool: write the function below, add it to TOOLS, and (if it sends an action) handle that action in
web/src/echo.config.ts `isAllowedAction` and in App's `onAction`.
"""
from __future__ import annotations

import logging
from typing import Literal

from google.adk.tools import FunctionTool, ToolContext

from app.voice.app_config import COMMANDS, PAGE_IDS, PAGES
from app.voice.sink import sink

logger = logging.getLogger(__name__)

#: ADK turns a Literal into an enum the model sees. Written out because a Literal must be static; a test checks it equals PAGE_IDS.
PageId = Literal["home", "features", "about"]
Command = Literal["show_message", "toggle_theme"]


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
    logger.info("Echo ran a %s command", command)
    return {"ok": True, "command": command}


TOOLS = [FunctionTool(fn) for fn in (navigate_to, explain_page, get_screen_context, run_command)]
TOOL_NAMES = frozenset(tool.name for tool in TOOLS)
