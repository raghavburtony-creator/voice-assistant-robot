# Roadmap

Otto's product epics, how they depend on each other, and what is filed for the first one. The GitHub issues are the source of truth for scope and progress. This page is the map. How each capability attaches to the existing code is in [architecture.md](architecture.md#target-an-embodied-accessible-assistant-that-keeps-track-of-the-task).

## Epics

| Epic | Outcome | Blocked by | Milestones |
|---|---|---|---|
| **E1 Task-aware Otto** ([#7](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/7)) | The model knows which guided task is running, which step it is on and what the app is busy with. Later, a task survives a reload. | none (the reload slice follows D-20) | 0.2, 0.3 |
| **E2 Continuity across interfaces** ([#8](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/8)) | A task started in one session, device or app can be picked up in another. | E1; Q-03 (Q-04 answered by D-22, Q-08 by D-23) | not scheduled |
| **E3 Multimodal input** ([#9](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/9)) | Otto can take camera or screen input, with consent and a visible indicator. | none (Q-07 answered by D-21) | not scheduled |
| **E4 Sign-language support** ([#10](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/10)) | A visitor can sign to Otto, and what Otto understands appears as text. | E3 shipped; Q-09 (language, pilot task and community validation) | not scheduled |
| **E5 Environmental intelligence** ([#11](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/11)) | Otto reacts to what is around the visitor, through the existing awareness vocabulary. | E3 (Q-07 answered by D-21); Q-10 (environmental observation authority) | not scheduled |
| **E6 Spatial / AR presence** ([#12](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/12)) | Otto appears in spatial or AR interfaces, using the same robot state. | A named target device/runtime and user-facing rendering and interaction requirements (D-28) | not scheduled |

```
E1 Task-aware ──► E2 Continuity across interfaces
E3 Multimodal ──► E4 Sign language (Q-09)
             └──► E5 Environmental intelligence (Q-10)
E6 Spatial / AR (independent; waits for a target and requirements to be specified in issue #12, per D-28)
```

Each later epic gets its tasks once its blocking questions are answered. E4's first investigation (SIG-01, #90) establishes the temporal-recognition boundary; its provider-neutral contract slice is SIG-02 (#92). Q-09 remains open and blocks selection of a language-specific model or dataset. For E6, Q-06 is answered by D-28; issue #12 must first name the target device/runtime and user-facing requirements.

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


## E4 Sign-language support: first slices

D-29 establishes that sign recognition cannot reuse the D-21 1 FPS still-frame feed as a continuous sign recognizer. Recognition must be a bounded, visitor-started temporal adapter whose results enter the existing conversation as text; the visitor can correct or discard uncertain results.

| Slice | Outcome | Blocked by | Decisions |
|---|---|---|---|
| **SIG-01** ([#90](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/90)) | Investigate the existing capture/session boundary and establish the provider-neutral recognition contract | none | D-06, D-19, D-21, D-29 |
| **SIG-02** ([#92](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/92)) | Add typed recognition updates and a deterministic test adapter, then hand confirmed text into the existing conversation path; no live model or camera capture | SIG-01 | D-02, D-06, D-19, D-22, D-29 |
| **Q-09** ([#91](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/91)) | Confirm the first sign language, community-validated pilot task and dataset/collection rights | community consultation | D-29 |
