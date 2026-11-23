# Architecture

Where Otto is today, where he is going, and how new capabilities attach to what exists. [decisions.md](decisions.md) wins where this page and a decision disagree. The behaviour itself is described in the root [README.md](../README.md).

## Today: one pipeline, three checkpoints

```
                 Browser (web/src/otto/)                                   Server (server/app/voice/)          Gemini Live
 visitor ──► mic / text ─────────────── WebSocket /api/v1/voice/live ──► route.py ─► bridge.py ─► ADK ────────► model
          ◄── speech, bubble, panel ◄──                                 ◄──          ◄── tools.py ◄── tool calls ◄──
 app  ──► awareness events, guide.show, useAssistantContext, page snapshot ─► session state "screens"
      ◄── onAction(action) ◄── toAssistantAction ◄── {"type":"action"} ◄── sink ◄── tools.py (checked)
```

Each part of the kit has one job:

| Part | Where | Job | Decisions |
|---|---|---|---|
| Wire protocol | `route.py` docstring, `messages.ts` | One WebSocket: 16 kHz PCM up, 24 kHz PCM down, JSON messages both ways | D-01, D-04 |
| Session | `route.py`, `bridge.py`, `config.py` | One ADK live session per connection. In memory, deleted on close, capped in length and number | D-04, D-09 |
| Tools | `tools.py`, `sink.py` | The only way the model acts. Every argument is checked against a `Literal` or a list the page reported | D-02, D-03, D-14, D-16, D-18 |
| Context | `context.ts` (`publishContext`, `useAssistantContext`), `bridge.py` | The page tells the model what it shows, under named keys, budgeted | D-17 |
| Awareness | `awareness/` | App events in, Otto's reactions out. Local: the model doesn't see these events | D-13 |
| Guidance | `guidance/` | The host says what to show, Otto decides how. Guided tasks follow observed progress | D-14, D-16 |
| Body | `robot/`, `movement/`, `mouth.ts`, `sound.ts` | The robot: decorative, reduced-motion aware, synthesised sound | D-06, D-07, D-10, D-11, D-12 |
| Packaging | `element/`, `react/`, `gemini/` | `<otto-mascot>` and its optional adapters | D-12, D-15 |

In the web kit, **core** files hold the rules and **shell** files hold the adapters and React (D-13, enforced by `layers.test.ts`). The server has the same split (adapters `route.py` and `bridge.py`, checked actions in `tools.py`, app settings in `app_config.py`), but no test enforces it there (Q-05).

### Who decides at runtime

No single "orchestrator" module exists. Authority is a chain, and each link can only narrow what the one before it proposed:

1. **The model proposes.** It calls a tool, or it speaks.
2. **The server checks.** `tools.py` refuses any argument outside its `Literal`s or the ids the page reported (D-02, D-03, D-14, D-16).
3. **The browser checks again.** `toAssistantAction` and `toAssistantCard` in `messages.ts` (D-02, D-18).
4. **The host executes.** `onAction` in the app does the work, and its own rules apply.
5. **Otto decides how.** `planGuide` and the task machine decide how much of his attention a request gets (D-14, D-16).

Issue #6 calls this "Otto's orchestrator". Q-04 asks whether to keep it as a chain or name one component. Until that is answered, a new capability adds a link to this chain or extends an existing one. It never adds a path around it.

Engineering agents (`.claude/agents/`) have no runtime authority and no architectural authority. They work inside the decisions in [decisions.md](decisions.md), and a person reviews their pull requests.

## Target: an embodied, accessible assistant that keeps track of the task

Otto is moving from a voice guide on one page to an assistant that knows what the visitor is trying to do, keeps track of it across reloads and interfaces, and later takes in more than voice and text. The capabilities are tracked as epics (see [roadmap.md](roadmap.md)). This table shows what each one reuses and what it may *not* rebuild.

| Capability | Builds on | Must not duplicate | Open questions |
|---|---|---|---|
| **Task-aware Otto**: the model knows which task is running, which step it is on, and what the app is busy with | Guided tasks (`guidance/task.ts`, D-16), awareness `task` handles (`awareness/events.ts`), the context channel (`publishContext`, D-17 budget), tools with checked ids (D-02) | A second task model, or a second way to send context. Task state stays in the guide; the model reads a summary of it | none (Q-02 answered by D-20) |
| **Task continuity**: a task survives a reload, then a new session, then another interface | The same task state, saved through `storage.ts` (already guarded): within a tab, as ids only (D-20) | Server-side memory of visitors before Q-03 is answered. Today there is one fixed `USER_ID` and `InMemorySessionService` | Q-03 (a reload is settled by D-20) |
| **Cross-application**: Otto acts in more than one app | Reported-id allow-lists (the `show_target` pattern, D-14) in place of static `Literal`s | Free-form actions. Each app still reports what may be done (D-02) | Q-08 |
| **Multimodal input** (camera, screen) | The consent flow (`consent.ts`), the privacy rules of the page snapshot (D-17), the existing session (`send_realtime`) | A capture path that skips the visitor's press, keeps a frame, or opens a second channel (D-21) | none (Q-07 answered by D-21) |
| **Sign language** | Multimodal input; the panel as the text channel (D-06) | A separate output channel: what Otto signs also appears as text | Q-07 |
| **Environmental intelligence** | Multimodal input; awareness events as the vocabulary | A second event bus beside `createOttoEvents` | Q-07 |
| **Spatial / AR presence** | The robot's state (`robot/robot.ts`, gestures, movement rules), which is already pure | A second robot model with its own states | Q-06 |

### Rules for new capabilities (D-19)

- **Extend, don't fork.** Put a new rule in an existing core module, or a new core module with a test (D-13). Put its adapter in shell. Put any new action through `tools.py` and `toAssistantAction` (D-02).
- **The model's output stays untrusted.** A capability that widens what the model can do (more actions, more apps, more input) widens it through allow-lists the page reports, never through free-form strings.
- **Every channel has a text twin.** Whatever Otto shows, says or signs is also in the panel (D-06).
- **Privacy is not a host option.** Exclusions that exist today (D-17) stay mandatory for every new input.
- **An unanswered question blocks the work that depends on it.** Such an issue carries `status: needs-decision` and links its `Q-xx`. No implementer picks an answer silently.

## Review of D-01 to D-18 (November 2026)

All 18 decisions are **current**: each one is enforced by the code or test it cites, and nothing in the target architecture requires amending one yet. Several will come under pressure from later epics. Each pressure point is an open question, so none is amended speculatively:

| Decision | Status | Pressure from | Tracked as |
|---|---|---|---|
| D-01 to D-02, D-04 to D-11, D-14 to D-16, D-18 | current | | |
| D-03 static page and command lists | current | Cross-application needs lists that aren't known at build time | Q-08 |
| D-12 one shader, no 3D library | current | Spatial / AR presence | Q-06 |
| D-13 layers | current, partly enforced | The server isn't covered by a test | Q-05 |
| D-17 snapshot only while talking, never stored | current | Continuity stores task state (within a tab, as ids, by D-20), and multimodal input adds camera and screen frames, sent while shared and never kept (D-21) | Q-03 |

Issue #6 refers to "D-01 to D-19". At the time of the review the log ended at D-18. D-19 is the first new record from this work.
