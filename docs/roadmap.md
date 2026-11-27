# Roadmap

Otto's product epics, how they depend on each other, and what is filed for the first one. The GitHub issues are the source of truth for scope and progress. This page is the map. How each capability attaches to the existing code is in [architecture.md](architecture.md#target-an-embodied-accessible-assistant-that-keeps-track-of-the-task).

## Epics

| Epic | Outcome | Blocked by | Milestones |
|---|---|---|---|
| **E1 Task-aware Otto** ([#7](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/7)) | The model knows which guided task is running, which step it is on and what the app is busy with. Later, a task survives a reload. | none (the reload slice follows D-20) | 0.2, 0.3 |
| **E2 Continuity across interfaces** ([#8](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/8)) | A task started in one session, device or app can be picked up in another. | E1; Q-03 (Q-04 answered by D-22, Q-08 by D-23) | not scheduled |
| **E3 Multimodal input** ([#9](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/9)) | Otto can take camera or screen input, with consent and a visible indicator. | none (Q-07 answered by D-21) | not scheduled |
| **E5 Environmental intelligence** ([#11](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/11)) | Otto reacts to what is around the visitor, through the existing awareness vocabulary. | E3 (Q-07 answered by D-21); Q-10 answered by D-30 | not scheduled |
| **E6 Spatial / AR presence** ([#12](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/12)) | Otto appears in spatial or AR interfaces, using the same robot state. | A named target device/runtime and user-facing rendering and interaction requirements (D-28) | not scheduled |
| **E7 Desktop personal assistant** ([#142](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/142)) | Otto is a normal Linux desktop app that arranges the owner's windows by voice, checks every result, and remembers the owner across restarts. Brief: [upgrade.md](../upgrade.md). | Q-11, Q-12, Q-13, Q-14 | 0.4 to 0.9 |

```
E1 Task-aware ──► E2 Continuity across interfaces
E3 Multimodal ──► E5 Environmental intelligence (D-30)
E6 Spatial / AR (independent; waits for a target and requirements to be specified in issue #12, per D-28)
E7 Desktop assistant: 0.4 shell ──► 0.5 window management (Q-11) ──► 0.8 hand pointer and roaming (Q-13)
                      0.6 personal memory (Q-12) ──► 0.9 durable tasks, approvals and delivery (Q-14)
                      0.7 extensions and MCP (independent)
```

Each later epic gets its tasks once its blocking questions are answered. Sign-language support (E4) was retired on 2026-11-27 and is no longer an active roadmap capability; see the archive note below. For E6, Q-06 is answered by D-28; issue #12 must first name the target device/runtime and user-facing requirements.

## E1 Task-aware Otto: the first slices

What exists already: guided tasks with observed progress (D-16), awareness `task` handles for long operations, and a context channel the model reads through `get_screen_context` (D-17). What's missing: the model sees which tasks are *offered* (`guide_tasks`), but not which one is *running*, how far along it is, or what the app is busy with. So "where was I?" or "is my upload done?" gets a guess.

### 0.2 Task-aware Otto, in page

| Issue | Labels | Blocked by | Decisions |
|---|---|---|---|
| **TA-1** ([#13](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/13)) Tell the model which guided task is running and which step it is on | feature, p1, intermediate, kit + server | none | D-16, D-17, D-19 |
| **TA-2** ([#14](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/14)) Tell the model what the app is busy with (open awareness `task` handles and how they ended) | feature, p2, intermediate, kit + server | none | D-13, D-17, D-19 |
| **TA-3** ([#15](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/15)) Let the voice stop the running task, or move it back or on a step | feature, p2, advanced, kit + server | TA-1 | D-02, D-16 |

### 0.3 Task continuity

| Issue | Labels | Blocked by | Decisions |
|---|---|---|---|
| **TA-4** ([#16](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/16)) Investigate Q-02: where task state lives, and for how long | question, p2, advanced | none | D-17, Q-02 |

Resuming a task after a reload is filed now that TA-4 has answered Q-02 with D-20: within a tab, as ids only.

Milestones are set on GitHub once `.github/workflows/sync-labels.yml` has created them. Until then each issue names its milestone in its first line.

## E2 Continuity across interfaces: first slices

Q-03 is answered by D-26. The implementation starts with a narrow cross-session task-resume path rather than general visitor memory.

| Slice | Outcome | Blocked by | Decisions |
|---|---|---|---|
| **CI-1** | A host can supply an opaque continuity identity without exposing it to the browser/model, and continuity is explicitly opt-in | none | D-01, D-19, D-26 |
| **CI-2** | The active guided task can be persisted and resumed in a later session/device using only `{scope, task, step, savedAt}`, with 7-day expiry and deletion on completion/cancel/withdrawal | CI-1 | D-20, D-26 |
| **CI-3** | A task can resume across supported app interfaces while runtime destinations remain host-mapped ids; no URL or global identity crosses the boundary | CI-2, #63 | D-23, D-26 |


## Retired work: sign-language support (E4)

E4 and its unresolved product question Q-09 were retired on 2026-11-27 after the project focus shifted to hand-gesture navigation. No language-specific recognizer, dataset expansion or sign-language release is planned. This is a roadmap retirement, not deletion of completed work or source history.

- [E4 epic #10](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/10) and [Q-09 #91](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/91) are closed as not planned; Q-09 is marked dropped in [decisions.md](decisions.md).
- Completed records remain for reference: [SIG-01 #90](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/90), [SIG-02 #92](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/92) and [SIG-03 #123](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/123).
- D-29 and the sign adapter/ML source remain as historical material, not an active product commitment. Any future revival needs a new roadmap issue and renewed privacy, rights and community review.

## E5 Environmental intelligence: first slice

D-30 answers Q-10. Environmental observations may propose only a bounded `attention` event while the visitor's camera share is active in the current voice session. The server and browser validate the proposal; accepted events reuse `createOttoEvents` and Otto's existing reaction policy. No speech-triggered events, ambient capture, new event bus or direct action path.

| Slice | Outcome | Blocked by | Decisions |
|---|---|---|---|
| **ENV-01** ([#98](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/98)) | Add a provider-neutral, typed environmental proposal contract and deterministic adapter; validate session/camera lifecycle generations, allow-listed topics, rate and duplicates on server and browser; map accepted proposals to the existing `attention` event | none | D-02, D-18, D-19, D-21, D-22, D-30 |
## E7 Desktop personal assistant

Source brief: [upgrade.md](../upgrade.md), now the AnyModelBot integration brief; the earlier JARVIS brief is in this file's history. How it maps onto the code: [architecture.md](architecture.md#target-the-desktop-personal-assistant-e7). The desktop details are in [desktop.md](desktop.md). One ADK agent stays the only decision-maker (D-22); JARVIS, IRIS, Kaizumi, Muninn and gnomelets are sources of mechanisms, recorded in [source-attribution.md](source-attribution.md).

Milestones 0.4, 0.5 and 0.6 together are the brief's "first milestone": a working desktop companion that moves a window on request ("Move VS Code to the left"), verifies it, and still knows the owner's name after a restart. Every slice has an issue under [#142](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/142); the 0.9 tasks are filed once that milestone exists.

### 0.4 Desktop companion shell (no decision needed)

| Slice | Outcome | Blocked by | Decisions |
|---|---|---|---|
| **SHELL-01** ([#154](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/154)) | Otto's main window is a normal application window: a taskbar entry, a drag region, minimise, maximise, restore and close, no permanent always-on-top | none | D-06, D-25 |
| **SHELL-02** ([#155](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/155)) | A compact assistant window beside the full window; the visitor (never the model) may pin the compact window on top; size, position and mode survive a restart | SHELL-01 | D-07, D-22 |
| **SHELL-03** ([#156](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/156)) | The panel states the session (Wayland or Xorg), whether the Otto GNOME extension is present, and which desktop features are available | SHELL-01 | D-06, D-24 |
| **SHELL-04** ([#157](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/157)) | A desktop app lifecycle: one instance (a second launch focuses the first), a tray icon with show, hide, quit and a badge for pending items, close-to-tray and start-at-login as settings that start off (the AnyModelBot Electron shell, through Tauri plugins) | SHELL-01 | D-06, D-08 |

### 0.5 Window management, observe → act → verify (blocked by Q-11)

| Slice | Outcome | Blocked by | Decisions |
|---|---|---|---|
| **WM-01** ([#158](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/158)) | Otto's own GNOME Shell extension exposes windows, monitors and workspaces, and the window operations, on the session D-Bus; install and enable script | Q-11 | D-24, D-25 |
| **WM-02** ([#159](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/159)) | The Tauri host reads `DesktopState` through the extension (zbus) and reports what changed since the last observation; Otto's own position is known on Wayland | WM-01 | D-24 |
| **WM-03** ([#160](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/160)) | Checked tools `desktop_observe` and `desktop_window` (closed kind, an opaque window id from the latest observation, a closed layout vocabulary), checked again in the browser; protocol on both ends and in the lab's fake server | WM-02 | D-02, D-19, D-22 |
| **WM-04** ([#161](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/161)) | Desktop actions get ALLOW / ASK / DENY tiers in `policy.py`; ASK approvals are bound to the action's arguments and expire; the audit survives the session | WM-03 | D-22, D-25 |
| **WM-05** ([#162](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/162)) | Every window action re-observes and compares the result, re-observes once more on a mismatch, and reports a verification failure instead of success | WM-03 | D-22 |
| **WM-06** ([#163](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/163)) | Pure layout geometry (left or right half, beside another window, maximise, workspace n) in a core file with tests; the "Move VS Code to the left" voice flow checked on the owner's Zorin machine | WM-03, WM-05 | D-13 |
| [#144](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/144) | Open any installed application from the `.desktop` list, with native confirmation | Q-11 | D-02, D-25 |

### 0.6 Personal memory (blocked by Q-12)

| Slice | Outcome | Blocked by | Decisions |
|---|---|---|---|
| **MEM-02** ([#164](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/164)) | The desktop host supplies one opaque owner identity to the local server, so memory is on in the desktop companion | Q-12 | D-01, D-26 |
| **MEM-03** ([#165](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/165)) | Memory records have kinds (user fact, preference, instruction, episodic, session, temporary); the model can recall and search; writes, updates and forgets stay proposals the visitor saves | MEM-02 | D-17, D-22 |
| **MEM-04** ([#166](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/166)) | The panel lists what Otto remembers and forgets one item or everything (`forget.py` gets its caller) | MEM-03 | D-06, D-26 |
| **MEM-05** ([#167](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/167)) | An acceptance test: "My name is Raghav", restart, "What is my name?" answers from memory | MEM-03 | |

### 0.7 Extensions and MCP

| Slice | Outcome | Blocked by | Decisions |
|---|---|---|---|
| **EXT-02** ([#168](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/168)) | `SKILL.md` skills load through `ExtensionManager` as prompt guidance (the JARVIS `adk_skill_loader.py` approach) | none | D-19, D-22 |
| **EXT-03** ([#169](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/169)) | A configured MCP server over stdio adds tools through the gateway, with a risk level per tool and secrets kept out of its environment | none | D-02, D-19, D-22 |

### 0.8 Hand pointer and roaming

| Slice | Outcome | Blocked by | Decisions |
|---|---|---|---|
| **HAND-01** ([#170](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/170)) | In the desktop app, hand control moves a pointer and pinch-drags a window through the checked desktop actions | Q-13, WM-05 | D-31 |
| [#143](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/143) | Otto walks along the screen and window top edges, using `DesktopState` | Q-11, WM-02 | D-07, D-24 |

### 0.9 Durable tasks, approvals and delivery (blocked by Q-14)

| Slice | Outcome | Blocked by | Decisions |
|---|---|---|---|
| **Q-14** ([#171](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/171)) | Decide what assistant state Otto may keep on disk, and for how long | none | D-17, D-21, D-26 |
| **TASK-02** | One task engine for the whole server, backed by SQLite, instead of one per voice session; a restart marks live runs interrupted and recovers them, re-delivering only inputs that were never taken; adds pause and resume | Q-14, MEM-02 | D-19, D-22 |
| **TASK-03** | Work that needs the visitor (approval, input, confirmation, retry) waits as a pending item in the panel and the tray, and resumes from its state when answered | TASK-02, POL-03 | D-06, D-22 |
| **POL-03** | Approvals and the policy audit survive a restart: approval rows with a lifetime per context, allow-once, bound to the action's arguments; a restart expires blocking rows; model text never approves | Q-14 | D-22, D-25 |
| **OUT-01** | Task results and pending items that arrive while the window is closed are kept and delivered, in order, when it reconnects | Q-14, TASK-02 | D-02, D-04 |
| **CTX-01** | Long conversations stay usable: Gemini Live context compression and session resumption first, then a handoff note that carries identity, task, decisions, open questions, tool results and desktop state into the next segment | Q-14, MEM-03 | D-17, D-22 |

Deferred on purpose:
- Otto as an MCP server, Playwright browser computer use, screenshots in the desktop state, and embeddings for memory search.
- Raw keyboard and mouse tools (`desktop.mouse`, `click`, `type`, `scroll`): the brief puts them after reliable window control, and on Wayland they would be blind.
- Workspace isolation (READ / WRITE_WORKSPACE / WRITE_EXTERNAL / EXECUTE / SYSTEM): Otto has no file or command tools, so there is nothing to fence yet. File it with the first tool that touches files.
- A multi-provider `ModelProvider`: ADK Live is Gemini-only, and Q-01 owns the voice provider boundary.
- `NEEDS_AUTHENTICATION`: no tool needs sign-in yet.

Each can be filed later.
