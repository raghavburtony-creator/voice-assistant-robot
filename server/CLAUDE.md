# server/CLAUDE.md — the backend

Python 3.11+, FastAPI, pydantic-settings, Google ADK and `google-genai` (both pinned exactly in `requirements.txt`). Every rule in the root [CLAUDE.md](../CLAUDE.md) still applies. This file adds the map. For a task, start from its row in the [routing table](../docs/README.md).

## Commands

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cp -n .env.example .env
.venv/bin/uvicorn app.main:app --reload --port 8000     # needs GEMINI_API_KEY only for real voice
.venv/bin/python -m pytest                              # all tests; no key or network needed
.venv/bin/python -m pytest tests/test_voice.py -q       # one area
```

## Module map (`app/`)

| File | Owns |
|---|---|
| `main.py` | The FastAPI app, CORS middleware, `/api/v1/health`, mounting the voice router |
| `config.py` | `settings`: the key (a `SecretStr`), `CORS_ORIGINS` (no wildcard, D-09), `max_session_seconds` / `max_sessions` (D-04), extensions, continuity |
| `voice/route.py` | The `/api/v1/voice/live` WebSocket. Its **docstring is the wire protocol** (both directions). Origin check, the busy check, the start timeout, `_active`, `_scrub` |
| `voice/bridge.py` | `connect_adk` (the ADK `Runner.run_live` session and agent) and `Bridge`: the three pumps (browser→model, model→browser, output) and `close()` |
| `voice/events.py`, `output.py` | Typed model events, and the one ordered writer to the browser (`interrupted` drops queued speech) |
| `voice/tools.py` | Otto's checked tools and `TOOL_FUNCTIONS`. Every argument is checked against a `Literal` or an allow-list (D-02). The `PageId` and `Command` literals live here |
| `voice/tool_registry.py` | Tool metadata, the policy gate, schemas, validation, the result envelope |
| `voice/policy.py` | Risk, permission decisions, consent receipts, the bounded session audit (D-22) |
| `voice/sink.py` | Checked actions waiting for one browser session, kept out of the serialisable ADK state |
| `voice/app_config.py` | **Edit per project:** pages, commands, languages, `system_instruction`. Must match `web/src/otto.config.ts` (D-03) |
| `voice/runtime.py`, `context.py` | Checks for runtime page ids and labels, and page-scoped context rules (D-23) |
| `voice/tasks.py` | The task engine: long work beside the live session, never inside it |
| `voice/task_workers.py` | Worker adapters for the engine (today the project-docs search). A leaf that returns a string; the bridge starts it and shows the result on a card |
| `voice/avatar.py`, `environmental.py`, `perception.py` | The `avatar` message, camera-awareness proposals (D-30), the perception gateway |
| `voice/memory_service.py`, `memory_consent.py` | Identity-scoped memory, and visitor-confirmed memory proposals (D-26) |
| `voice/privacy.py`, `forget.py` | What may be stored, redaction, forgetting one visitor (D-17) |
| `voice/continuity.py`, `continuity_store.py` | Host-supplied identity and the SQLite guided-task record (D-20) |
| `voice/extensions.py` | Opt-in, read-only skills, plugins and MCP adapters (`OTTO_ENABLED_EXTENSIONS`) |
| `voice/research.py` | Provider-neutral retrieval, ranking and provenance |
| `voice/model.py` | The Gemini model with the server's key. The only place the key is used |

## The life of one session (`route.py`)

1. **Origin check.** A missing or foreign Origin is refused with 1008 when `origin_required` (production).
2. `accept`. Then `not_configured` if there's no key, then **`busy` if `_active >= max_sessions`**. Both checks run *before* any ADK work.
3. Wait at most 10 s for the `start` message, then sanitise language, page, title and detail.
4. `_active += 1`, then `_run`, which opens the ADK session, sends `ready` and runs the three pumps under `_wait` (capped by `max_session_seconds`). **The `finally` does `_active -= 1` exactly once.**
5. `_wait` cancels and awaits the pumps still pending. A `WebSocketDisconnect` is a normal end, never `upstream`. Errors go out through `_scrub`, so the key can't leak.

When you change this flow, keep every rule in "Session caps" and "Async in the server" in the root CLAUDE.md's review guidelines.

## Recipes

- **Add a tool:** follow README "Adding a tool". Implement and check it in `tools.py`, register it in `tool_registry.py`, add its policy in `policy.py`, mention it in `system_instruction` in `app_config.py`, add its action to `messageSchema` in `web/src/otto/messages.ts` and to `fakeServer.ts`, and test it in `tests/test_voice.py`.
- **Add a message type:** update the `route.py` docstring and `bridge.py`, then the web end in the same PR (see web/CLAUDE.md).
- **Add a page or command:** change `app_config.py`, the literals in `tools.py` and `web/src/otto.config.ts` together. `test_voice.py` checks they match.

## Tests (`tests/`)

| Test | Covers |
|---|---|
| `test_voice.py` | The route end to end with a fake Gemini session, the tools, and config parity with the web app |
| `test_voice_split.py` | Typed events, the one output writer, interruption |
| `test_architecture.py`, `test_integration_chain.py`, `test_orchestration_contract.py` | The D-22 authority chain: dependency direction, tool → policy → host receipt → model |
| `test_tool_registry.py`, `test_adk_state.py` | Registry envelopes; tools working on ADK's `State` |
| `test_tasks.py`, `test_task_start.py`, `test_task_cancel.py` | Task engine lifecycle, bounds, cancellation; starting a task by voice, its worker, its card, and the voice loop turning meanwhile; the visitor's `cancel_task` |
| `test_privacy.py`, `test_memory_*.py`, `test_continuity*.py` | Storage, redaction, consent, forgetting, continuity |
| `test_extensions.py`, `test_research.py`, `test_perception.py`, `test_environmental.py`, `test_avatar.py` | The capability layers |
| `test_docs.py` | Decision numbering and index, labels and milestones vs CONTRIBUTING.md, the issue templates |

Tests that run the route replace `route.connect_adk` with a fake (`monkeypatch.setattr(route, "connect_adk", ...)` in `test_voice.py`), so no test touches the network. `conftest.py` keeps the continuity store in a temp directory, outside the repo.
