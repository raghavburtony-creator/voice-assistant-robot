# Decisions

This file **wins over every other doc** where it states a decision. `D-xx` is a decision, `Q-xx` an open question or a conflict found between docs.

D-01 to D-12 record choices the kit already made before this log existed. Each one cites where it was stated or enforced.

## Rules for entries

- Take the next free number. Next free: **D-14**, **Q-01**. Before using one, check `main` and the open PRs (`gh pr list`) for the same number.
- A decision is a `## D-xx` section with **Decision**, **Why** and **Where** (the code or test that enforces it). Change one only in a PR that says so in its title.
- An open question is a row in the table at the end: ID, question, owner, status (`open`, `answered by D-xx`, `dropped`).
- When a decision changes behaviour, update the root `README.md` and the routing table in [README.md](README.md) in the same commit.

## D-01 The Gemini key stays on the server

**Decision:** Only the server holds `GEMINI_API_KEY`. The browser talks to the server over a WebSocket and never sees the key.
**Why:** Live audio is billed to the key's owner, and anything in the browser is public.
**Where:** `server/app/config.py`; README, "How it works".

## D-02 Every action is checked twice

**Decision:** A tool checks its arguments on the server, and `toAssistantAction` checks the action again in the browser before `onAction` runs it.
**Why:** The model's output is untrusted. Two checks mean one bug on either side can't run an unknown action.
**Where:** `server/app/voice/tools.py`, `web/src/otto/messages.ts`; test `test_run_command_only_allows_known_commands`.

## D-03 Pages and commands are listed in both configs

**Decision:** `web/src/otto.config.ts` and `server/app/voice/app_config.py` each list the pages and commands, and the `PageId` and `Command` literals in `tools.py` repeat them. A test fails if they differ.
**Why:** ADK needs static `Literal`s for the model's enums, and the browser needs its own list to check actions (D-02).
**Where:** `test_tool_enums_match_the_config`, `test_web_config_has_the_same_pages_and_commands` in `server/tests/test_voice.py`.

## D-04 Sessions are capped in length and number

**Decision:** `max_session_seconds` (600) and `max_sessions` (4) limit live sessions. The server tells the browser the limit in `ready`.
**Why:** Live audio is billed per minute.
**Where:** `server/app/config.py`, `server/app/voice/route.py`.

## D-05 The microphone is silent while Otto is audible

**Decision:** While Otto speaks, the browser sends no microphone audio. The page listens for a voice clearly louder than his echo (`BARGE_IN`), then sends what it held back.
**Why:** Browsers don't cancel Otto's echo reliably, so the model would hear itself.
**Where:** `BARGE_IN` in `web/src/otto.config.ts`; README, "How it works". `BARGE_IN.level` still needs tuning on real hardware.

## D-06 The robot is decorative

**Decision:** The robot is hidden from screen readers. Everything Otto says or does is in the panel as text.
**Why:** A picture can't be the only channel for information.
**Where:** README, "How it works".

## D-07 Reduced motion stops the body, not the mouth

**Decision:** With `prefers-reduced-motion`, Otto doesn't walk (he snaps to the spot) and body motion stops. The mouth still follows his voice.
**Why:** The mouth carries speech timing, and it moves only within the visor.
**Where:** README, "How it works" and "Movement".

## D-08 "Hey Otto" is off until the visitor turns it on

**Decision:** The wake word is off by default, and a banner shows whenever it is listening.
**Why:** In Chrome and Edge, browser speech recognition sends microphone sound to the browser maker.
**Where:** `web/src/otto/wakeWord.ts` (`useWakeSetting`), `web/src/otto/Otto.tsx` (the "Listening for…" status); README, "How it works".

## D-09 CORS lists explicit origins

**Decision:** `CORS_ORIGINS` must name exact origins. A wildcard is refused at startup.
**Why:** A wildcard would let any site open a billed session.
**Where:** `server/app/config.py`; test `test_foreign_origin_is_refused`.

## D-10 The clay robot is vendored, with marked changes

**Decision:** `clay-robot.tsx` is Originkit's component, added with `npx originkit add clay-robot`. Every Otto change in it is marked `Otto:`.
**Why:** Re-running the add command overwrites the file, so the changes must be easy to find and re-apply.
**Where:** `web/src/components/originkit/ui/clay-robot.tsx`; README, "Otto's robot".

## D-11 Sound is synthesised and waits for a gesture

**Decision:** Otto's cues are synthesised with Web Audio (no audio files), follow gestures rather than voice state, and are skipped until the visitor's first click or key press.
**Why:** Browsers block audio before a user gesture, and synthesised cues add nothing to download.
**Where:** `web/src/otto/sound.ts`, `SOUND_SETTINGS` in `web/src/otto.config.ts`.

## D-12 One shader, no 3D library

**Decision:** The robot is one WebGL 2 raymarching shader. The kit has no three.js or other 3D library. Without WebGL 2 the robot isn't drawn, and text and ARIA output still work.
**Why:** It keeps `<otto-mascot>` self-contained and small.
**Where:** README, "Otto's robot" and "`<otto-mascot>`: Otto in any page".

## D-13 The web kit has two layers, and the dependency points inward

**Decision:** In `web/src/otto/`:
- **Core:** pure rules and data. No React, no packages, no browser globals, no app config, and imports only other core files. Today that is `movement/stage.ts`, `mouth.ts`, `robot/gestures.ts`, `robot/robot.ts`, `awareness/events.ts`, `awareness/reactions.ts`, `idle.ts`, `config.ts` and `soundCues.ts`.
- **Shell:** everything else in the kit. The adapters (Web Audio, the WebSocket and `messages.ts`, storage, speech recognition) and the React hooks and components. It may read `otto.config.ts`, the app's one composition root.
- **App:** `otto.config.ts`, `App.tsx`, `main.tsx` and the lab. It may import the kit; the kit never imports it, except shell reading `otto.config.ts`. `<otto-mascot>` (`element/`) never reaches `otto.config.ts`, so it stays standalone.

A hook that drives a core module sits beside it as `useX.ts`: `stage.ts` and `useStage.ts`, `idle.ts` and `useIdleLifecycle.ts`, `config.ts` and `useOttoConfig.ts`. Browser checks for the robot are in `robot/environment.ts`.
**Why:** The core can then be tested without a browser and reused without React, and a host app can't be coupled into the kit by accident. Before this, `idle.ts`, `robot.ts` and `config.ts` mixed pure code with React and the DOM, and pure `reactions.ts` named them.
**Where:** `web/src/otto/layers.test.ts` (fails on a wrong-way import, a browser global in core, or `<otto-mascot>` reaching the app config). The server is not covered yet: there, `route.py` and `bridge.py` are the FastAPI and ADK adapters, `tools.py` the checked actions, and `app_config.py` the app's settings.

## Open questions

| ID | Question | Owner | Status |
|---|---|---|---|
