# Decisions

This file **wins over every other doc** where it states a decision. `D-xx` is a decision, `Q-xx` an open question or a conflict found between docs.

D-01 to D-12 record choices the kit already made before this log existed. Each one cites where it was stated or enforced.

## Rules for entries

- Take the next free number. Next free: **D-20**, **Q-09**. Before using one, check `main` and the open PRs for the same number. `server/tests/test_docs.py` fails if a number repeats, if this line is wrong, or if the index below misses an entry.
- A decision is a `## D-xx` section with **Decision**, **Why** and **Where** (the code or test that enforces it). Change one only in a PR that says so in its title.
- A decision's status is in the index: `current`, `amended by D-xx` (the newer record says what changed; the old one stays), or `superseded by D-xx`. Never delete a decision or reuse its number.
- An open question is a row in the table at the end: ID, question, what it blocks, owner, status (`open`, `answered by D-xx`, `dropped`). An issue that waits on one gets the `status: needs-decision` label and links the `Q-xx`. Use the **Question** issue template to investigate one.
- Answer a question with a new decision. Set the question's status to `answered by D-xx`, and leave the row.
- When a decision changes behaviour, update the root `README.md` and the routing table in [README.md](README.md) in the same commit.
- [architecture.md](architecture.md) describes how the decisions fit together. It doesn't make decisions.

## Index

| ID | Title | Area | Status |
|---|---|---|---|
| D-01 | The Gemini key stays on the server | security | current |
| D-02 | Every action is checked twice | security | current |
| D-03 | Pages and commands are listed in both configs | contracts | current |
| D-04 | Sessions are capped in length and number | cost | current |
| D-05 | The microphone is silent while Otto is audible | voice | current |
| D-06 | The robot is decorative | accessibility | current |
| D-07 | Reduced motion stops the body, not the mouth | accessibility | current |
| D-08 | "Hey Otto" is off until the visitor turns it on | privacy | current |
| D-09 | CORS lists explicit origins | security | current |
| D-10 | The clay robot is vendored, with marked changes | robot | current |
| D-11 | Sound is synthesised and waits for a gesture | sound | current |
| D-12 | One shader, no 3D library | robot | current |
| D-13 | The web kit has two layers, and the dependency points inward | layers | current |
| D-14 | Guidance: the host says what, Otto decides how | guidance | current |
| D-15 | Adapters are optional subpaths | packaging | current |
| D-16 | Otto sees task progress and offers help himself; the voice can start offered tasks | guidance | current |
| D-17 | The page snapshot is privacy-filtered, budgeted and sent only while talking | privacy | current |
| D-18 | Two channels: the voice speaks plainly, cards carry what must be read | channels | current |
| D-19 | New capabilities extend the existing pipeline | architecture | current |
| Q-01 | Is the Gemini Live wire format right? | voice | open |
| Q-02 | Where does task state live, and for how long? | tasks | open |
| Q-03 | Who is the visitor, across sessions and interfaces? | privacy | open |
| Q-04 | Is runtime authority a chain, or one component? | architecture | open |
| Q-05 | How are the server's layers enforced? | layers | open |
| Q-06 | How does Otto appear in spatial or AR interfaces, given D-12? | robot | open |
| Q-07 | What consent and privacy rules apply to camera and screen input? | privacy | open |
| Q-08 | How are pages and commands allowed when they aren't known at build time? | contracts | open |

The review of D-01 to D-18 against the target architecture is in [architecture.md](architecture.md#review-of-d-01-to-d-18-november-2026).

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
- **Core:** pure rules and data. No React, no packages, no browser globals, no app config, and imports only other core files. Today that is `movement/stage.ts`, `mouth.ts`, `robot/gestures.ts`, `robot/robot.ts`, `awareness/events.ts`, `awareness/reactions.ts`, `awareness/page.ts`, `guidance/guide.ts`, `guidance/task.ts`, `guidance/help.ts`, `guidance/friction.ts`, `gemini/channels.ts`, `gemini/prompt.ts`, `idle.ts`, `config.ts` and `soundCues.ts`.
- **Shell:** everything else in the kit. The adapters (Web Audio, the WebSocket and `messages.ts`, storage, speech recognition) and the React hooks and components. It may read `otto.config.ts`, the app's one composition root.
- **App:** `otto.config.ts`, `App.tsx`, `main.tsx` and the lab. It may import the kit; the kit never imports it, except shell reading `otto.config.ts`. `<otto-mascot>` (`element/`) never reaches `otto.config.ts`, so it stays standalone.

A hook that drives a core module sits beside it as `useX.ts`: `stage.ts` and `useStage.ts`, `idle.ts` and `useIdleLifecycle.ts`, `config.ts` and `useOttoConfig.ts`. Browser checks for the robot are in `robot/environment.ts`.
**Why:** The core can then be tested without a browser and reused without React, and a host app can't be coupled into the kit by accident. Before this, `idle.ts`, `robot.ts` and `config.ts` mixed pure code with React and the DOM, and pure `reactions.ts` named them.
**Where:** `web/src/otto/layers.test.ts` (fails on a wrong-way import, a browser global in core, or `<otto-mascot>` reaching the app config). The server is not covered yet: there, `route.py` and `bridge.py` are the FastAPI and ADK adapters, `tools.py` the checked actions, and `app_config.py` the app's settings.

## D-14 Guidance: the host says what, Otto decides how

**Decision:** The host names a target (`guide.show`, a task step, or the voice); Otto picks the size (skip, offer, glance, point, approach, explain) from the request and the situation, and holds back unrequested ones (cooldown, asleep, tab hidden, in a conversation, explicit modes capped at point unless major). The rules are core: `planGuide` in `guidance/guide.ts` and the task machine in `guidance/task.ts` are pure, and both are in `CORE`. The shell does the work: `guidance/runner.ts` carries out a plan, `guidance/targets.ts` reads the page's targets. The voice's `show_target` tool accepts only target ids the page reported to the server, and the browser checks the id against the page again (D-02).
**Why:** The host knows what matters; Otto knows how much of his attention it deserves. Keeping the judgement pure makes it testable without a browser, and the model can't point at something the page never offered.
**Where:** `web/src/otto/guidance/guide.ts`, `task.ts`, `runner.ts`, `targets.ts` and their tests; `web/src/otto/layers.test.ts`; `show_target` in `server/app/voice/tools.py`, test `test_show_target_only_allows_reported_targets`; `toAssistantAction` in `web/src/otto/messages.ts`; README, "Interactive guidance".

## D-15 Adapters are optional subpaths

**Decision:** The React wrapper (`otto-mascot/react`) and the Gemini voice bridge (`otto-mascot/gemini`) are separate entry points, built apart from the element. In the adapters React is external (the app's own, an optional peer dependency), and the React adapter reaches the element only through a dynamic import of the root bundle. The element keeps React bundled inside. `scripts/check-dist.mjs` fails the build if adapter code reaches the root bundle, if `react.js` bundles React or defines the element, or if `gemini.js` imports React or the element.
**Why:** A page that wants only the mascot downloads no adapter, and an app that uses an adapter doesn't get a second React through it.
**Where:** `web/vite.lib.config.ts`, `web/vite.adapters.config.ts`, `web/scripts/check-dist.mjs` (run by `npm run build:lib`), `exports` and `peerDependencies` in `web/package.json`; README, "`<otto-mascot>`: Otto in any page".

## D-16 Otto sees task progress and offers help himself; the voice can start offered tasks

**Decision:**
- **Observed progress.** A task step may name what finishes it (`doneWhen`) and what undoes it (`undoneWhen`), and the task what abandons it (`cancelWhen`). The signals are the visitor activating or typing in a target, or an app event in the awareness vocabulary.
- **The rules are core.** `observe` in `guidance/task.ts` maps an observation to next, skip, back, cancel or nothing. The shell (`guidance/observe.ts`) watches clicks and typing on targets and the app's events, only while a task runs.
- **Help.** An event can name a `help` target. `guidance/help.ts` (core) turns it into a guide request only when help is likely needed: the same failure again within `helpWindowMs`, a major failure, attention, or major waiting. The guide's own judgement (D-14) still decides how much to show, and no offer is made while a task runs.
- **Voice.** The voice's `start_guided_task` tool accepts only task ids the page reported in `guide_tasks` (`registerGuideTask`), and the browser checks the id again (D-02).

**Why:** Guiding means seeing that the visitor did the step, not waiting for the host to say so. Telling "something happened" apart from "something happened they need help with" needs a rule, and repetition is the cheapest honest signal. The model can't start a task the page never offered.
**Where:** `web/src/otto/guidance/task.ts`, `help.ts`, `observe.ts`, `targets.ts` (`registerGuideTask`) and their tests; `web/e2e/guidance.spec.ts`; `start_guided_task` in `server/app/voice/tools.py`, test `test_start_guided_task_only_allows_reported_tasks`; `toAssistantAction` in `web/src/otto/messages.ts`; README, "Interactive guidance".

## D-17 The page snapshot is privacy-filtered, budgeted and sent only while talking

**Decision:**
- While a conversation is open, `<Otto>` sends the model a snapshot of the page under the context key `page` (`collectPageContext`): path, title, headings, named landmarks, open dialogs and expanded panels, form errors. Nothing is read or sent outside a conversation, or with `pageContext.enabled: false`.
- Never read, with no option to change it: anything under `[data-otto-private]` or Otto's own panel; password, hidden and payment (`autocomplete="cc-*"`) fields, label and error included; any typed value; the query string and non-route hashes.
- The selected text only with `pageContext.includeSelection` (default off).
- The snapshot is cut to `pageContext.maxChars` and `maxNodes`, errors kept first. The shape and the budget are core (`awareness/page.ts`), the DOM reading shell (`awareness/collectPage.ts`).
- Page text is data, not instructions: the prompt says so, and `show_target` still accepts only reported target ids (D-14).

**Why:** The model answers better when it knows what is on screen, and the visitor has agreed to send their voice to Google, not their password, card number or medical notes. A fixed list of exclusions a host can't switch off is safer than one it must remember to switch on. The budget keeps each turn small and fast.
**Where:** `web/src/otto/awareness/page.ts`, `collectPage.ts` and `collectPage.test.ts`; `web/src/otto/guidance/hidden.ts` (`PRIVATE_SELECTOR`); `pageContext` in `web/src/otto/config.ts`; `web/src/otto/Otto.tsx`; `web/e2e/embodied.spec.ts`; README, "Embodied assistance".

## D-18 Two channels: the voice speaks plainly, cards carry what must be read

**Decision:**
- The model is told never to say URLs, code or markdown aloud. What must be read goes on a card through the `show_card` tool.
- A card is plain text in the panel: a title, a body, optional code, up to three follow-up questions. Both ends check and cap it (`tools.py`, `toAssistantCard` in `messages.ts`). It is rendered as text, never as HTML, and has no links. A follow-up is sent only when the visitor presses it.
- The bubble shows the spoken channel only (`toSpoken`). `otto-mascot/gemini` splits a streamed reply the same way (`createChannelSplitter`), and hands code and links to the host's `onVisual`, which must check a link before making it clickable.
- No model tool to celebrate or to scroll: Otto celebrates what he saw finished (D-16), and `show_target` already scrolls.

**Why:** A native-audio model's speech can't be filtered after it is generated; it has to be asked not to say these things, and given somewhere else to put them. A link or HTML from the model would be untrusted output used as a URL or markup (D-02). A model that can't see the screen can't know a step is done.
**Where:** `show_card` in `server/app/voice/tools.py`, `system_instruction` in `app_config.py`, tests `test_show_card_checks_and_caps_what_the_model_sends` and `test_instruction_keeps_urls_and_code_out_of_speech`; `web/src/otto/messages.ts`, `VoiceAssistant.tsx` (`VoiceCard`), `web/src/otto/gemini/channels.ts`, `prompt.ts`, `bridge.ts`; README, "Embodied assistance".

## D-19 New capabilities extend the existing pipeline

**Decision:** A new capability (task awareness, continuity, cross-application, multimodal input, sign language, environmental intelligence, spatial presence) attaches to the parts that exist. It does not run beside them:
- Model actions go through a checked tool in `tools.py` and through `toAssistantAction` (D-02). Widening what the model can do means a list the page reports, not a free-form string.
- What the model learns about the page goes through the context channel (`publishContext` and the session's `screens`), within a budget. Nothing opens a second channel.
- New rules are core modules with tests, and their adapters are shell (D-13). Task state belongs to the guide (`guidance/task.ts`), and app events to `createOttoEvents`.
- Everything Otto shows, says or signs is also text in the panel (D-06), and every new input keeps the privacy exclusions of D-17.
- Runtime authority is the chain in [architecture.md](architecture.md#who-decides-at-runtime): the model proposes, the server checks, the browser checks, the host executes, Otto decides how. Engineering agents have no runtime or architectural authority. They work within this log and a person reviews their pull requests.

**Why:** The checks in D-02, D-14, D-16 and D-17 hold only if every path goes through them. A parallel system for a new capability would need the same checks again, and would drift from them. The owner set this rule in issue #6.
**Where:** [architecture.md](architecture.md); enforced by the existing tests for D-02, D-13 and D-17 (`server/tests/test_voice.py`, `web/src/otto/layers.test.ts`, `web/src/otto/messages.test.ts`, `web/src/otto/awareness/collectPage.test.ts`) and by review (AGENTS.md, "Review guidelines").

## Open questions

| ID | Question | Blocks | Owner | Status |
|---|---|---|---|---|
| Q-01 | Is the Gemini Live wire format in `web/src/otto/gemini/transports.ts` right? Every `[verify]` item there (the ephemeral-token endpoint, the model id, message field names, audio formats, the setup message) has to be checked against a real Live endpoint and the pinned `google-genai`. | `otto-mascot/gemini` in production | unassigned | open |
| Q-02 | Where does task state live, and for how long? Today a guided task lives in the browser's memory (`createOttoGuide`): a reload ends it, and the server keeps nothing after a session (`InMemorySessionService`, deleted on close). Options: memory only; `sessionStorage` (survives a reload in this tab); `localStorage` (survives closing the tab); on the server. Each step out widens what is stored about the visitor (D-17). | Task continuity (reload, new session); investigated in #16 | unassigned | open |
| Q-03 | Who is the visitor, across sessions and interfaces? The server uses one fixed `USER_ID = "visitor"` (`bridge.py`). Continuity across devices or apps needs an identity the kit doesn't have, supplied by the host and never invented by the kit, along with a consent and retention rule. | Task continuity across interfaces, cross-application | unassigned | open |
| Q-04 | Issue #6 calls Otto's orchestrator the runtime authority, but no such module exists: authority is the chain in architecture.md (D-19). Keep the chain as the definition, or introduce one component that owns it? A component would be a new layer every action passes, so it needs a reason beyond naming. | Nothing yet; decide before cross-application | unassigned | open |
| Q-05 | How are the server's layers enforced? D-13 covers `web/src/otto/` only. A test like `layers.test.ts` for `server/app/voice/` (`tools.py` and `app_config.py` must not import FastAPI or ADK transport code) would make D-19 checkable there. | Any server change that adds a module | unassigned | open |
| Q-06 | How does Otto appear in spatial or AR interfaces, given D-12 (one WebGL 2 shader, no 3D library)? Reuse the pure robot state (`robot/robot.ts`, gestures, movement) with a second renderer, or amend D-12? | Spatial / AR epic | unassigned | open |
| Q-07 | What consent and privacy rules apply to camera and screen input (multimodal, sign language, environmental intelligence)? D-17 lists what the page snapshot never reads. A video frame can't be filtered that way, so it needs its own rule: when capture runs, what is sent, what is never kept, and how the visitor sees that it is on (as with D-08). | Multimodal, sign language, environmental intelligence | unassigned | open |
| Q-08 | How are pages and commands allowed when they aren't known at build time? D-03 needs static `Literal`s. Cross-application work would need lists the page reports at runtime (as `show_target` does, D-14), which loses the build-time parity test. | Cross-application | unassigned | open |
