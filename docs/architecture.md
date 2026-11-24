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

Authority is a chain, not one component (D-22). Each link can only narrow what the one before it allowed:

1. **The model proposes.** It calls a tool. What it says carries no authority: speech, transcripts, and what a frame or the page snapshot shows are never turned into an action (D-17, D-18, D-21).
2. **The server checks.** `tools.py` refuses any argument outside its `Literal`s or the ids the page reported (D-02, D-03, D-14, D-16). Per-session limits live here too: session state, and the sink's cap of 16 queued actions.
3. **The browser checks again.** `toAssistantAction` and `toAssistantCard` in `messages.ts` (D-02, D-18). A test keeps the action kinds the tools send equal to the ones the browser accepts.
4. **The action is carried out.** Page actions (`navigate`, `command`) by the host's `onAction`, under its own rules. Otto's own actions (`guide`, `task`, `task_move`) by the guide, in `Otto.tsx`, and `card` by the panel; each is then passed to `onAction` too. The host controls Otto's own actions upstream, through the targets and tasks it reports.
5. **Otto decides how.** `planGuide` and the task machine decide how much of his attention a request gets, and hold back what doesn't deserve it (D-14, D-16).

**The visitor is above the chain.** Some acts are the visitor's alone, and no tool may do them, checked or not: answering the mic consent, turning on "Hey Otto" (D-08), starting a camera or screen share (D-21), and pressing a card's follow-up (D-18). The visitor's Stop, Not now and the panel's undo win over anything the model proposed.

**Every action path has every link.** `otto-mascot/gemini` has no action path: its proxy transport drops `action` messages, and its live transport declares no tools. The live transport has no server between the model and the browser, so it can't gain a tool that acts until a decision says what replaces the server's check.

Issue #6 called this chain "Otto's orchestrator". Q-04 asked whether it should become one component, and D-22 keeps it a chain. A new capability adds a link to the chain or extends an existing one. It never adds a path around it. How each planned capability fits:

| Capability | Who proposes | Which links decide | Anything the chain can't express? |
|---|---|---|---|
| Task awareness and voice moves (E1) | the model, via `start_guided_task` and `move_guided_task` | server (reported ids, fixed moves), browser (the same again), Otto (the task machine) | No. It shipped this way |
| Continuity (E2) | no one: a saved task resumes by a core rule | Otto (`resumeFrom`, D-20) | Across devices or apps, an identity is needed. That is Q-03, not a question of authority |
| Cross-application (E2) | the model, with a different allow-list per app | server and browser, against lists each app reports; the host routes to the app | No. D-23: what only shows or moves the visitor comes from lists each app reports. Commands stay registered by the deployment. A limit across apps needs Q-03 |
| Model-proposed reactions (not filed) | the model, via a tool with a `Literal` of reactions | server, browser, then Otto's own judgement, which may hold the reaction back | No. Adding the tool needs its own decision, since D-18 refused a celebrate tool |
| Multimodal, sign language, environment (E3 to E5) | the visitor starts the input; frames are data | the visitor (D-21); any action they lead to still goes through links 1 to 5 | No |
| Spatial / AR (E6) | no new proposer | Otto, through the same robot state | No. The renderer is Q-06

Engineering agents (`.claude/agents/`) have no runtime authority and no architectural authority. They work inside the decisions in [decisions.md](decisions.md), and a person reviews their pull requests.

## Target: an embodied, accessible assistant that keeps track of the task

Otto is moving from a voice guide on one page to an assistant that knows what the visitor is trying to do, keeps track of it across reloads and interfaces, and later takes in more than voice and text. The capabilities are tracked as epics (see [roadmap.md](roadmap.md)). This table shows what each one reuses and what it may *not* rebuild.

| Capability | Builds on | Must not duplicate | Open questions |
|---|---|---|---|
| **Task-aware Otto**: the model knows which task is running, which step it is on, and what the app is busy with | Guided tasks (`guidance/task.ts`, D-16), awareness `task` handles (`awareness/events.ts`), the context channel (`publishContext`, D-17 budget), tools with checked ids (D-02) | A second task model, or a second way to send context. Task state stays in the guide; the model reads a summary of it | none (Q-02 answered by D-20) |
| **Task continuity**: a task survives a reload, then a new session, then another interface | The same task state, saved through `storage.ts` (already guarded): within a tab, as ids only (D-20) | Server-side memory of visitors before Q-03 is answered. Today there is one fixed `USER_ID` and `InMemorySessionService` | Q-03 (a reload is settled by D-20) |
| **Cross-application**: Otto acts in more than one app | Reported-id allow-lists (the `show_target` pattern, D-14) for targets, tasks and destinations; commands registered by the deployment (D-23) | Free-form actions, URLs from the model, or a command the page grants itself (D-02, D-23) | Q-03 (Q-08 answered by D-23) |
| **Multimodal input** (camera, screen) | The consent flow (`consent.ts`), the privacy rules of the page snapshot (D-17), the existing session (`send_realtime`) | A capture path that skips the visitor's press, keeps a frame, or opens a second channel (D-21) | none (Q-07 answered by D-21) |
| **Sign language** | Multimodal input; the panel as the text channel (D-06) | A separate output channel: what Otto signs also appears as text | none (Q-07 answered by D-21) |
| **Environmental intelligence** | Multimodal input; awareness events as the vocabulary | A second event bus beside `createOttoEvents` | none (Q-07 answered by D-21) |
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
| D-03 static page and command lists | amended by D-23 | Cross-application needs lists that aren't known at build time | Q-08, answered by D-23: destinations may be reported, commands stay static |
| D-12 one shader, no 3D library | current | Spatial / AR presence | Q-06 |
| D-13 layers | current, partly enforced | The server isn't covered by a test | Q-05 |
| D-17 snapshot only while talking, never stored | current | Continuity stores task state (within a tab, as ids, by D-20), and multimodal input adds camera and screen frames, sent while shared and never kept (D-21) | Q-03 |

Issue #6 refers to "D-01 to D-19". At the time of the review the log ended at D-18. D-19 is the first new record from this work.
