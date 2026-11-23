# Roadmap

Otto's product epics, how they depend on each other, and what is filed for the first one. The GitHub issues are the source of truth for scope and progress. This page is the map. How each capability attaches to the existing code is in [architecture.md](architecture.md#target-an-embodied-accessible-assistant-that-keeps-track-of-the-task).

## Epics

| Epic | Outcome | Blocked by | Milestones |
|---|---|---|---|
| **E1 Task-aware Otto** ([#7](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/7)) | The model knows which guided task is running, which step it is on and what the app is busy with. Later, a task survives a reload. | none (the reload slice waits on Q-02) | 0.2, 0.3 |
| **E2 Continuity across interfaces** ([#8](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/8)) | A task started in one session, device or app can be picked up in another. | E1; Q-03, Q-04, Q-08 | not scheduled |
| **E3 Multimodal input** ([#9](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/9)) | Otto can take camera or screen input, with consent and a visible indicator. | Q-07 | not scheduled |
| **E4 Sign-language support** ([#10](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/10)) | A visitor can sign to Otto, and what Otto understands appears as text. | E3; Q-07 | not scheduled |
| **E5 Environmental intelligence** ([#11](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/11)) | Otto reacts to what is around the visitor, through the existing awareness vocabulary. | E3; Q-07 | not scheduled |
| **E6 Spatial / AR presence** ([#12](https://github.com/raghavburtony-creator/voice-assistant-robot/issues/12)) | Otto appears in spatial or AR interfaces, using the same robot state. | Q-06 | not scheduled |

```
E1 Task-aware ──► E2 Continuity across interfaces
E3 Multimodal ──► E4 Sign language
             └──► E5 Environmental intelligence
E6 Spatial / AR (independent; waits on Q-06)
```

Only E1 is broken down. Each later epic gets its tasks once its blocking questions are answered. Its first issue is then the investigation of the question (**Architecture question** template), not code.

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

Resuming a task after a reload is filed only once TA-4 has answered Q-02: what can be built depends on the answer.

Milestones are set on GitHub once `.github/workflows/sync-labels.yml` has created them. Until then each issue names its milestone in its first line.
