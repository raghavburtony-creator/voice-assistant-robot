# Documentation

Precedence: [decisions.md](decisions.md) first, then the root [README.md](../README.md), then code comments. If two disagree and `decisions.md` is silent, add a `Q-` entry there and continue. Never pick silently.

## What to load for a task

Find the task's row. Read the decisions it names, then the README sections and files it names. Load nothing else unless one of those sends you further.

| Task | Decisions | README sections | Files |
|---|---|---|---|
| Get oriented | all (one page) | "How it works", "Using it in a new project" | `CLAUDE.md` |
| Add a page or a command | D-02, D-03 | "Using it in a new project" | `web/src/otto.config.ts`, `server/app/voice/app_config.py`, `server/app/voice/tools.py`, `server/tests/test_voice.py` |
| Add a tool | D-02, D-03 | "Adding a tool" | `server/app/voice/tools.py`, `sink.py`, `app_config.py` (`system_instruction`), `web/src/otto/messages.ts`, `App.tsx` `onAction` |
| Change the wire protocol (a message type) | D-02, D-04 | "How it works" | `server/app/voice/bridge.py`, `route.py`, `web/src/otto/messages.ts`, `web/src/otto/useVoiceAssistant.ts`, `web/src/lab/fakeServer.ts` |
| Server: session, key, CORS, limits | D-01, D-04, D-09 | "Deploying" | `server/app/config.py`, `server/app/main.py`, `server/app/voice/route.py`, `model.py` |
| Live audio, playback, barge-in, autoplay | D-05 | "How it works" (barge-in, autoplay) | `web/src/otto/audio.ts`, `useVoiceAssistant.ts`, `BARGE_IN` in `otto.config.ts` |
| Mouth and lip-sync, the speech bubble | D-07 | "How it works" (mouth, bubble) | `web/src/otto/mouth.ts`, `web/src/otto/robot/OttoRobot.tsx`, `web/src/otto/robot/ClayScene.tsx` |
| Sound cues | D-11 | "Sound" | `web/src/otto/sound.ts`, `useGestureSounds.ts`, `SOUND_SETTINGS` |
| Robot look, faces, the shader | D-06, D-10, D-12 | "Otto's robot" | `web/src/otto/robot/robot.ts`, `web/src/otto/robot/environment.ts`, `ClayScene.tsx`, `web/src/components/originkit/ui/clay-robot.tsx` |
| Gestures | D-07 | "Gestures" | `web/src/otto/robot/gestures.ts`, `useGestureTriggers.ts`, `GESTURE_SETTINGS` |
| Movement | D-07 | "Movement" | `web/src/otto/movement/stage.ts`, `useStage.ts`, `MOVEMENT_SETTINGS` |
| Idle and sleep | D-13 | "Idle and sleep" | `web/src/otto/idle.ts`, `web/src/otto/useIdleLifecycle.ts`, `IDLE_SETTINGS` |
| Awareness (app events, reactions) | | "Awareness: Otto reacts to what happens in your app" | `web/src/otto/awareness/` |
| Themes and per-instance config | D-13 | "Themes and per-instance config" | `web/src/otto/config.ts`, `web/src/otto/useOttoConfig.ts`, `OTTO_CONFIG` in `otto.config.ts` |
| Add a module, or move code between files (layers) | D-13 | | `web/src/otto/layers.test.ts`, `CLAUDE.md` ("Rules for code") |
| `<otto-mascot>`, `createOtto`, the library build | D-12 | "`<otto-mascot>`: Otto in any page" | `web/src/otto/element/`, `vite.lib.config.ts`, `tsconfig.lib.json`, `web/preview/` |
| Voice panel UI, consent, wake word | D-06, D-08 | "How it works" | `web/src/otto/VoiceAssistant.tsx`, `ui.tsx`, `consent.ts`, `wakeWord.ts`, `useWakeWord.ts`, `voice.css` |
| The lab | | "Run it" | `web/src/lab.tsx`, `web/src/lab/` |
| Tests | | "Run it" (checks) | `server/tests/`, `web/src/**/*.test.ts` |
| Record or change a decision | the one concerned | | [decisions.md](decisions.md) ("Rules for entries") |

## Editing rules

- Keep README section headings stable: this table and the agents cite them by name. If you rename one, update every row here.
- When code changes behaviour the README describes, update that README section in the same commit.
- A new area of the code gets a row here in the same commit.
