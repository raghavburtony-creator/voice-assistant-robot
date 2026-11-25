"""Page-scoped browser context rules shared by the voice tools and bridge (D-23)."""
from __future__ import annotations

PAGE_SCOPED_CONTEXT_KEYS = ("guide_targets", "guide_tasks", "destinations")


def clear_page_context(screens: dict) -> None:
    """Invalidate lists reported by the page being left; retain conversation/task state."""
    for key in PAGE_SCOPED_CONTEXT_KEYS:
        if key in screens:
            screens[key] = None
