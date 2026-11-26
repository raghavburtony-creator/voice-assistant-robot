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
| Voice input and output | `bridge.py` (input pump), `events.py` (typed model events), `output.py` (one writer, interruption drops queued speech) | Listening is separate from speaking: input never waits on speech, speech never blocks the model | D-05 |
| Tool registry and gateway | `tool_registry.py`, `tools.py`, `sink.py` | One authoritative metadata/schema registry builds ADK adapters, validates arguments before dispatch and normalizes tool results; existing functions remain the server authority checks and desktop actions still require per-action visitor approval and native allow-list validation | D-02, D-03, D-14, D-16, D-18, D-22, D-25 |
| Context | `context.ts` (`publishContext`, `useAssistantContext`), `bridge.py` | The page tells the model what it shows, under named keys, budgeted | D-17 |
| Awareness | `awareness/` | App events in, Otto's reactions out. Local: the model doesn't see these events | D-13 |
| Avatar events | `awareness/avatar.ts`, `avatar.py`, `bridge.py` (`avatar`) | A backend tells Otto's character how things are going (working, asking permission, success...). Presentation only: it becomes ordinary awareness events, never a second bus, and carries no authority | D-19, D-22 |
| Guidance | `guidance/` | The host says what to show, Otto decides how. Guided tasks follow observed progress | D-14, D-16 |
| Body | `robot/`, `movement/`, `mouth.ts`, `sound.ts` | The robot: decorative, reduced-motion aware, synthesised sound | D-06, D-07, D-10, D-11, D-12 |
| Packaging | `element/`, `react/`, `gemini/` | `<otto-mascot>` and its optional adapters | D-12, D-15 |

In the web kit, **core** files hold the rules and **shell** files hold the adapters and React (D-13, enforced by `layers.test.ts`). The server has the same split (adapters `route.py` and `bridge.py`, checked actions in `tools.py`, app settings in `app_config.py`), but no test enforces it there (Q-05).

### Structured tool results (OBS-01)

Every registered tool returns the same envelope. The envelope separates what the tool returned from what the system knows about its execution and any resulting effect:

| Field | Meaning |
|---|---|
| `status` | Tool invocation outcome: `success` or `error`. It does not claim that an external side effect was verified. |
| `data` | The tool's original structured result. |
| `evidence` | Explicit evidence supplied by the tool, such as an observed state or returned artifact. Empty when none was produced; never inferred from a model statement. |
| `provenance` | Source attribution. Defaults to the registered tool name and execution source; a tool may provide more specific provenance. |
| `verification` | Whether verification is required and its state: `not_required`, `pending`, `passed`, `failed` or `not_run`. |
| `error` | A safe, structured error code/message, or null. Internal exception details and untrusted arguments are not echoed. |
| `timestamps` | UTC start and completion timestamps for the tool invocation. |
| `side_effects` | Declared categories of effects the tool may request or produce. These are metadata, not proof that an effect occurred. |

**Interpretation rules:** execution success and verification success are independent. A tool can return `status: success` with `verification.status: pending` when it has only queued an action or requested visitor approval. A failed verification remains visible as `verification.status: failed`; it must not be rewritten as an execution error or announced as a verified success. If execution fails before verification, the verification state is `not_run`. Evidence and provenance are included only when supplied by the tool; an empty evidence list means no evidence was returned, not that an action was verified.

The gateway validates model arguments before calling the existing tool function, catches unexpected execution failures without exposing exception details, and wraps the result. It does not grant permissions, execute browser/native actions itself, or replace the browser and native checks in D-02, D-22 and D-25.

### Who decides at runtime

Authority is a chain, not one component (D-22). Each link can only narrow what the one before it allowed:

1. **The model proposes.** It calls a tool. What it says carries no authority: speech, transcripts, and what a frame or the page snapshot shows are never turned into an action (D-17, D-18, D-21).
2. **The registry gateway and server check.** `tool_registry.py` validates the call against the registered input schema and normalizes its result. The existing function in `tools.py` still refuses any argument outside its `Literal`s or the ids the page reported (D-02, D-03, D-14, D-16). Metadata describes risk, permission, timeout, async and verification requirements; it does not grant access. Per-session limits live here too: session state, and the sink's cap of 16 queued actions.
3. **The browser checks again.** `toAssistantAction` and `toAssistantCard` in `messages.ts` (D-02, D-18). A test keeps the action kinds the tools send equal to the ones the browser accepts.
4. **Desktop actions require visitor approval and native validation.** `App.tsx` confirms the exact requested action before `desktop.ts` invokes the Tauri command. Rust accepts only its closed `DesktopAction` enum, validates again, and returns a structured execution/verification result (D-25).
5. **The action is carried out.** Page actions (`navigate`, `command`) by the host's `onAction`, under its own rules. Otto's own actions (`guide`, `task`, `task_move`) by the guide, in `Otto.tsx`, and `card` by the panel; each is then passed to `onAction` too. The host controls Otto's own actions upstream, through the targets and tasks it reports.
6. **Otto decides how.** `planGuide` and the task machine decide how much of his attention a request gets, and hold back what doesn't deserve it (D-14, D-16).

**The visitor is above the chain.** Some acts are the visitor's alone, and no tool may do them, checked or not: answering the mic consent, turning on "Hey Otto" (D-08), starting a camera or screen share (D-21), and pressing a card's follow-up (D-18). The visitor's Stop, Not now and the panel's undo win over anything the model proposed.

### Environmental observation proposals (D-30)

While the visitor has actively shared the camera in the current voice session, the model may call one narrow environmental-proposal tool. This is the only permitted bridge from visual interpretation to environmental awareness: speech, transcripts and ordinary model text never create an event. The server checks the closed proposal schema, current session and camera-share lifecycle, then applies per-session rate and duplicate suppression. The browser validates the proposal independently and confirms the share is still active. A valid proposal maps only to the existing `attention` event, with a bounded topic and short plain-text message, and is dispatched through the host's existing `createOttoEvents` instance. Otto's normal reaction policy remains in charge.

The proposal cannot set a page location, selector, guidance target, help target, arbitrary data, or action. It cannot report success, failure, permission, task, expression, movement, or trigger navigation/desktop/page commands. Unknown, uncertain, malformed, stale, duplicate, over-rate, cross-session and post-Stop proposals are dropped. Stop, hidden-tab stop, session end, disconnect and consent withdrawal invalidate pending proposals. Camera consent and the visible indicator remain D-21's responsibility; screen sharing alone does not enable this first slice. No frames or derived visual data are retained. See D-30 in [decisions.md](decisions.md).

**Every action path has every link.** `otto-mascot/gemini` has no action path: its proxy transport drops `action` messages, and its live transport declares no tools. The live transport has no server between the model and the browser, so it can't gain a tool that acts until a decision says what replaces the server's check.

Issue #6 called this chain "Otto's orchestrator". Q-04 asked whether it should become one component, and D-22 keeps it a chain. A new capability adds a link to the chain or extends an existing one. It never adds a path around it. How each planned capability fits:

| Capability | Who proposes | Which links decide | Anything the chain can't express? |
|---|---|---|---|
| Task awareness and voice moves (E1) | the model, via `start_guided_task` and `move_guided_task` | server (reported ids, fixed moves), browser (the same again), Otto (the task machine) | No. It shipped this way |
| Continuity (E2) | no one: a saved task resumes by a core rule | Otto (`resumeFrom`, D-20) | Across devices or apps, an identity is needed. That is Q-03, not a question of authority |
| Cross-application (E2) | the model, with a different allow-list per app | server and browser, against lists each app reports; the host routes to the app | No. D-23: what only shows or moves the visitor comes from lists each app reports. Commands stay registered by the deployment. A limit across apps needs Q-03 |
| Model-proposed reactions (not filed) | the model, via a tool with a `Literal` of reactions | server, browser, then Otto's own judgement, which may hold the reaction back | No. Adding the tool needs its own decision, since D-18 refused a celebrate tool |
| Multimodal, sign language, environment (E3 to E5) | the visitor starts the input; frames are data | the visitor (D-21); any action they lead to still goes through links 1 to 5 | No |
| Spatial / AR (E6) | no new proposer | Otto, through the same robot state | No. D-28 defers renderer selection until a target and requirements are specified

Engineering agents (`.claude/agents/`) have no runtime authority and no architectural authority. They work inside the decisions in [decisions.md](decisions.md), and a person reviews their pull requests.

## Sign-language input boundary (D-29)

The current `useScreenShare.ts` camera path is deliberately sparse: `FRAME_INTERVAL_MS` is 1,100 ms and `MAX_FRAME_SIDE` is 768 px (`capture.ts`). It sends still JPEGs through `useVoiceAssistant.ts` to `Bridge.send_frame` and Gemini Live. This remains the visual-context feature described by D-21; it is not repurposed as a sign-language recognizer. Google's Live API documentation likewise describes video input as discrete image frames at 1 FPS, which is not evidence of continuous sign-language recognition support.

The sign-language path is therefore a separate, provider-neutral temporal recognition adapter with its own visitor-started consent notice, visible active state, bounded in-memory capture and Stop lifecycle. It returns typed partial/final/unrecognized text updates to the existing conversation input path. The panel labels provisional results, permits correction/confirmation/discard, and shows Otto's replies through the existing text channel. Recognition output is untrusted input: it cannot invoke tools or actions, and any action remains subject to D-02 and D-22. No raw video is retained by Otto. The external provider's processing and retention terms must be verified and disclosed before remote inference is enabled.

The first language and pilot task are not assumed from the deployment country. Q-09 requires community confirmation, an agreed evaluation task, and a lawful, consented dataset or community-governed collection plan before a model is selected. See [D-29 and Q-09](decisions.md).

## Target: an embodied, accessible assistant that keeps track of the task

Otto is moving from a voice guide on one page to an assistant that knows what the visitor is trying to do, keeps track of it across reloads and interfaces, and later takes in more than voice and text. The capabilities are tracked as epics (see [roadmap.md](roadmap.md)). This table shows what each one reuses and what it may *not* rebuild.

| Capability | Builds on | Must not duplicate | Open questions |
|---|---|---|---|
| **Task-aware Otto**: the model knows which task is running, which step it is on, and what the app is busy with | Guided tasks (`guidance/task.ts`, D-16), awareness `task` handles (`awareness/events.ts`), the context channel (`publishContext`, D-17 budget), tools with checked ids (D-02) | A second task model, or a second way to send context. Task state stays in the guide; the model reads a summary of it | none (Q-02 answered by D-20) |
| **Task continuity**: a task survives a reload, then a new session, then another interface | The same task state, saved through storage.ts (already guarded): within a tab, as ids only (D-20); cross-session state uses the host-supplied opaque identity and bounded continuity record (D-26) | A general visitor-memory system, identity invented by the kit, or a second orchestration path | Q-03 answered by D-26; implementation is the E2 slice |
| **Cross-application**: Otto acts in more than one app | Reported-id allow-lists (the show_target pattern, D-14) for targets, tasks and destinations; commands registered by the deployment (D-23); continuity identity scoped by the host (D-26) | Free-form actions, URLs from the model, a command the page grants itself, or global identity shared between unrelated hosts | No. Q-03 is answered by D-26; implementation must keep host/app scope |
| **Multimodal input** (camera, screen) | The consent flow (`consent.ts`), the privacy rules of the page snapshot (D-17), the existing session (`send_realtime`) | A capture path that skips the visitor's press, keeps a frame, or opens a second channel (D-21) | none (Q-07 answered by D-21) |
| **Sign language** | A bounded, visitor-started temporal capture adapter; provider-neutral recognition updates; the existing conversation input and panel text channel (D-06, D-29) | D-21's 1 FPS visual-context feed as a sign recognizer; a parallel conversation, event bus or action path; raw-video retention | Q-09: initial sign language, pilot task, community validation and dataset rights |
| **Environmental intelligence** | Visitor-shared camera input; a narrow, checked proposal mapped to `attention` on the existing `createOttoEvents` path (D-30) | A second event bus; direct model/speech reactions; arbitrary actions or location targets | Q-10 answered by D-30; Q-07 answered by D-21 |
| **Spatial / AR presence** | The robot's state (`robot/robot.ts`, gestures, movement rules), which is already pure | A second robot model with its own states | Specify a target device/runtime and user-facing rendering and interaction requirements in issue #12 before choosing a renderer (D-28) |

**CI-2/CI-3 task continuity:** the host-scoped SQLite adapter (`server/app/voice/continuity_store.py`) keeps one record per opaque host identity, containing only scope, task, step and savedAt. The bridge saves only a task/step pair present in the current interface's `guide_tasks` report and expires it after seven days. Completion, cancellation and visitor withdrawal delete it. When the model requests navigation to a runtime destination, `tools.py` first checks the id against the current interface's reported destinations; if a valid task is active, it marks a one-session handoff without recording the destination. The old interface's target, task and destination registries are then cleared in the server and browser. A source-interface unmount consumes that one-shot marker instead of deleting the saved task. The destination interface must report its own task registry; the server validates the saved task and step there, and the browser validates them again before `ottoGuide.startTask(spec, step)`. Missing tasks/steps are discarded. The host maps destination ids to routes; no URL, path, page snapshot or global identity crosses the boundary. The ADK live session remains ephemeral and unchanged.

### Rules for new capabilities (D-19)

- **Extend, don't fork.** Put a new rule in an existing core module, or a new core module with a test (D-13). Put its adapter in shell. Put any new action through `tools.py` and `toAssistantAction` (D-02).
- **The model's output stays untrusted.** A capability that widens what the model can do (more actions, more apps, more input) widens it through allow-lists the page reports, never through free-form strings.
- **Every channel has a text twin.** Whatever Otto shows, says or signs is also in the panel (D-06).
- **Privacy is not a host option.** Exclusions that exist today (D-17) stay mandatory for every new input.
- **An unanswered question blocks the work that depends on it.** Such an issue carries `status: needs-decision` and links its `Q-xx`. No implementer picks an answer silently.

## Review of D-01 to D-18 (November 2026)

When this review was done, all 18 decisions were **current**: each one was enforced by the code or test it cites, and nothing in the target architecture required amending one yet. Several were under pressure from later epics. Each pressure point became an open question, so none was amended speculatively. The table shows where those questions stand now; D-03 has since been amended by D-23:

| Decision | Status | Pressure from | Tracked as |
|---|---|---|---|
| D-01 to D-02, D-04 to D-11, D-14 to D-16, D-18 | current | | |
| D-03 static page and command lists | amended by D-23 | Cross-application needs lists that aren't known at build time | Q-08, answered by D-23: destinations may be reported, commands stay static |
| D-12 one shader, no 3D library | current | Spatial / AR presence | Q-06, answered by D-28: defer renderer selection until a target and requirements are specified |
| D-13 layers | current, partly enforced | The server isn't covered by a test | Q-05 |
| D-17 snapshot only while talking, never stored | current | Continuity stores task state (within a tab, as ids, by D-20), and multimodal input adds camera and screen frames, sent while shared and never kept (D-21) | Q-03 |

Issue #6 refers to "D-01 to D-19". At the time of the review the log ended at D-18. D-19 is the first new record from this work.


## Service contracts and dependency direction

This section describes the intended boundaries for the architecture issues. A row marked **planned** is a contract target, not a claim that the service already exists. The current implementation remains the “Today” pipeline above; issue state is tracked in [roadmap.md](roadmap.md) and GitHub.

| Boundary | Contract | May depend on | Must not do |
|---|---|---|---|
| Voice/session adapter (implemented) | Own the WebSocket, ADK Live session, provider transport, event translation and single output writer | FastAPI, pinned Google ADK/GenAI adapters, typed protocol modules | Persist the provider session, expose the API key, or turn ordinary model text/transcripts into actions |
| Tool implementations and action sink (implemented) | Validate model arguments against closed types or current-session allow-lists; queue bounded action requests | Session state, app configuration, the checked sink | Trust model-provided URLs/selectors/commands, bypass the browser check, or perform visitor-only consent actions |
| Tool registry/gateway (proposed by #45; implementation under review in PR #105) | Describe registered tools with input/output schemas and policy metadata; validate call shape and normalize results | Checked tool functions and schema/adapter code | Grant permissions, replace the server/browser checks, or create an independent execution router |
| Policy/consent boundary (proposed by #47–#48) | Return a scoped allow / require-visitor-confirmation / deny result and record the evidence needed for audit | Tool metadata, explicit visitor consent state, action identity and verification outcomes | Treat model intent as consent, broaden a permission beyond the specific action, or make unrelated conversation decisions |
| Task engine (proposed by #49) | Track task id, lifecycle state, progress, cancellation, retry/timeout and terminal result; return typed events to the live session | Worker adapters, bounded task storage and the existing event/output path | Block the realtime voice loop, create a second event bus, or execute actions outside the same checks |
| Memory service (proposed by #46) | Expose explicit remember/recall/update/forget/resurface/context operations with provenance and sensitivity metadata | An explicitly configured store and a caller that supplies the session/user scope | Write implicitly, retain raw multimodal input by default, or autonomously trigger user-facing actions |
| Research service (proposed by #53) | Return retrieved, reranked and validated evidence with source, provenance and confidence/applicability metadata | Provider-neutral retrieval adapters and source validators | Present model-generated text as retrieved evidence, hide provenance, or execute tools/actions |
| Perception boundary (implemented for shared-frame metadata; expanded recognition is separately scoped) | Accept only visitor-started, session-bound observations; keep current observations ephemeral and bounded | Existing capture consent, bridge and session state | Start capture itself, persist raw frames, or treat frame contents as instructions |
| Extension boundary (proposed by #55) | Load declared skills/plugins/MCP capabilities with schemas and lifecycle/error isolation | Tool registry and the same policy/check path as built-in tools | Install a second orchestrator, bypass authorization, or let extension failure crash the live session |

### Dependency direction

The intended dependency direction is inward:

1. **Pure contracts and rules** define identifiers, schemas, lifecycle transitions, limits and result types. They should be deterministic and independently testable, with no network, browser, FastAPI or provider dependency.
2. **Adapters** translate external inputs/outputs: browser messages, WebSocket/ADK events, persistence, providers, workers and extension protocols. Adapters depend on contracts; contracts do not import adapters.
3. **Services** compose contracts and adapters behind narrow operations. They return typed results/events and do not recursively call a conversation authority or decide the next spoken response.
4. **The existing runtime path** delivers model proposals through checked server tools and the browser's independent validation. Visitor-only actions remain visitor-only. The host/native layer performs its own allow-list and approval checks.

No new capability may create a parallel model channel, action route, task state machine beside guided-task rules, or event bus (D-19). A service can be centralized as a reusable implementation of one bounded check; it is not thereby a runtime orchestrator. In particular, #44's wording about a single orchestration authority conflicts with D-22 as currently recorded. It must not be implemented as a central runtime decision-maker unless the owner changes that decision through a new, explicit decision record.

### Cross-cutting result and failure contract

Service boundaries should return structured outcomes rather than ambiguous strings or exceptions used as control flow. At minimum, callers need to distinguish:
- successful data from a rejected/failed operation;
- validation failure from permission denial;
- visitor confirmation required from authorization granted;
- execution completion from independently verified completion;
- retrieved evidence and its provenance from generated explanation;
- cancellation, timeout and retryable failure from terminal failure.

The richer evidence/provenance contract in #57 may extend the basic registry result envelope, but must not erase the original tool result or imply verification that did not occur. Failure to verify a side effect is not success.

### Privacy and lifecycle invariants

- Session-only voice/perception state is discarded at session end (D-04, D-21).
- Camera/screen frames are visitor-started, visibly shared, bounded and not retained by Otto (D-21).
- Cross-session task continuity is a narrow host-scoped record, not general visitor memory (D-20, D-26).
- Any future memory persistence needs explicit sensitivity, provenance, retention, deletion and user-control rules before implementation.
- Research and extension outputs remain untrusted data. They do not widen tool permissions or become actions without the normal checked path.

For the origin and licence status of implemented assets and architectural references, see [source-attribution.md](source-attribution.md).