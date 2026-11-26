"""What Otto's server may persist, and best-effort redaction of what it does persist.

Pure and dependency-free (standard library only; no settings, no storage). Two parts:

1. `DATA_CLASSES`, a policy table as data, and `persist_allowed` (D-17, D-21, D-26).
2. `redact_text`, a pattern redactor for a CLOSED list of categories.

Redaction is best-effort, not a guarantee. It does not cover names, addresses or free-form
personal facts, and a pattern can miss an unusual format or, rarely, hit an unrelated value.
The matched values are never returned, logged or stored: callers get the clean text and the
sorted category names only.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class DataClassPolicy:
    name: str
    may_persist: bool
    sensitivity: str  # "normal" | "sensitive"
    retention: str  # the existing rule, stated; this table invents no number
    # What redaction means for this class: REDACTION_APPLIED (text goes through redact_text before it is
    # written), or a "not stored" / "n/a" statement. Nothing reads it at run time; it is documentation a test pins.
    redaction: str


REDACTION_APPLIED = "applied before write"
_NOT_STORED = "n/a (never stored)"
_NO_TEXT = "n/a (no free text)"

_POLICIES = (
    DataClassPolicy(
        "voice_transcript", False, "sensitive",
        "Not stored by the kit; lives only for the session (D-04). Never in continuity records (D-26).", _NOT_STORED,
    ),
    DataClassPolicy(
        "screenshot", False, "sensitive",
        "Never kept: forwarded to the model and dropped (D-21).", _NOT_STORED,
    ),
    DataClassPolicy(
        "camera_frame", False, "sensitive",
        "Never kept: forwarded to the model and dropped (D-21, D-30).", _NOT_STORED,
    ),
    DataClassPolicy(
        "file", False, "sensitive",
        "The kit stores no uploaded or captured files.", _NOT_STORED,
    ),
    DataClassPolicy(
        "tool_arguments", False, "sensitive",
        "Not stored; the session-local policy audit records the decision and outcome, not raw arguments.", _NOT_STORED,
    ),
    DataClassPolicy(
        "tool_results", False, "normal",
        "Not stored beyond the session; the session-local audit keeps outcomes only.", _NOT_STORED,
    ),
    DataClassPolicy(
        "memory_record", True, "normal",
        "Kept until the host forgets it, at most 500 records per identity (oldest replaced). "
        "Working memory is deleted from SQLite on startup and before memory operations once older than 24 hours (WORKING_RETENTION_SECONDS). "
        "Text is redacted before it is written; a record that needed redaction is marked sensitive.", REDACTION_APPLIED,
    ),
    DataClassPolicy(
        "continuity_record", True, "normal",
        "Task id, step id and saved time only. Expires after 7 days (RETENTION_SECONDS); removed on "
        "completion, cancellation or withdrawal (D-26).", _NO_TEXT,
    ),
    DataClassPolicy(
        "memory_audit", True, "sensitive",
        "Metadata only: at most 1000 events per hashed identity; older rows are pruned on the next audit write. "
        "Rows survive memory deletion to retain the metadata-only audit trail. Provenance is redacted before write.",
        REDACTION_APPLIED,
    ),
    DataClassPolicy(
        "continuity_withdrawal", True, "sensitive",
        "Hashed scope and identity key only; retained until the host explicitly re-enables continuity (D-26). "
        "No expiry, so withdrawal cannot silently lapse.",
        _NO_TEXT,
    ),
)

DATA_CLASSES: dict[str, DataClassPolicy] = {item.name: item for item in _POLICIES}


def policy_for(data_class: object) -> DataClassPolicy | None:
    return DATA_CLASSES.get(data_class) if isinstance(data_class, str) else None


def persist_allowed(data_class: object) -> bool:
    """True only for a known class whose policy allows persistence. Unknown or non-str fails closed."""
    policy = policy_for(data_class)
    return policy is not None and policy.may_persist


# ---- redaction ---------------------------------------------------------------------------------

CATEGORIES = ("card", "email", "phone", "secret")  # the closed list; `redact_text` returns a subset

# (?<![a-z0-9+.-]) starts a scheme only at the start of a run, so a long run of scheme characters is scanned once.
_CRED_URL = re.compile(r"(?i)(?<![a-z0-9+.-])([a-z][a-z0-9+.-]*://)[^\s/@:]+:[^\s/@]+@")
_URL_KEY_PARAM = re.compile(r"(?i)([?&](?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|key|secret|password)=)[^&\s#]+")
_BEARER = re.compile(r"(?i)\b(bearer\s+)[A-Za-z0-9._~+/=-]{16,}")
# The value class has no "=" (only trailing padding), so each match scans one run and "token=token=..." stays
# linear. The "has a digit" test is done in the callback, not in a lookahead that rescans the run.
_ASSIGNED = re.compile(
    r"(?i)\b((?:api[_-]?key|access[_-]?key|secret[_-]?key|client[_-]?secret|auth[_-]?token|access[_-]?token|token|secret)"
    r"[\"']?\s*[:=]\s*[\"']?)([A-Za-z0-9._~+/-]{12,}={0,2})"
)
_KNOWN_KEYS = re.compile(
    r"\b(?:sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{35}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}"
    r"|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})"
)
# The trigger, then the rest of the clause: a quoted value up to its closing quote, else everything up to a newline or a
# sentence-ending . ! ? that is followed by whitespace or the end (a passphrase is several words). One pass per run.
_PASSWORD = re.compile(
    r"(?i)\b((?:password|passcode|passphrase)[ \t]*(?:is|was|:|=)[ \t]*)"
    r"(\"[^\"\n]*\"?|'[^'\n]*'?|(?:[^\n.!?]|[.!?](?!\s|$))+)"
)
# "the password is required." / "is too weak.": a plain adjective that ends the sentence, not a value.
_PASSWORD_WORDS = frozenset({
    "a", "an", "the", "required", "incorrect", "wrong", "invalid", "missing", "expired", "weak", "too", "not",
    "empty", "reset", "set", "changed", "optional", "hidden", "case-sensitive", "correct", "needed", "blank",
})
_PASSWORD_MODIFIERS = frozenset({"too", "not"})


def _is_plain_password_word(value: str) -> bool:
    words = value.strip(" \t\"'").lower().split()
    if len(words) == 1:
        return words[0] in _PASSWORD_WORDS
    return len(words) == 2 and words[0] in _PASSWORD_MODIFIERS and words[1].isalpha()


_EMAIL = re.compile(r"(?<![\w.%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
_CARD = re.compile(r"(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])")
# NANP style (555) 123-4567 / 555-123-4567 / 555 123 4567, or an international number that starts with "+".
# Dots are not separators on purpose: 192.168.100.200 and 1.2.3.4567 are not phone numbers.
_PHONE = re.compile(
    r"(?<![\w-])(?:\+\d{1,3}[ -]?)?(?:\(\d{3}\)|\d{3})[ -]\d{3}[ -]\d{4}(?![\w-])"
    r"|(?<![\w-])\+\d{1,3}[ -]?\d{1,4}(?:[ -]?\d{2,4}){2,4}(?![\w-])"
)
_PLACEHOLDER = re.compile(r"\[(?:email|phone|card|secret)\]")


def luhn_valid(digits: str) -> bool:
    if not digits.isdigit() or not 13 <= len(digits) <= 19:
        return False
    total = 0
    for index, char in enumerate(reversed(digits)):
        value = int(char)
        if index % 2 == 1:
            value = value * 2 - 9 if value > 4 else value * 2
        total += value
    return total % 10 == 0


def has_placeholder(text: object) -> bool:
    """True when `text` already carries a redaction placeholder (a record that was redacted when written)."""
    return isinstance(text, str) and _PLACEHOLDER.search(text) is not None


def redact_text(text: object) -> tuple[str, tuple[str, ...]]:
    """Return (clean_text, categories). Categories are sorted and unique; values are never returned.

    Non-str input gives ("", ()). Best-effort: see the module docstring for what is not covered.
    """
    if not isinstance(text, str):
        return "", ()
    found: set[str] = set()

    def mark(category: str, replacement: str):
        def sub(_match: re.Match) -> str:
            found.add(category)
            return replacement
        return sub

    def keep_prefix(category: str):
        def sub(match: re.Match) -> str:
            found.add(category)
            return match.group(1) + "[secret]"
        return sub

    def assigned(match: re.Match) -> str:
        if not any(ch.isdigit() for ch in match.group(2)):  # prose such as "token: expired-session"
            return match.group(0)
        found.add("secret")
        return match.group(1) + "[secret]"

    def password(match: re.Match) -> str:
        if _is_plain_password_word(match.group(2)):
            return match.group(0)
        found.add("secret")
        return match.group(1) + "[secret]"

    def card(match: re.Match) -> str:
        digits = re.sub(r"\D", "", match.group(0))
        if luhn_valid(digits):
            found.add("card")
            return "[card]"
        return match.group(0)

    out = _CRED_URL.sub(lambda m: (found.add("secret"), m.group(1) + "[secret]@")[1], text)
    out = _URL_KEY_PARAM.sub(keep_prefix("secret"), out)
    out = _BEARER.sub(keep_prefix("secret"), out)
    out = _ASSIGNED.sub(assigned, out)
    out = _KNOWN_KEYS.sub(mark("secret", "[secret]"), out)
    out = _PASSWORD.sub(password, out)
    out = _EMAIL.sub(mark("email", "[email]"), out)
    out = _CARD.sub(card, out)
    out = _PHONE.sub(mark("phone", "[phone]"), out)
    return out, tuple(sorted(found))
