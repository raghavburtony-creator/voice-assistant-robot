# Documentation

Precedence: [decisions.md](decisions.md) first, then the root [README.md](../README.md), then code comments. If two disagree and `decisions.md` is silent, add a `Q-` entry there and continue. Never pick silently.

## What to load for a task

Find the task's row. Read the decisions it names, then the README sections and files it names. Load nothing else unless one of those sends you further.

| Task | Decisions | README sections | Files |
|---|---|---|---|
| Get oriented | all (the index in decisions.md) | "How it works", "Using it in a new project" | `AGENTS.md`, [architecture.md](architecture.md) |
| Run or change the desktop companion (Tauri host, movement, awareness, permissioned actions, desktop bridge, packaging) | D-24, D-25 | "Run Otto as a desktop companion" | `web/src-tauri/`, `web/src/otto/desktop.ts` and its test, `web/src/otto/VoiceAssistant.tsx`, `web/src/otto/Otto.tsx`, `server/app/voice/tools.py`, `server/app/voice/app_config.py`, `server/tests/test_voice.py`, `web/package.json` |
| Add a page or a command | D-02, D-03, D-23 | "Using it in a new project" | `web/src/otto.config.ts`, `server/app/voice/app_config.py`, `server/app/voice/tools.py`, `server/tests/test_voice.py` |
| Runtime navigation destinations (`navigate_to`) | D-02, D-03, D-17, D-22, D-23 | "Using it in a new project", "Adding a tool" | `web/src/otto/context.ts`, `contextBudget.ts`, `runtimeId.ts`, `messages.ts`, `useVoiceAssistant.ts` (`currentPageInfo`, start/page messages), `Otto.tsx` (`page`), `App.tsx` `onAction`, and their tests; `server/app/voice/runtime.py`, `tools.py`, `route.py` (start), `bridge.py` (page changes), `app_config.py` (`system_instruction`), `server/tests/test_voice.py` |
| Add or register a tool | D-02, D-03, D-22, D-23 | "Adding a tool" | `server/app/voice/tool_registry.py` (metadata, schemas, validation and result envelope), `server/app/voice/tools.py` (checked implementations and `TOOL_FUNCTIONS`), `sink.py`, `app_config.py` (`system_instruction`), `web/src/otto/messages.ts`, `App.tsx` `onAction`, `server/tests/test_voice.py` |
| Change model/tool routing within the existing runtime | D-02, D-19, D-22 | "How it works" | `server/app/voice/bridge.py` (ADK live-session and agent setup), `server/app/voice/tools.py` (checked capabilities), `server/tests/test_orchestration_contract.py`, `server/tests/test_voice.py` |
| Change the wire protocol (a message type) | D-02, D-04 | "How it works" | `server/app/voice/bridge.py`, `route.py`, `web/src/otto/messages.ts`, `web/src/otto/useVoiceAssistant.ts`, `web/src/lab/fakeServer.ts` |
| Server: session, key, CORS, limits | D-01, D-04, D-09 | "Deploying" | `server/app/config.py`, `server/app/main.py`, `server/app/voice/route.py`, `model.py` |
| Live audio, playback, barge-in, autoplay | D-05 | "How it works" (barge-in, autoplay, listening vs speaking) | `web/src/otto/audio.ts`, `useVoiceAssistant.ts`, `speechGate.ts` and its test (turn gate, barge-in gate, noise floor), `BARGE_IN` and `VAD` in `otto.config.ts`; `server/app/voice/events.py`, `output.py`, `bridge.py` and `server/tests/test_voice_split.py` (typed events, the output writer, interruption) |
| Mouth and lip-sync, the speech bubble | D-07 | "How it works" (mouth, bubble) | `web/src/otto/mouth.ts`, `web/src/otto/robot/OttoRobot.tsx`, `web/src/otto/robot/ClayScene.tsx` |
| Sound cues | D-11 | "Sound" | `web/src/otto/sound.ts`, `useGestureSounds.ts`, `SOUND_SETTINGS` |
| Robot look, faces, the shader | D-06, D-10, D-12 | "Otto's robot" | `web/src/otto/robot/robot.ts`, `web/src/otto/robot/environment.ts`, `ClayScene.tsx`, `web/src/components/originkit/ui/clay-robot.tsx` |
| Gestures | D-07 | "Gestures" | `web/src/otto/robot/gestures.ts`, `useGestureTriggers.ts`, `GESTURE_SETTINGS` |
| Movement | D-07 | "Movement" | `web/src/otto/movement/stage.ts`, `useStage.ts`, `MOVEMENT_SETTINGS` |
| Idle and sleep | D-13 | "Idle and sleep" | `web/src/otto/idle.ts`, `web/src/otto/useIdleLifecycle.ts`, `IDLE_SETTINGS` |
| Awareness (app events, reactions) | D-02, D-19, D-22, D-30 | "Awareness: Otto reacts to what happens in your app" (asking permission, avatar events, environmental proposals) | `web/src/otto/awareness/` (`events.ts`, `reactions.ts`, `avatar.ts`, `environmental.ts` and tests), `server/app/voice/avatar.py`, `environmental.py`, `bridge.py`, `server/app/voice/tools.py`, `sink.py`, `server/tests/test_environmental.py`, `test_voice.py`, `web/src/otto/messages.ts`, `useVoiceAssistant.ts`, `useScreenShare.ts`, `web/src/lab/fakeServer.ts` |
| Themes and per-instance config | D-13 | "Themes and per-instance config" | `web/src/otto/config.ts`, `web/src/otto/useOttoConfig.ts`, `OTTO_CONFIG` in `otto.config.ts` |
| Guidance rules (what Otto does for a request, tasks, observed progress, when to offer help) | D-13, D-14, D-16 | "Interactive guidance" | `web/src/otto/guidance/guide.ts`, `task.ts`, `help.ts` and their tests, `guidance` in `web/src/otto/config.ts` |
| Guidance runtime (targets, offered tasks, the runner, the observer, the highlight, Show me / Not now) | D-06, D-14, D-16, D-20 | "Interactive guidance" | `web/src/otto/guidance/runner.ts`, `targets.ts`, `observe.ts`, `web/e2e/guidance.spec.ts`, `web/src/otto/Otto.tsx`, `web/src/otto/element/createOtto.tsx`, `voice.css`; reload continuity (D-20): `web/src/otto/guidance/task.ts` (`resumeFrom`), `web/src/otto/storage.ts` (session area) |
| Guidance by voice (`show_target`, `start_guided_task`, `move_guided_task`) | D-02, D-14, D-16, D-23 | "Interactive guidance", "Adding a tool" | `server/app/voice/tools.py`, `bridge.py` (`update_context`), `web/src/otto/contextBudget.ts`, `runtimeId.ts`, `app_config.py` (`system_instruction`), `server/tests/test_voice.py`, `web/src/otto/messages.ts`, `useVoiceAssistant.ts`, `guidance/guide.ts` (`move`), `guidance/task.ts` (`GUIDE_TASK_MOVES`) |
| Embodied assistance: page snapshot, privacy and budget | D-02, D-13, D-17 | "Embodied assistance: page context, cards, friction" | `web/src/otto/awareness/page.ts`, `collectPage.ts` and their tests, `pageContext` in `web/src/otto/config.ts`, `web/src/otto/guidance/hidden.ts`, `web/src/otto/Otto.tsx` |
| Cross-session continuity identity boundary | D-20, D-26 | "Continuity across interfaces" | `server/app/voice/continuity.py`, `server/app/voice/route.py`, `server/app/config.py`, `server/tests/test_continuity.py` |
| Cross-session and cross-interface task continuity | D-20, D-23, D-26 | "Continuity across interfaces", "Interactive guidance" | `server/app/voice/continuity.py`, `context.py`, `continuity_store.py`, `bridge.py`, `tools.py`; `server/tests/test_continuity_store.py`, `test_voice.py`; `web/src/otto/context.ts` and its test, `Otto.tsx`, `guidance/task.ts`, `messages.ts`, `web/e2e/guidance.spec.ts` |
| Sign-language pilot decision and dataset assessment (Q-09) | D-21, D-29, Q-09 | "Sign-language input boundary" | [sign-language-pilot-research.md](sign-language-pilot-research.md) (public resource audit, rights questions, community validation and evaluation plan) |
| Sign-language recognition boundary and text handoff | D-02, D-06, D-19, D-21, D-22, D-29, Q-09 | "Sign-language input boundary" | `web/src/otto/capture.ts`, `useScreenShare.ts`, `ScreenShare.tsx`, `useVoiceAssistant.ts`, `server/app/voice/bridge.py`, `VoiceAssistant.tsx`; `web/src/otto/signRecognition.ts` and its test (typed updates, session/order gate, deterministic adapter) |
| Camera and screen capture: consent, frames, masking, retention | D-04, D-06, D-08, D-13, D-17, D-19, D-21 | "Sharing the screen or the camera" | `docs/decisions.md` (D-21), `web/src/otto/capture.ts` and its test, `useScreenShare.ts`, `ScreenShare.tsx`, `web/e2e/share.spec.ts`, `useVoiceAssistant.ts` (`sendCapture`, `sendFrame`), `web/src/otto/consent.ts`, `web/src/otto/guidance/hidden.ts`, `server/app/voice/bridge.py`, `web/src/lab/fakeServer.ts` |
| Embodied assistance: cards and the two channels (`show_card`, the bubble, `onVisual`) | D-02, D-18 | "Embodied assistance: page context, cards, friction", "Adding a tool" | `server/app/voice/tools.py`, `app_config.py` (`system_instruction`), `web/src/otto/messages.ts`, `VoiceAssistant.tsx`, `useVoiceAssistant.ts`, `web/src/otto/gemini/channels.ts`, `prompt.ts`, `bridge.ts`, `web/src/lab/fakeServer.ts` |
| Embodied assistance: friction, the spotlight, missing and hidden targets | D-07, D-11, D-14, D-16 | "Interactive guidance", "Embodied assistance: page context, cards, friction" | `web/src/otto/guidance/friction.ts`, `frictionObserver.ts`, `spotlight.ts`, `runner.ts` and their tests, `web/e2e/embodied.spec.ts`, `web/src/lab/EmbodiedSandbox.tsx` |
| Add a module, or move code between files (layers) | D-13 | | `web/src/otto/layers.test.ts`, `AGENTS.md` ("Rules for code") |
| `<otto-mascot>`, `createOtto`, the library build | D-12 | "`<otto-mascot>`: Otto in any page" | `web/src/otto/element/`, `vite.lib.config.ts`, `tsconfig.lib.json`, `web/preview/` |
| React adapter (`otto-mascot/react`) | D-15 | "`<otto-mascot>`: Otto in any page" | `web/src/otto/react/` |
| Gemini voice bridge (`otto-mascot/gemini`) | D-01, D-05, D-15, Q-01 | "`<otto-mascot>`: Otto in any page" | `web/src/otto/gemini/` |
| Packaging: subpaths, `exports`, the dist check | D-12, D-15 | "`<otto-mascot>`: Otto in any page" | `web/package.json`, `vite.lib.config.ts`, `vite.adapters.config.ts`, `tsconfig.lib.json`, `web/scripts/check-dist.mjs` |
| Voice panel UI, consent, wake word | D-06, D-08 | "How it works" | `web/src/otto/VoiceAssistant.tsx`, `ui.tsx`, `consent.ts`, `wakeWord.ts`, `useWakeWord.ts`, `voice.css` |
| The lab | | "Run it", "Embodied assistance: page context, cards, friction" (sandbox) | `web/src/lab.tsx`, `web/src/lab/` |
| Tests | | "Run it" (checks) | `server/tests/`, `web/src/**/*.test.ts` |
| Browser tests (Playwright) | | "Run it" (checks) | `web/e2e/`, `web/playwright.config.ts` |
| Record or change a decision, or add an open question | the one concerned | | [decisions.md](decisions.md) ("Rules for entries", "Index"), `server/tests/test_docs.py` |
| Plan a new capability, or check how one fits | D-19, D-22, D-23, and the Q-xx it touches | | [architecture.md](architecture.md), [roadmap.md](roadmap.md) |
| Architecture contracts, service boundaries, or source/licence attribution | D-13, D-19, D-22, and the decisions named by the capability | | [architecture.md](architecture.md), [source-attribution.md](source-attribution.md), [decisions.md](decisions.md), [roadmap.md](roadmap.md), the relevant issue(s) |
| File or triage an issue: templates, labels, milestones, the issue-to-PR workflow | D-19 | | [CONTRIBUTING.md](../CONTRIBUTING.md), `.github/ISSUE_TEMPLATE/`, `.github/labels.json`, `.github/milestones.json`, `.github/workflows/sync-labels.yml`, `server/tests/test_docs.py` |

## Editing rules

- Keep README section headings stable: this table and the agents cite them by name. If you rename one, update every row here.
- When code changes behaviour the README describes, update that README section in the same commit.
- A new area of the code gets a row here in the same commit.
