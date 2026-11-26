"""PRIV-01 slice 1: the data-class policy, pattern redaction, memory redaction, the log scrub and forget_identity."""
from __future__ import annotations

import ast
import sqlite3
import time
from pathlib import Path

import pytest

from app.voice import route
from app.voice.continuity_store import RETENTION_SECONDS, ContinuityRecord, SQLiteContinuityStore
from app.voice.forget import forget_identity
from app.voice.memory_service import WORKING_RETENTION_SECONDS, SQLiteMemoryService
from app.voice.perception import PerceptionGateway
from app.voice.privacy import CATEGORIES, DATA_CLASSES, REDACTION_APPLIED, luhn_valid, persist_allowed, redact_text

APP = Path(__file__).resolve().parents[1] / "app"


# ---- the policy table -------------------------------------------------------------------------

def test_raw_multimodal_and_files_are_never_persistable():
    for name in ("camera_frame", "screenshot", "file"):
        assert persist_allowed(name) is False


def test_unknown_or_malformed_class_fails_closed():
    for value in ("selfie", "", "MEMORY_RECORD", None, 5, b"memory_record", ["memory_record"]):
        assert persist_allowed(value) is False


def test_only_the_two_stores_may_persist():
    assert {n for n, p in DATA_CLASSES.items() if p.may_persist} == {"memory_record", "continuity_record"}
    assert set(DATA_CLASSES) == {
        "voice_transcript", "screenshot", "camera_frame", "file", "tool_arguments", "tool_results",
        "memory_record", "continuity_record",
    }


def test_retention_text_states_the_existing_rules():
    assert str(WORKING_RETENTION_SECONDS // 3600) + " hours" in DATA_CLASSES["memory_record"].retention
    assert f"{RETENTION_SECONDS // 86400} days" in DATA_CLASSES["continuity_record"].retention
    assert DATA_CLASSES["memory_record"].redaction == REDACTION_APPLIED


def test_policy_states_the_truth_about_redaction():
    for name, policy in DATA_CLASSES.items():
        if policy.may_persist:
            continue
        assert "never stored" in policy.redaction and policy.redaction != REDACTION_APPLIED, name
        assert "not stored" in policy.retention.lower() or "never kept" in policy.retention.lower() or "stores no" in policy.retention.lower(), name
    claiming = {n for n, p in DATA_CLASSES.items() if p.redaction == REDACTION_APPLIED}
    assert claiming == {"memory_record"}
    assert "no free text" in DATA_CLASSES["continuity_record"].redaction


# ---- redaction: each category, positive and negative -----------------------------------------

POSITIVE = [
    ("email", "write to jo.smith+test@mail.example.co.uk today", "write to [email] today"),
    ("phone", "call (555) 123-4567 please", "call [phone] please"),
    ("phone", "call 555-123-4567", "call [phone]"),
    ("phone", "reach me on +44 20 7946 0958", "reach me on [phone]"),
    ("card", "card 4111 1111 1111 1111 expires soon", "card [card] expires soon"),
    ("card", "pay with 4111-1111-1111-1111", "pay with [card]"),
    ("secret", "key sk-abcdefghijklmnopqrstu1234", "key [secret]"),
    ("secret", "Authorization: Bearer abcdefghijklmnop1234", "Authorization: Bearer [secret]"),
    ("secret", "see https://user:hunter22@db.example.com/x", "see https://[secret]@db.example.com/x"),
    ("secret", "GET /v1?api_key=abc123def456&x=1", "GET /v1?api_key=[secret]&x=1"),
    ("secret", "api_key = 'abcd1234efgh5678'", "api_key = '[secret]'"),
    ("secret", "my password is hunter2.", "my password is [secret]."),
    ("secret", "passcode: 8841", "passcode: [secret]"),
    ("secret", "password is correct horse battery staple", "password is [secret]"),
    ("secret", "my password is correct horse battery staple. Thanks", "my password is [secret]. Thanks"),
    ("secret", "password: 'my secret phrase'", "password: [secret]"),
    ("secret", 'passphrase = "blue cheese rocket"', "passphrase = [secret]"),
    ("secret", "password: 'my secret phrase' and more", "password: [secret] and more"),
    ("secret", "password is hunter2\nnext line", "password is [secret]\nnext line"),
    ("secret", "AIza" + "A" * 35, "[secret]"),
]


@pytest.mark.parametrize("category,text,expected", POSITIVE)
def test_redacts_each_category(category, text, expected):
    clean, categories = redact_text(text)
    assert clean == expected
    assert categories == (category,)


NEGATIVE = [
    "order 1234567890123 shipped",            # 13 digits, fails Luhn
    "card 4111 1111 1111 1112",               # one digit off: not a card
    "version 1.2.3 and 10.0.19045.5555",
    "server at 192.168.100.200 and 10.0.0.1",
    "on 2026-11-26 at 10:30",
    "total 10 000 000 units, id 20261126",
    "ORD-123-456-7890 is late",               # glued to a letter prefix: an id, not a phone
    "the password is required",
    "Your password is incorrect.",
    "the password is incorrect",
    "the password is too weak.",
    "password reset link",
    "token: expired-session",                 # no digits: prose, not a key
    "email us at support at example dot com",
    "ask@",
    "time 12:34:56, build 4111",
]


@pytest.mark.parametrize("text", NEGATIVE)
def test_leaves_ordinary_text_alone(text):
    assert redact_text(text) == (text, ())


def test_luhn():
    assert luhn_valid("4111111111111111") and luhn_valid("5500005555555559")
    assert not luhn_valid("4111111111111112")
    assert not luhn_valid("411111") and not luhn_valid("abcd") and not luhn_valid("4" * 20)


def test_categories_are_sorted_unique_and_values_never_returned():
    text = "a@b.co and c@d.co, 4111 1111 1111 1111, password is hunter2"
    clean, categories = redact_text(text)
    assert categories == ("card", "email", "secret")
    assert set(categories) <= set(CATEGORIES)
    for value in ("a@b.co", "4111", "hunter2"):
        assert value not in clean and value not in repr(categories)
    assert redact_text(clean)[0] == clean  # idempotent


@pytest.mark.parametrize("value", [None, 5, b"a@b.co", ["a@b.co"], {"x": 1}])
def test_non_str_is_safe(value):
    assert redact_text(value) == ("", ())


# ---- adversarial input: no pattern may go quadratic --------------------------------------------

ADVERSARIAL = [
    "token=" * 30000, "a://" * 30000, "a." * 100000 + "@b", "a" * 200000 + "@", "a@b" + "-b" * 100000,
    "a+" * 100000, "1 " * 100000, "1-" * 100000, "+1 " * 60000, "555 " * 60000, "password: " * 30000,
    "bearer " * 30000, "token" + " " * 200000 + "=", "api_key=" + "a" * 200000, "?key=" * 30000, "eyJ" + "a" * 200000,
    "%" * 100000, "a%" * 50000,  # the email local part allows '%', so its lookbehind must too (it was quadratic)
]


@pytest.mark.parametrize("text", ADVERSARIAL, ids=[f"adv{i}" for i in range(len(ADVERSARIAL))])
def test_large_adversarial_input_stays_fast(text):
    start = time.perf_counter()
    redact_text(text)
    assert time.perf_counter() - start < 2.0


def test_long_assigned_secret_is_fully_redacted():
    assert redact_text("token=" + "ab12" * 500) == ("token=[secret]", ("secret",))


# ---- memory ------------------------------------------------------------------------------------

@pytest.fixture
def memory(tmp_path):
    return SQLiteMemoryService(tmp_path / "memory.sqlite3")


def test_memory_redacts_before_writing_and_forces_sensitive(memory, tmp_path):
    rec = memory.remember(
        "demo", "a", "Reach me at jo@example.com or 4111 1111 1111 1111",
        provenance="said password is hunter2", explicit=True, now=100,
    )
    assert rec.content == "Reach me at [email] or [card]"
    assert rec.provenance == "said password is [secret]"
    assert rec.sensitivity == "sensitive"
    assert memory.recall("demo", "a", now=100) == []  # sensitive: not offered by default
    raw = "".join(sqlite3.connect(tmp_path / "memory.sqlite3").iterdump())
    for value in ("jo@example.com", "4111", "hunter2"):
        assert value not in raw


def test_clean_memory_stays_normal(memory):
    rec = memory.remember("demo", "a", "Prefers short answers", provenance="explicit request", explicit=True, now=1)
    assert rec.sensitivity == "normal"


def test_update_redacts_and_never_lowers(memory):
    rec = memory.remember("demo", "a", "Likes tea", provenance="explicit request", explicit=True, now=1)
    upd = memory.update("demo", "a", rec.id, content="Mail jo@example.com", explicit=True, now=2)
    assert upd.content == "Mail [email]" and upd.sensitivity == "sensitive"
    again = memory.update("demo", "a", rec.id, sensitivity="normal", explicit=True, now=3)
    assert again.sensitivity == "sensitive"  # the stored placeholder shows it was redacted
    plain = memory.update("demo", "a", rec.id, content="Likes coffee", sensitivity="normal", explicit=True, now=4)
    assert plain.sensitivity == "normal"  # nothing redacted any more: the host's explicit choice stands


def test_audit_holds_categories_never_values(memory, tmp_path):
    rec = memory.remember("demo", "a", "x jo@example.com", provenance="p 4111 1111 1111 1111", explicit=True, now=1)
    memory.update("demo", "a", rec.id, content="clean", explicit=True, now=2)
    events = memory.audit_events("demo", "a")
    assert events[1]["redacted"] == ["card", "email"] and events[0]["redacted"] == []
    audit = str(sqlite3.connect(tmp_path / "memory.sqlite3").execute("SELECT * FROM memory_audit").fetchall())
    assert "example.com" not in audit and "4111" not in audit


def test_audit_column_is_added_to_an_existing_database(tmp_path):
    path = tmp_path / "old.sqlite3"
    db = sqlite3.connect(path)
    db.execute("""CREATE TABLE memory_audit (audit_id TEXT PRIMARY KEY, identity_key TEXT NOT NULL, record_id TEXT NOT NULL,
                action TEXT NOT NULL, provenance TEXT NOT NULL, created_at INTEGER NOT NULL)""")
    db.execute("INSERT INTO memory_audit VALUES ('1','k','r','remember','p',1)")
    db.commit(); db.close()
    service = SQLiteMemoryService(path)
    service.remember("demo", "a", "hi", provenance="explicit request", explicit=True, now=2)
    assert service.audit_events("demo", "a")[0]["redacted"] == []
    assert sqlite3.connect(path).execute("SELECT redacted FROM memory_audit WHERE audit_id='1'").fetchone() == ("",)


def test_explicit_authorisation_is_unchanged(memory):
    with pytest.raises(PermissionError):
        memory.remember("demo", "a", "jo@example.com", provenance="p")
    with pytest.raises(PermissionError):
        memory.forget_all("demo", "a")


# ---- the log scrub -----------------------------------------------------------------------------

def test_scrub_redacts_patterns_and_still_scrubs_the_key(monkeypatch):
    monkeypatch.setattr(route.settings, "gemini_api_key", type(route.settings.gemini_api_key)("zz-live-key-value"))
    out = route._scrub("failed for jo@example.com with zz-live-key-value, card 4111 1111 1111 1111")
    assert out == "failed for [email] with [redacted], card [card]"
    assert route._scrub("connection reset by peer") == "connection reset by peer"


# ---- forget_identity ---------------------------------------------------------------------------

def test_forget_identity_clears_both_stores_and_leaves_others(tmp_path):
    NOW = int(time.time())
    memory = SQLiteMemoryService(tmp_path / "m.sqlite3")
    store = SQLiteContinuityStore(tmp_path / "c.sqlite3")
    for who in ("a", "b"):
        memory.remember("demo", who, f"fact {who}", provenance="explicit request", explicit=True, now=10)
        memory.remember("demo", who, f"two {who}", provenance="explicit request", explicit=True, now=11)
        store.save(ContinuityRecord("demo", "tour", "step1", NOW), who)
    memory.remember("other-app", "a", "same identity, other scope", provenance="explicit request", explicit=True, now=10)

    with pytest.raises(PermissionError):
        forget_identity(memory, store, "demo", "a")
    assert len(memory.recall("demo", "a", now=12)) == 2  # refused call changed nothing

    assert forget_identity(memory, store, "demo", "a", explicit=True) == {"memory_records": 2, "continuity_records": 1}
    assert memory.recall("demo", "a", now=12) == [] and store.load("demo", "a", now=NOW + 1) is None
    assert len(memory.recall("demo", "b", now=12)) == 2 and store.load("demo", "b", now=NOW + 1) is not None
    assert len(memory.recall("other-app", "a", now=12)) == 1
    # D-26: withdrawal holds until the host re-enables
    store.save(ContinuityRecord("demo", "tour", "step2", NOW), "a")
    assert store.load("demo", "a", now=NOW + 1) is None
    store.enable("demo", "a")
    store.save(ContinuityRecord("demo", "tour", "step2", NOW), "a")
    assert store.load("demo", "a", now=NOW + 1) is not None
    last = memory.audit_events("demo", "a")
    assert any(e["action"] == "forget_all" for e in last)
    forgot = next(e for e in last if e["action"] == "forget_all")
    assert forgot["provenance"] == "count=2" and forgot["redacted"] == []


def test_forget_identity_reports_a_partial_failure(tmp_path):
    from app.voice.forget import ForgetIncomplete

    memory = SQLiteMemoryService(tmp_path / "m.sqlite3")
    store = SQLiteContinuityStore(tmp_path / "c.sqlite3")
    memory.remember("demo", "a", "Likes tea", provenance="explicit request", explicit=True, now=1)

    class Broken(SQLiteContinuityStore):
        def disable(self, scope, identity):
            raise sqlite3.OperationalError("disk I/O error for a")

    with pytest.raises(ForgetIncomplete) as info:
        forget_identity(memory, Broken(tmp_path / "c.sqlite3"), "demo", "a", explicit=True)
    assert info.value.failed == ("continuity_records",) and info.value.done == {"memory_records": 1}
    assert "disk I/O" not in str(info.value) and memory.recall("demo", "a", include_sensitive=True, now=1) == []
    assert forget_identity(memory, store, "demo", "a", explicit=True) == {"memory_records": 0, "continuity_records": 0}


def test_forget_identity_strips_the_scope_like_the_session_does(tmp_path):
    memory = SQLiteMemoryService(tmp_path / "m.sqlite3")
    store = SQLiteContinuityStore(tmp_path / "c.sqlite3")
    store.save(ContinuityRecord("demo", "t1", "s1", int(time.time())), "a")
    assert forget_identity(memory, store, " demo ", "a", explicit=True)["continuity_records"] == 1


def test_forget_identity_with_nothing_stored(tmp_path):
    memory = SQLiteMemoryService(tmp_path / "m.sqlite3")
    store = SQLiteContinuityStore(tmp_path / "c.sqlite3")
    assert forget_identity(memory, store, "demo", "nobody", explicit=True) == {"memory_records": 0, "continuity_records": 0}


# ---- raw multimodal data is never written to disk ----------------------------------------------

_WRITE_ATTRS = {"write_bytes", "write_text", "mkstemp", "NamedTemporaryFile", "TemporaryFile", "SpooledTemporaryFile",
                "copyfile", "copy", "move", "dump"}
_IMAGE_WORDS = ("frame", "jpeg", "screenshot", "image", "pixel")


def _disk_sinks(source: str) -> list[str]:
    """Names of calls that can write to disk: open() for writing, Path writers, tempfile, shutil, dump, sqlite3.connect."""
    found = []
    for node in ast.walk(ast.parse(source)):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        name = fn.id if isinstance(fn, ast.Name) else fn.attr if isinstance(fn, ast.Attribute) else ""
        owner = fn.value.id if isinstance(fn, ast.Attribute) and isinstance(fn.value, ast.Name) else ""
        if name == "open":  # open(), os.open, io.open, Path(p).open(): a write mode (or unknown mode) counts
            index = 1 if isinstance(fn, ast.Name) or owner in ("os", "io", "codecs", "gzip") else 0  # Path(p).open(mode)
            mode = node.args[index] if len(node.args) > index else next((k.value for k in node.keywords if k.arg == "mode"), None)
            builtin = index == 1  # a non-literal mode is unknown, so a write; on a method (sink.open(id)) it is just an argument
            if owner == "os" or (mode is not None and (
                (not isinstance(mode, ast.Constant) and builtin) or (isinstance(mode, ast.Constant) and any(c in str(mode.value) for c in "wax+"))
            )):
                found.append("open")
        elif name in _WRITE_ATTRS or (name == "connect" and owner == "sqlite3"):
            found.append(f"{owner}.{name}")
    return found


def test_the_scanner_can_fail():
    assert _disk_sinks("open('f.jpg', 'wb')") == ["open"]
    assert _disk_sinks("open(path, mode)") == ["open"]  # unknown mode: treated as a write
    assert _disk_sinks("open('f')") == [] and _disk_sinks("sink.open(session_id)") == []
    assert _disk_sinks("Path(p).open('w')") == ["open"] and _disk_sinks("Path(p).open()") == []
    assert _disk_sinks("p.write_bytes(b)") == ["p.write_bytes"] and _disk_sinks("sqlite3.connect(x)") == ["sqlite3.connect"]


def test_only_the_two_stores_touch_disk_and_neither_handles_images():
    writers = {}
    for path in sorted(APP.rglob("*.py")):
        sinks = _disk_sinks(path.read_text(encoding="utf-8"))
        if sinks:
            writers[path.name] = sinks
    assert set(writers) == {"memory_service.py", "continuity_store.py"}, writers
    for name in writers:
        tree = ast.parse((APP / "voice" / name).read_text(encoding="utf-8"))
        idents = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)} | {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)} \
            | {a.arg for n in ast.walk(tree) if isinstance(n, ast.arguments) for a in n.args + n.kwonlyargs}
        assert not [i for i in idents if any(w in i.lower() for w in _IMAGE_WORDS)], (name, idents)


def test_a_frame_goes_through_the_gateway_without_any_write(monkeypatch, tmp_path):
    def refuse(*_a, **_k):
        raise AssertionError("a frame must not reach disk")

    gateway = PerceptionGateway()
    gateway.set_consent("camera", True)
    monkeypatch.setattr("builtins.open", refuse)
    monkeypatch.setattr(sqlite3, "connect", refuse)
    monkeypatch.setattr(Path, "write_bytes", refuse)
    monkeypatch.setattr(Path, "write_text", refuse)
    observation = gateway.ingest_frame("camera", b"\xff\xd8\xff" + b"x" * 50, timestamp=1.0)
    assert gateway.drop_frame_data("camera", observation.id)
    assert gateway.latest("camera").data is None
    assert not any(tmp_path.iterdir())


# ---- the log scrub is bounded and never raises -------------------------------------------------

def _set_key(monkeypatch, value):
    monkeypatch.setattr(route.settings, "gemini_api_key", type(route.settings.gemini_api_key)(value))


def test_scrub_survives_a_failing_redactor_and_keeps_the_key_out(monkeypatch):
    _set_key(monkeypatch, "zz-live-key-value")

    def boom(_text):
        raise RuntimeError("redactor broke on zz-live-key-value")

    monkeypatch.setattr(route, "redact_text", boom)
    out = route._scrub("failed with zz-live-key-value for jo@example.com")
    assert isinstance(out, str) and "zz-live-key-value" not in out and "jo@example.com" not in out


def test_scrub_is_bounded_and_fast_for_huge_input(monkeypatch):
    _set_key(monkeypatch, "zz-live-key-value")
    start = time.perf_counter()
    out = route._scrub("x" * 1_000_000)
    assert time.perf_counter() - start < 0.5
    assert len(out) < 2100 and out.endswith("[truncated]")


def test_scrub_with_no_configured_key(monkeypatch):
    _set_key(monkeypatch, "")
    assert route._scrub("reset for jo@example.com") == "reset for [email]"
    assert route._scrub(ValueError("bad")) == "bad"  # non-str input does not raise


# ---- memory: provenance redaction on every write path, and the cap -----------------------------

def test_update_redacts_a_secret_in_provenance(memory, tmp_path):
    rec = memory.remember("demo", "a", "Likes tea", provenance="explicit request", explicit=True, now=1)
    upd = memory.update("demo", "a", rec.id, provenance="told me password is hunter2", explicit=True, now=2)
    assert upd.provenance == "told me password is [secret]" and upd.sensitivity == "sensitive"
    assert "hunter2" not in "".join(sqlite3.connect(tmp_path / "memory.sqlite3").iterdump())


def test_forget_redacts_a_secret_in_provenance(memory, tmp_path):
    rec = memory.remember("demo", "a", "Likes tea", provenance="explicit request", explicit=True, now=1)
    assert memory.forget("demo", "a", rec.id, explicit=True, provenance="asked, password is hunter2", now=2)
    audit = memory.audit_events("demo", "a")
    assert any(e["action"] == "forget" and e["provenance"] == "asked, password is [secret]" for e in audit)
    assert "hunter2" not in "".join(sqlite3.connect(tmp_path / "memory.sqlite3").iterdump())


def test_text_that_grows_past_the_cap_after_redaction_is_refused_without_the_value(memory):
    from app.voice.memory_service import MAX_CONTENT_CHARS

    # "a@b.co " is 7 chars and becomes "[email] " (8): the cleaned text fits before and not after.
    near = "a@b.co " * (MAX_CONTENT_CHARS // 7)
    assert len(near.strip()) <= MAX_CONTENT_CHARS
    with pytest.raises(ValueError) as info:
        memory.remember("demo", "a", near, provenance="explicit request", explicit=True, now=1)
    assert "exceeds" in str(info.value) and "a@b.co" not in str(info.value)
