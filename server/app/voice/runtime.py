"""Shared checks for ids and labels the page reports at runtime (D-23)."""
from __future__ import annotations

import re

#: 1 to 64 of A-Z a-z 0-9 _ . : -, starting with a letter or digit. Kept in sync with web/src/otto/runtimeId.ts.
RUNTIME_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}")
RUNTIME_TITLE_CHARS = 80
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def is_runtime_id(value: object) -> bool:
    return isinstance(value, str) and RUNTIME_ID.fullmatch(value) is not None


def runtime_title(value: object, fallback: str) -> str:
    """A short, single-line page-data label safe to place in session state and the model instruction."""
    if not isinstance(value, str):
        return fallback
    clean = re.sub(r"\s+", " ", _CONTROL.sub(" ", value)).strip()[:RUNTIME_TITLE_CHARS]
    return clean or fallback
