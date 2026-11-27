# Decisions

This file **wins over every other doc** where it states a decision. `D-xx` is a decision, `Q-xx` an open question or a conflict found between docs.

D-01 to D-12 record choices the kit already made before this log existed. Each one cites where it was stated or enforced.

## Rules for entries

- Take the next free number. Next free: **D-32**, **Q-11**. Before using one, check `main` and the open PRs for the same number. `server/tests/test_docs.py` fails if a number repeats, if this line is wrong, or if the index below misses an entry.
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
| D-03 | Pages and commands are listed in both configs | contracts | amended by D-23 |
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
| D-20 | A running task survives a reload in the same tab, as ids only | tasks | current |
| D-21 | Camera and screen are sent only while the visitor shares them, as still frames, and never kept | privacy | amended by D-31 |
| D-22 | Runtime authority is a chain of checks, not one component | architecture | current |
| D-23 | What the page may report at runtime, and what the deployment must register | contracts | current |
| D-24 | Desktop context is opt-in, metadata-only and limited to the active conversation | privacy | current |
| D-25 | Desktop actions require per-action approval and a closed native allow-list | security | current |
| D-26 | Continuity identity is supplied by the host; cross-session task state is opt-in and bounded | continuity, privacy | current |
| D-27 | The server voice layer is not a pure core/shell architecture | layers | current |
| D-28 | Defer spatial/AR renderer selection until a target is specified | robot, architecture | current |
| D-29 | Sign recognition uses a dedicated temporal adapter and text-only handoff | accessibility, privacy | current |
| D-30 | Environmental observations propose bounded checked awareness events | awareness, privacy | current |
| D-31 | Local hand control is independently consented and stays on the device | privacy, accessibility | current |

| Q-01 | Is the Gemini Live wire format right? | voice | open |
| Q-02 | Where does task state live, and for how long? | tasks | answered by D-20 |
| Q-03 | Who is the visitor, across sessions and interfaces? | privacy | answered by D-26 |
| Q-04 | Is runtime authority a chain, or one component? | architecture | answered by D-22 |
| Q-05 | How are the server's layers enforced? | layers | dropped |
| Q-06 | How does Otto appear in spatial or AR interfaces, given D-12? | robot | answered by D-28 |
| Q-07 | What consent and privacy rules apply to camera and screen input? | privacy | answered by D-21 |
| Q-08 | How are pages and commands allowed when they aren't known at build time? | contracts | answered by D-23 |
| Q-09 | Which sign language and community-validated task should the first sign-input pilot support? | accessibility, language | open |
| Q-10 | Environmental observations may propose bounded checked awareness events | awareness, privacy | answered by D-30 |

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

**Decision:** While Otto speaks, the browser sends no microphone audio. The page listens for a voice clearly louder than his echo (`BARGE_IN`), then sends what it held back. "Clearly louder" is judged against the room: a level above `BARGE_IN.level` and above `floorRatio` times a noise floor learned while Otto is silent, for `holdMs`. The open mic sends only a validated turn (`VAD`, `speechGate.ts`), so steady background noise is neither streamed nor read as speech.
**Why:** Browsers don't cancel Otto's echo reliably, so the model would hear itself.
**Where:** `BARGE_IN` and `VAD` in `web/src/otto.config.ts`, `web/src/otto/speechGate.ts`; README, "How it works". `BARGE_IN.level` still needs tuning on real hardware.

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
- **Core:** pure rules and data. No React, no packages, no browser globals, no app config, and imports only other core files. Today that is `movement/stage.ts`, `mouth.ts`, `robot/gestures.ts`, `robot/robot.ts`, `awareness/events.ts`, `awareness/reactions.ts`, `awareness/page.ts`, `guidance/guide.ts`, `guidance/task.ts`, `guidance/help.ts`, `guidance/friction.ts`, `gemini/channels.ts`, `gemini/prompt.ts`, `idle.ts`, `config.ts`, `gesture-control/gesture.ts` and `soundCues.ts`.
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
- Runtime authority is the chain in [architecture.md](architecture.md#who-decides-at-runtime) (D-22): the model proposes, the server checks, the browser checks, the host executes, Otto decides how. Engineering agents have no runtime or architectural authority. They work within this log. A person reviews their pull requests, except that the owner has authorised an agent to review and squash-merge a PR it opened for them under the gate in [AGENTS.md](../AGENTS.md#review-and-merge); decisions, answers to a `Q-xx` and edits to that gate stay with a person.

**Why:** The checks in D-02, D-14, D-16 and D-17 hold only if every path goes through them. A parallel system for a new capability would need the same checks again, and would drift from them. The owner set this rule in issue #6.
**Where:** [architecture.md](architecture.md); enforced by the existing tests for D-02, D-13 and D-17 (`server/tests/test_voice.py`, `web/src/otto/layers.test.ts`, `web/src/otto/messages.test.ts`, `web/src/otto/awareness/collectPage.test.ts`) and by review (AGENTS.md, "Review guidelines").

## D-20 A running task survives a reload in the same tab, as ids only

**Decision:**
- **Where.** The running guided task is kept in the tab's `sessionStorage`. It survives a reload or a page change in that tab, and goes when the tab closes. It is never kept in `localStorage`, and never sent to the server to keep: the server learns it again from the context channel (`guide_task_running`, D-19) when the next conversation opens, as it learns everything else.
- **What.** Only `{ task, step, savedAt }`: the task id, the current step's id (not its index), and when it was saved. Never the title, the step's words, a target's text or anything the visitor typed. The spec comes back from the page's own `registerGuideTask`.
- **How long.** It is written on every step and removed when the task is done or cancelled, whether by the visitor, the voice (`move_guided_task`) or the app. A saved task older than a fixed expiry (30 minutes, set in code, not a config key) is dropped instead of resumed.
- **How the visitor clears it.** Ending the task (its Stop, or telling Otto to stop) or closing the tab. No setting is added.
- **When the page changed.** On load, a saved task resumes only if the page registers a task with that id and that task still has that step id. Otherwise the saved entry is removed and nothing resumes: no guess at the nearest step, no restart from step 1.
- **Layers (D-13).** What to save, and whether a saved entry may resume (expiry, missing task, missing step), are a core rule beside `guidance/task.ts`, with a test. Reading and writing are shell, through `storage.ts`'s guarded access, which gains a session area beside the local one. A refused write keeps the value in memory for this visit, which is the same as not resuming.
- **`<otto-mascot>`.** It keeps tasks in memory only, since it never reads `otto.config.ts` (D-13), where the storage prefix is. A host that wants a mascot task to survive a reload starts it again itself with `guide.startTask` and `goTo`.

**Why:** A reload in the middle of a task is the common case (a link, a form post, a page that reloads itself), and ending the task there is the failure Q-02 names. The tab is the smallest place that covers it. `localStorage` would also resume a task days later, or for the next person on a shared computer. The server would need an identity the kit doesn't have (Q-03) and would keep visitor data after the session, which D-17 avoids. Ids alone are enough, because the page holds the spec, and they say nothing about the visitor beyond which help they were following. A step id still points at the right step when steps are added or reordered. A missing one means the task changed, and a wrong resume is worse than none.
**Where:** `savedTask`, `resumeFrom` and `SAVED_TASK_MAX_AGE_MS` in `web/src/otto/guidance/task.ts` (tested in `task.test.ts`); the `session` area in `web/src/otto/storage.ts`; the save on every task command and the resume one frame after mount in `web/src/otto/Otto.tsx` (key `<STORAGE_PREFIX>:guide-task`); e2e tests in `web/e2e/guidance.spec.ts` that reload in the middle of a task and drop a saved step the page no longer has.

## D-21 Camera and screen are sent only while the visitor shares them, as still frames, and never kept

This applies to every camera, screen or surroundings input except the separate local-only hand-control mode defined by D-31. It continues to govern multimodal input, sign language, environmental intelligence and any camera or screen frames sent to the voice session.

**Decision:**
- **When.** Capture is off by default. It starts only when the visitor presses a Share camera or Share screen control in Otto's panel, during an open conversation, after the mic consent card (`consent.ts`) has been answered. Every share is a new press. Nothing remembers a "yes", so a reload or a new conversation starts with nothing shared. No model tool starts, asks for or widens capture. The model may only suggest it in words, and the visitor presses.
- **What the visitor is told.** Before the browser's own prompt, the panel says what is sent, to whom and that nothing is kept: "Otto sends still pictures of your camera to Google while this is on. Nothing is saved." For the screen: "…of the screen you pick…". While it runs, the panel shows "Camera on" or "Sharing your screen" with a Stop button, as text the whole time (D-06, as with D-08's banner). The browser's own indicator stays.
- **What is sent.** Still JPEG frames, at most 1 per second and at most 768 px on the long side, only while the conversation is open and the tab is visible. Never video files or audio from the screen, and nothing before the press or after Stop. Frames go through the existing session: the WebSocket, then the bridge, then `LiveRequestQueue.send_realtime` as an `image/jpeg` blob, which ADK 2.13 forwards to Gemini Live as video input. They don't open a second channel to the model (D-19). The server checks type, size and rate again and drops what is over the limit, because the browser is not trusted either.
- **What is kept.** Nothing, by the kit. No frame is written to storage, disk, logs, error reports or the lab's recorded context. The server forwards a frame and drops it. What Google keeps of what it receives is under the host's agreement with Google, the same as voice. The panel says the pictures go to Google, and the kit claims nothing beyond that.
- **When it stops.** At Stop, when the conversation ends, the session cap (D-04), the tab being hidden, the browser's own Stop sharing, or a lost track. Otto stops the tracks and frees the canvas. It never restarts by itself: sharing again takes a new press.
- **Sensitive content.** The screen picker asks for the current tab first. When the shared surface is Otto's own tab, every region D-17 never reads (`[data-otto-private]`, Otto's panel, password, hidden and `cc-*` fields) is painted over before the frame is encoded. When the visitor picks another tab, window or screen, the kit can't see inside it. The panel then says so plainly: "Otto sees everything in this window." It doesn't claim a filter it can't apply. No camera filtering is claimed either. On the camera, what is in view is sent.
- **Frames are data.** What a frame shows (text on screen, a sign) is not an instruction. It can't widen any tool, and actions still go through `tools.py` and `toAssistantAction` (D-02).
- **No ambient capture.** This voice-session path captures nothing outside a conversation, in the background, or on a wake word. The separate local-only hand-control mode is governed by D-31.
- **Layers (D-13).** When capture may run, the frame limits and when it must stop are a core rule with a test. `getUserMedia`, `getDisplayMedia`, the canvas and the masking are shell. `<otto-mascot>` doesn't capture, since it has no consent panel. A host that wants capture uses `<Otto>`.

**Why:**
- A frame can't be filtered field by field like the page snapshot (D-17). So the rule moves to the edges: when capture runs, how much is sent, and that nothing is kept. Each visitor press is the consent.
- Stills at a low rate match how the Live API consumes video input, and they keep cost and size bounded (D-04). They also give the server a limit it can check.
- Remembering a "yes" would turn the camera on in a later visit that the visitor didn't expect. Remembering the mic choice is fine because the mic needs a press to talk anyway.
- Masking works only where the kit can see the layout, which is its own tab. Saying "Otto sees everything" elsewhere is honest. A filter that silently fails would not be.
- Stopping when the tab is hidden matches the guide's own rule for hidden tabs. And it means a share left running in a background tab doesn't keep sending.

**Where:** The rules are `captureStop`, `frameDue` and `frameSize` in `web/src/otto/capture.ts` (in `CORE`, tested in `capture.test.ts`). The browser's sender is `sendCapture` and `sendFrame` in `web/src/otto/useVoiceAssistant.ts`. The server's checks are `Bridge.send_frame` in `server/app/voice/bridge.py` (with `save_live_blob=False`), tested in `server/tests/test_voice.py`. The screen share (the notice, the indicator, the masking with `maskBoxes`, every stop path) is `web/src/otto/useScreenShare.ts` and `ScreenShare.tsx`, tested in `web/e2e/share.spec.ts`. The camera uses the same hook and component (`getUserMedia`, never masked), also tested there. The ADK path is `send_realtime` in `google/adk/agents/live_request_queue.py` and `send_realtime_input(video=…)` in `google/adk/models/gemini_llm_connection.py` (pinned `google-adk==2.13.0`). Whether the live endpoint accepts those frame sizes and that rate is unverified until Q-01 is answered, so the first task marks it `[verify]`.

## D-22 Runtime authority is a chain of checks, not one component
**Decision:**
- **No orchestrator.** Runtime authority is the chain in [architecture.md](architecture.md#who-decides-at-runtime): the model proposes, the server checks (`tools.py`), the browser checks again (`toAssistantAction`), the action is carried out, and Otto decides how (`planGuide`, the task machine). Each link can only narrow what the one before it allowed. No component sits over the chain, and the runtime has no "orchestrator". The `/otto-orchestrate` skill is engineering tooling with no runtime authority (D-19).
- **The visitor is above the chain.** Some acts are the visitor's alone, and no tool may do them, checked or not: answering the mic consent, turning on "Hey Otto" (D-08), starting a camera or screen share (D-21), starting local hand control (D-31), and pressing a card's follow-up (D-18). The visitor's Stop, Not now and the panel's undo win over anything the model proposed. Letting the model do one of these acts needs a new decision.
- **Only tool calls carry authority.** Nothing the model says (its speech or transcripts) is turned into an action, by the kit or by a host following the README. The same goes for what a frame or the page snapshot shows (D-17, D-21). The instruction shapes what the model says (D-18). The chain governs what it does.
- **Who carries an action out.** The host's `onAction` carries out page actions (`navigate`, `command`). Otto carries out his own actions: the guide for `guide`, `task` and `task_move`, the panel for `card`. Each is then passed to `onAction` as well. The host controls Otto's own actions upstream, through the targets and tasks it reports (D-14, D-16). A host that doesn't want a task started doesn't register it.
- **Limits live in a link.** A limit on how often or how much the model may do something is set per session. It sits in the server link (tool checks on session state, the sink's `MAX_QUEUED_ACTIONS`) or in Otto's judgement (the guide's cooldowns). A limit across sessions, tabs or apps needs an identity the kit doesn't have. That waits on Q-03 and Q-08, not on a new component.
- **Every action path has both checks (D-02).** `otto-mascot/gemini` has no action path: its proxy transport drops `action` messages, and its live transport declares no tools. The live transport has no server between the model and the browser, so it must not gain a tool that acts until a decision says what replaces the server's check.
- **Both ends name the same actions.** The action kinds the tools send equal the kinds `toAssistantAction` accepts, and a test checks it.

**Why:** Q-04 said to add a component only if some authority couldn't be expressed by the chain. Each planned capability was walked through the chain (the table in [architecture.md](architecture.md#who-decides-at-runtime)), and none needed one:
- Three apparent gaps were rules the code already followed but no record stated in one place. These were the acts reserved for the visitor (spread over D-08, D-18 and D-21), speech carrying no authority, and Otto carrying out his own actions.
- Limits wider than a session wait on an identity (Q-03, Q-08). A central component wouldn't have one either.

A single component couldn't replace the two checks, because they sit on two machines that don't trust each other (D-02). So it would be a third place to keep in step, with no check of its own to run. That is the parallel system D-19 rules out.
**Where:** [architecture.md](architecture.md#who-decides-at-runtime). The server checks are in `server/app/voice/policy.py`, `tool_registry.py`, `tools.py` and `sink.py`; the browser checks are in `web/src/otto/messages.ts`. Otto's own actions are carried out by `handleAction` in `web/src/otto/Otto.tsx`. The adapter drops actions at `web/src/otto/gemini/transports.ts`, tested in `bridge.test.ts`. The test `test_action_kinds_match_on_both_ends` and the policy tests are in `server/tests/test_voice.py`. The existing tests for D-02, D-08, D-18 and D-21 cover the rest.

## D-23 What the page may report at runtime, and what the deployment must register

This amends D-03. Commands stay as D-03 says. Pages may also be reported at runtime.

**Decision:**
- **The line is who authorises the act.** Some acts only show the visitor something or move them, and the visitor does any real step themselves. For these, the page's own report is enough authority. That covers pointing (`show_target`), guided tasks (`start_guided_task`) and moving to a page or view the page offers. Every other act changes the app's data or state, or can't be undone from the panel: a `run_command`, or any later tool that sends, buys, saves or deletes. For these, the deployment must register the act itself, because the page is not trusted to grant it.
- **What may be reported at runtime.** Targets, guided tasks and destinations (pages or views to move to). The page reports each under a context key through `publishContext` (D-19), as ids with page-data labels, inside the context budget. A destination is an id. The host maps it to a route in its own `onAction`. A URL or a route is never reported to the model or accepted from it (D-02). The app's own static pages (`PAGES`, D-03) stay as they are, and `explain_page` stays limited to them: its text is the deployment's, and a reported destination's label is page data.
- **What must be registered.** Commands. They stay static `Literal`s, listed in `app_config.py`, in `otto.config.ts` and in `tools.py`, and the parity test checks them (D-03). A deployment that serves several apps registers each app's commands on its server. No list from the page, from another app or from the model adds a command.
- **How a runtime list is checked.**
  - The server accepts an id only if it is in the list this session's page reported, and only if it fits the id rule below. The browser accepts it only if its own live registry still has it (`findGuideTarget`, `findGuideTask`). It does not trust the list it sent.
  - A list is valid only for the session and the page that reported it. It is never kept on the server after the session. An id from one app is never valid in another. A saved id is checked against the registry again before use (D-20).
  - The model can't add to a list. Labels, titles and descriptions are page data, not instructions (D-14, D-17).
- **The id rule.** A runtime id is 1 to 64 characters from `A-Z a-z 0-9 _ . : -`, starting with a letter or a digit. It has no spaces, so an id can't carry a sentence to the model. The page leaves out an entry whose id breaks the rule, and the server refuses it.
- **A list always fits its budget.** The browser caps how many entries it reports, so the whole list fits `MAX_CONTEXT_BYTES`. When the server refuses a context update, it clears that key instead of keeping the previous value. A stale list must never stay usable.
- **What replaces the parity test for runtime lists.** No build-time list exists to compare, so the tests check the contract instead:
  - each tool refuses an id outside the reported list (as the D-14 and D-16 tests do today);
  - the id rule is the same on both ends, checked the way `test_task_moves_match_the_web_kit` checks the moves;
  - the context keys and fields the server reads are the ones the browser publishes;
  - an over-budget list is capped in the browser and cleared on the server.

**Why:** A runtime list moves the authority to the page. The server can then only prove that the model didn't invent an id. It can't prove the host allows the act, since the browser isn't trusted either (D-21). That is enough when the worst case is Otto pointing at the wrong thing or opening a page the visitor can leave with one click. It is not enough for an act with consequences. So those stay where the deployment's owner, not the page, has listed them, and D-03's test keeps both ends equal.

The code at the time showed why the last two rules are needed (fixed in #61). `listGuideTargets` had no cap. A page with about 50 targets carrying full descriptions went over the 16 KB context limit. The server then dropped the update and kept the old list (`Bridge.update_context`), so `show_target` checked against a stale list. The browser's own registry check stopped a wrong pointer. But the model was told about targets that no longer existed, and was never told about the new ones.

**Where:** Today, the reported lists are `listGuideTargets` and `listGuideTasks` in `web/src/otto/guidance/targets.ts`, published in `web/src/otto/Otto.tsx`. The server checks are `show_target` and `start_guided_task` in `server/app/voice/tools.py`, and the context budget is `Bridge.update_context` in `bridge.py`. The browser checks are `toAssistantAction` in `web/src/otto/messages.ts`. The static lists are D-03's. The tests are `test_show_target_only_allows_reported_targets`, `test_start_guided_task_only_allows_reported_tasks` and the D-03 parity tests in `server/tests/test_voice.py`. The caps and the clearing of a refused key are `capList` and `MAX_CONTEXT_BYTES` in `web/src/otto/contextBudget.ts` and `context_bytes` and `update_context` in `bridge.py`, tested in `contextBudget.test.ts`, `test_a_refused_context_update_clears_the_key_and_never_keeps_a_stale_list` and `test_context_budget_and_measure_match_the_web_kit` (#61). The id rule is `RUNTIME_ID` in `web/src/otto/runtimeId.ts` and in `tools.py`, applied in `listGuideTargets`, `listGuideTasks`, `toAssistantAction`, `get_screen_context`, `show_target` and `start_guided_task`, and tested in `runtimeId.test.ts`, `test_runtime_id_rule_matches_the_web_kit` and `test_guide_tools_refuse_ids_that_break_the_rule_and_never_offer_them_back` (#62). Reported destinations (#63) are filed as a task citing this decision.

## D-24 Desktop context is opt-in, metadata-only and limited to the active conversation

**Decision:**
- Desktop awareness is off by default and is enabled only by a clearly labelled switch in Otto's voice panel. The choice is held in memory for the current conversation only and resets when the conversation ends.
- While enabled and a conversation is open, the native host may report the current monitor work area, Otto window position and visibility, cursor position, and (where the operating system permits) the foreground application's name and window title.
- The context is sampled at a bounded interval and published through the existing session context channel (D-19). The ADK orchestrator can read it only through get_desktop_context.
- No screenshots, application contents, keystrokes, process identifiers, executable paths or background activity history are collected or sent. Disabling the switch or ending the conversation clears the published context.
- The native host returns only a small typed metadata record. Platform-specific fields that cannot be obtained safely are reported as unavailable rather than guessed.

**Why:** Desktop awareness is useful for positioning and high-level context, but a desktop window title and cursor position can still reveal personal information. Explicit, visible, session-scoped consent keeps the capability bounded and revocable without adding a second observation pipeline.

**Where:** web/src/otto/VoiceAssistant.tsx (visible opt-in), web/src/otto/Otto.tsx (session lifecycle and context publication), web/src/otto/desktop.ts, web/src-tauri/src/lib.rs (native metadata boundary), server/app/voice/tools.py (get_desktop_context), and server/tests/test_voice.py.

## D-25 Desktop actions require per-action approval and a closed native allow-list

**Decision:**
- Desktop actions are proposed by the existing ADK tool layer and pass through the existing server sink and browser action validation. No second orchestrator or autonomous native decision-maker is introduced.
- The native Tauri command must ask the visitor to approve each exact action before execution. The approval prompt is enforced inside the native command, so a direct webview invocation cannot bypass it. Declining performs no action; approval is scoped to that one request.
- The native command accepts only a closed enum: minimize Otto, restore Otto, move Otto to one of five named positions, launch Calculator, or launch Text Editor. Unknown actions are rejected by native deserialization.
- Application launching uses fixed platform-specific application identifiers with no caller-provided executable, URL, path or arguments. No shell command, arbitrary application, filesystem operation, keystroke or general input automation is exposed.
- Results distinguish verified window state, movement accepted/completed by the native window API, and a process successfully spawned. A spawned process is not described as a verified, ready application window.

**Why:** Desktop actions can affect the visitor's environment. Server and browser allow-lists prevent model-generated arbitrary requests, per-action approval gives the visitor the final say, and native validation prevents an untrusted webview payload from widening the action set.

**Where:** `server/app/voice/tools.py` (`desktop_action`), `server/app/voice/app_config.py`, `web/src/otto/messages.ts`, `web/src-tauri/src/lib.rs` (native confirmation dialog), `web/src/otto/Otto.tsx` (result announcement), `web/src/otto/desktop.ts`, `web/src-tauri/src/lib.rs` (native enum and executor), and their tests.

## D-26 Continuity identity is supplied by the host; cross-session task state is opt-in and bounded

**Decision:**
- **Identity comes from the host.** The host supplies an opaque continuity identity to the server when it opens a session. The kit never derives, guesses or invents an identity from the visitor, browser, device, voice, camera or page. The transport and authentication of that identity are a host/deployment concern; the server accepts it only through that trusted integration boundary. The identity is never sent to the browser or model as conversational content.
- **Continuity is opt-in.** A host must explicitly enable cross-session continuity and tell the visitor that task state may be retained. With no host identity, or with continuity disabled, Otto keeps the D-20 same-tab behaviour only.
- **What is kept.** The first continuity slice stores only the minimum needed to resume one guided task: an app/host scope, task id, step id and saved time. It never stores task prose, target text, page snapshots, conversation transcripts, camera/screen frames or typed values. The current task specification still comes from the app that reports the task.
- **Retention.** An unfinished continuity record expires after 7 days, is removed when the task is completed or cancelled, and is deleted when the visitor withdraws continuity. A new task replaces the previous running-task record rather than creating an unbounded history. Expired or malformed records are ignored.
- **Scope.** A record is valid only for the host/app scope that created it. Cross-device and cross-session resume therefore means the same host can recognise the same opaque identity; it does not grant Otto a global identity or allow one app to read another app's state.
- **Visitor control.** The host owns the visitor-facing consent and clear controls. The kit provides the continuity state and must make withdrawal/deletion take effect for subsequent resumes; it must not silently re-enable retention after withdrawal.
- **Storage.** The persistent store is a host-selected server-side adapter behind the existing voice/session boundary. InMemorySessionService remains the live ADK session store, not the continuity store. The first implementation must keep the storage interface narrow so another backend can replace it without changing the guide or ADK orchestration.

**Why:** Q-03 is about who can safely connect two sessions, not about inventing a new runtime authority. A host already owns the application identity and its authentication boundary. Keeping the identity opaque and the stored record to task ids/time limits what continuity adds to the privacy surface. Seven days is long enough to resume an interrupted task on another device without turning the kit into a general visitor-memory system. No identity means no cross-session retention, preserving D-20's safer default.

**Where:** The host-to-server session integration will carry the opaque identity; the continuity record will live behind a small server-side store used by the existing task/context path. web/src/otto/guidance/task.ts remains the source of the resume shape and validation rules, while the server persists only the bounded ids/time. docs/architecture.md and docs/roadmap.md define the capability boundary; implementation issues under #8 must cite D-26.


## D-27 The server voice layer is not a pure core/shell architecture

**Decision:** Q-05 is dropped. The proposed boundary does not exist in the server in the form the question assumed, so there is no meaningful equivalent of the web kit's two-layer import test to add now. `server/app/voice/tools.py` is an ADK tool adapter: it imports `FunctionTool` and `ToolContext` from `google.adk.tools` and combines tool registration, argument checks and calls into the session sink. `app_config.py` holds host-specific pages, commands and prompt configuration; it is not a pure rules layer. `route.py` and `bridge.py` are FastAPI/WebSocket and ADK session adapters. Some provider-independent rules have already been extracted into small modules such as `events.py`, `continuity.py`, `perception.py`, `runtime.py`, `context.py` and `avatar.py`, but the server does not define or enforce a comprehensive core/shell boundary around them.

**Why:** A test that merely copies the web layer check would assert an architecture the server does not currently have. Treating the ADK-facing tool module as pure would be misleading, and introducing a broad refactor solely to answer this question would add scope without a demonstrated need. If a future change creates a stable pure server core, it should define that boundary explicitly and add focused import tests with it.

**Where:** `server/app/voice/tools.py` (ADK imports and tool definitions), `app_config.py` (host configuration), `route.py` and `bridge.py` (transport/session boundary), and the extracted provider-independent modules listed above. Q-05 remains in the open-question history with status `dropped by D-27`.


## D-28 Defer spatial/AR renderer selection until a target is specified

**Decision:** Q-06 is answered by deferring a renderer choice, not by selecting one of its proposed implementation options. D-12 remains current: the supported web mascot continues to use its single WebGL 2 shader and does not acquire a 3D library or a second renderer as part of the current product. The project has not specified a concrete spatial/AR target, such as a required device class, browser/runtime, interaction model, placement/occlusion needs, or minimum capability set. Until a product issue defines those requirements, Otto will not add a spatial renderer or commit to extending the existing shader. When a target is defined, evaluate a separate presentation adapter that consumes the existing renderer-independent robot and gesture rules before considering changes to the web renderer. The existing robot state and gesture modules remain the reusable source of behaviour; a spatial presentation must not create a second robot state machine.

**Why:** "Spatial/AR" alone does not identify a rendering environment or its constraints. WebXR-capable mobile browsers, headset runtimes and platform-native AR have materially different support, input, tracking, deployment and rendering requirements. Choosing a renderer now would guess at those constraints and risk either weakening D-12 or building an unused abstraction. The code already has a useful seam: `robot.ts` and `gestures.ts` hold renderer-independent expression and gesture data, while `ClayScene.tsx` adapts that data to the Clay Robot's `ClayControl` and WebGL implementation. A future target can use that seam without making the web renderer responsible for spatial presentation.

**Where:** D-12; `web/src/otto/robot/robot.ts` (expressions and face data); `web/src/otto/robot/gestures.ts` (pure gesture definitions/controller); `web/src/otto/robot/ClayScene.tsx` (current React/WebGL presentation adapter); `web/src/components/originkit/ui/clay-robot.tsx` (single WebGL 2 renderer); and issue #12, which must be refined with a named target and user-facing requirements before implementation. Q-06 is answered by D-28; this decision does not claim that spatial/AR support has shipped.

## D-29 Sign recognition uses a dedicated temporal adapter and text-only handoff

**Decision:**
- **Do not use the existing D-21 still-frame feed as the sign recognizer.** The current camera path deliberately sends at most one 768-pixel still per 1,100 ms to Gemini Live. That is a useful visual-context path, not a validated continuous sign-language input path. Sign recognition depends on motion over time and may also depend on hand shape, body position and non-manual signals. A one-frame-per-second feed cannot be assumed to preserve those features.
- **Keep recognition provider-neutral.** Sign recognition belongs behind a dedicated adapter that can consume a bounded, visitor-started temporal capture and return typed recognition updates. The adapter may be local or remote; provider/model selection remains out of scope until the language and dataset requirements in Q-09 are resolved and candidate evidence is evaluated.
- **Reuse the existing conversation and presentation paths.** Recognition results enter Otto as ordinary, clearly identified text input through the existing voice/session boundary. They do not create a parallel conversation, event bus, tool path or runtime authority. Otto's replies remain in the existing panel text channel (D-06, D-18, D-19).
- **Treat recognition as uncertain input, not authority.** The adapter reports partial, final and unrecognized/unsupported outcomes. It must not silently turn uncertainty into fluent text. The panel distinguishes provisional from final text and gives the visitor a way to correct, confirm or discard a result. A recognition result never invokes an action; any resulting action still passes through D-02 and D-22.
- **Consent is specific to this mode and destination.** D-21's existing camera-share notice authorises still frames to Google for visual context; it does not authorise a higher-rate temporal stream or a different recognition provider. Sign mode needs its own visitor-initiated, plain-language notice naming what is captured, the configured recipient, whether processing is local or remote, the capture limits and the no-retention rule. A persistent visible indicator and a visitor-controlled Stop are required. No automatic restart or remembered sign-capture consent.
- **No raw-video retention by Otto.** The capture buffer is bounded in memory and discarded on Stop, conversation end, hidden-tab stop, failure or session limit. No raw frames or clips enter logs, analytics, continuity storage, browser storage or the lab. A provider's handling must be disclosed and verified before it is enabled; the kit must not claim provider-side deletion or non-retention without evidence.

**Why:** The current camera path is explicitly designed for sparse visual context and Gemini Live's documented video input is one frame per second. Sign-language recognition is a temporal language task, not a generic image-description prompt. Keeping a provider-neutral temporal adapter separate from the existing still-frame path avoids promising unsupported recognition, while the text-only handoff preserves Otto's existing conversation, accessibility and authority boundaries. The language, task and data requirements must be established with the signing community before choosing a model.

**Options considered:**

| Approach | Advantages | Constraints and decision |
|---|---|---|
| Browser/local inference | Raw frames can remain on the visitor's device; avoids uploading a video stream to a recognition service. | Requires a suitable language-specific model, browser-compatible runtime and sufficient device compute. No MSL model/runtime has been validated; keep as a candidate, not a selection. |
| Otto-hosted server inference | One controlled model/runtime and consistent deployment; can reuse the existing authenticated session boundary. | Sends temporal frames to Otto's server, adding bandwidth, inference cost, access-control and operational responsibilities. Requires a separate explicit notice and strict ephemeral processing. |
| Managed recognition API | Less model-serving infrastructure and potentially simpler scaling. | No verified MSL continuous-recognition support was established. Provider retention, training use, region, subprocessors and contractual terms must be checked before any frames are sent. |
| Existing Gemini Live visual-context feed | Reuses the current D-21 camera-share path. | At most 1 FPS in this implementation and documented Live API path; not a suitable temporal sign-recognition contract. Rejected for sign recognition. |

No provider is selected. Q-09 must establish the language, pilot task, community validation and lawful dataset before a meaningful model comparison or benchmark can be made.

**Evidence reviewed:**
- [Gemini Live API – send audio and video streams](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api/send-audio-video-streams): documents discrete video frames at 1 FPS. This is provider documentation for the Live API, not a claim that it performs sign-language recognition.
- [A comprehensive survey on recent advances and challenges in sign language recognition systems](https://link.springer.com/article/10.1007/s44163-025-00629-7): describes the importance of hand movement, facial/non-manual signals and temporal context, and the generalisation limits of controlled, signer-dependent evaluations.
- [Official Mauritian Sign Language online dictionary](https://swdmauritius.signsdiscovery.com/) and [INJS project history for the Mauritian Sign Language dictionary](https://www.injs-paris.fr/page/expertises-et-projets/cooperations-internationales/projet-de-developpement-de-la-langue-des-signes-mauricienne/): establish relevant MSL linguistic/community resources; they do not, by themselves, establish a licensed continuous-video ML training corpus.


**Where:** Existing capture limits and lifecycle: `web/src/otto/capture.ts`, `useScreenShare.ts`, `ScreenShare.tsx`, `useVoiceAssistant.ts` and `server/app/voice/bridge.py` (D-21). Existing text/session path: `useVoiceAssistant.ts`, `messages.ts`, `bridge.py` and the panel transcript in `VoiceAssistant.tsx`. The sign adapter and its tests are to be added by the SIG-02 implementation issue. Slice shipped, no model selected: the adapter boundary (`web/src/otto/sign/`) and a lab-only fake recognizer.

## D-30 Environmental observations may propose bounded awareness events through the checked pipeline

**Decision:**
- **Allow visitor-shared camera observations to propose an awareness event.** While the visitor has explicitly started camera sharing for the active voice session, the model may use a dedicated, narrow tool to propose that Otto pay attention to a notable environmental observation. The model's visual interpretation remains untrusted and uncertain; it is a proposal, not a fact or an instruction.
- **Use one event vocabulary and one event bus.** The first implementation maps an accepted proposal to the existing `attention` event through `createOttoEvents`. It does not create a new event type, bus, conversation, or reaction engine. The first slice must not accept `success`, `failure`, `permission`, `task`, `express`, movement, navigation, guidance, or arbitrary host actions as environmental proposals.
- **Keep the proposal narrow and location-free.** The tool accepts only a closed, documented topic/category allow-list and a short plain-text explanation. It cannot provide a DOM selector, coordinates, `where`, `help`, arbitrary `data`, URLs, or an action target. Text is length-capped and stripped of control characters; the browser drops unknown fields and values. The first slice does not infer identity, face, emotion, health, protected or other sensitive traits.
- **Preserve every authority check.** The model calls the dedicated tool; the server validates the schema, active session, current camera-share state and per-session rate/duplicate limits; the browser independently validates the event and confirms camera sharing is still active; only then may the host dispatch the mapped `attention` event to `createOttoEvents`. Otto's existing reaction rules, cooldowns, repeat suppression, hidden-tab behaviour and host configuration decide whether and how to react. A proposal can never directly invoke a page, desktop, navigation, guidance or other action.
- **Camera consent remains visitor-owned.** The visitor must start camera sharing through the existing D-21 flow, see the active indicator and retain the Stop control. The model cannot start, restart, widen or prolong capture. Proposals are accepted only during that active share and voice session; Stop, session end, hidden-tab stop, disconnect or consent withdrawal invalidates pending proposals. Screen sharing alone does not enable environmental proposals in this first slice.
- **Bound uncertainty and failure.** The tool may abstain; malformed, unsupported, low-confidence, stale, duplicate, over-rate, cross-session or post-Stop proposals are dropped without reaction. No queued proposal survives a session or share lifecycle boundary. No frames, crops, embeddings or model reasoning are retained by this feature or written to logs, analytics, browser storage or continuity state. A provider's own handling remains subject to the disclosures and terms already required by D-21.
- **No speech shortcut.** Spoken output, transcripts and free-form model text never create an awareness event. Only the validated tool proposal can enter this path.

**Why:** E5 needs a way to let visitor-authorised visual context influence Otto's existing awareness system, but the model's description of a frame cannot itself become authority. A dedicated proposal with a closed event mapping preserves D-22's checks, D-19's single pipeline, D-21's visitor-controlled capture and D-18's existing presentation channels. Restricting the first slice to a location-free `attention` event prevents visual observations from being converted into arbitrary actions or high-impact app outcomes.

**First implementation slice:** Add a provider-neutral environmental proposal contract and deterministic fake adapter; expose one camera-session-scoped tool that emits only the bounded proposal; validate it server-side and again in the browser; map accepted proposals to `events.notify({ type: 'attention', topic, message, importance: 'minor' })`; add rate, duplicate, lifecycle, malformed-input and cross-session tests. No new model, provider, capture rate, raw-frame buffer, event bus or action is part of this slice. The exact topic allow-list and confidence representation must be declared in the contract and tested; unknown categories abstain.

**Where:** D-02, D-18, D-19, D-21 and D-22; `web/src/otto/awareness/events.ts` and `reactions.ts`; `web/src/otto/awareness/avatar.ts` and `messages.ts` for browser-side validation patterns; `server/app/voice/tools.py`, `sink.py` and `bridge.py` for the checked server path; `web/src/otto/useVoiceAssistant.ts` and `useScreenShare.ts` for the camera-share lifecycle; and the new environmental proposal contract and tests. Q-10 is answered by D-30. This decision authorises a bounded proposal path; it does not claim that environmental recognition has shipped.

## D-31 Local hand control is independently consented and stays on the device

**Decision:**
- **Separate permission.** Hand control is independent of a voice session and microphone consent. It starts only when the visitor presses **Start hand control** in the panel; only then does the browser request camera access. Permission is not remembered, and nothing starts on page load, panel open, wake word or model request.
- **Visible lifecycle.** While active, the panel shows a local camera preview, an active status and Stop. Stop, panel close/unmount, tab hidden, camera track end or processing failure stops capture, cancels the frame loop, closes the MediaPipe task and releases camera tracks. It never restarts automatically.
- **Local processing and disclosure.** Frames, landmarks, pointer coordinates and gesture history stay in transient browser memory. They are processed in the browser and never sent to the Otto server, Gemini, page context, voice WebSocket, a tool, a log or storage. The pinned MediaPipe Tasks Vision runtime/WASM and hand model are downloaded from jsDelivr and Google when needed. Its privacy notice says input images are processed on-device and not sent to Google, while the SDK sends performance/utilization metrics to Google; the panel must disclose and link to this notice.
- **Narrow first gesture.** This slice tracks one hand. A navigation swipe requires an index-pointing pose held steady before movement, sufficient horizontal travel and speed, consistent direction, a cooldown and a new neutral/rest period before another swipe. No hand or multiple hands produces no action. Open-palm waving is not a navigation pose.
- **Host-owned navigation.** The only action is a left/right request to navigate to the adjacent entry in an ordered list supplied by the host. Each destination has a runtime-safe id and plain-text label; no URL, path, selector or model-provided destination is accepted. The host maps the id to its own route. This visitor input is not a model/tool action and does not add a second voice, event or action channel (D-19, D-22).
- **No general computer control.** This decision does not authorize DOM clicking, scrolling, keyboard injection, arbitrary window operations or operating-system application switching. D-25's native allow-list and per-action approval remain unchanged. Any later extension of gesture authority needs its own reviewed scope and decision.

**Why:** Visitors should be able to navigate without speaking, but D-21's voice camera path is tied to an open conversation and sends still images to Gemini. A separate camera grant and local-only data boundary let hand navigation work independently without weakening voice-session consent, adding another model-action path or granting broad computer access.

**Where:** Pure hand geometry, host destination validation and swipe rules are in `web/src/otto/gesture-control/gesture.ts`, with `gesture.test.ts`. The camera/MediaPipe lifecycle is in `useGestureControl.ts`; the visible controls and privacy notice are in `GestureControl.tsx`. `Otto.tsx` and `VoiceAssistant.tsx` mount the mode; the host supplies the allow-list and route callback in `App.tsx`. D-21 continues to govern any camera/screen frames shared with the voice session.

## Open questions

| ID | Question | Blocks | Owner | Status |
|---|---|---|---|---|
| Q-01 | Is the Gemini Live wire format in `web/src/otto/gemini/transports.ts` right, and is it the right boundary? Every `[verify]` item there (the ephemeral-token endpoint, the model id, message field names, audio formats, the setup message) has to be checked against a real Live endpoint and the pinned `google-genai`. The answer also says whether Otto's voice contract stays apart from Gemini (Otto's contract, then a provider adapter, then Gemini Live) or whether Gemini's protocol leaks past the adapter. It covers the audio lifecycle, interruption and barge-in, tool calls, the session lifecycle and reconnection, and what replacing the provider would touch. | `otto-mascot/gemini` in production; a second voice provider | unassigned | open |
| Q-02 | Where does task state live, and for how long? Today a guided task lives in the browser's memory (`createOttoGuide`): a reload ends it, and the server keeps nothing after a session (`InMemorySessionService`, deleted on close). Options: memory only; `sessionStorage` (survives a reload in this tab); `localStorage` (survives closing the tab); on the server. Each step out widens what is stored about the visitor (D-17). | Task continuity (reload, new session); investigated in #16 | unassigned | answered by D-20 |
| Q-03 | Who is the visitor, across sessions and interfaces? The server uses one fixed `USER_ID = "visitor"` (`bridge.py`). Continuity across devices or apps needs an identity the kit doesn't have. Proposed direction: the host supplies the identity and the kit never invents one; the kit applies the consent and retention rules to what it keeps under it. The answer says what may be kept and for how long, how the visitor agrees and withdraws, and that nothing is kept without a host identity. | Task continuity across interfaces, cross-application memory | unassigned | answered by D-26 |
| Q-04 | Is the authority chain in architecture.md (the model proposes, the server checks in `tools.py`, the browser checks in `toAssistantAction`, the host executes, Otto decides how) enough, or is one authoritative component needed? Issue #6 calls it an "orchestrator", but no such module exists (D-19). A component would be a new layer every action passes, so it is added only if the answer finds an authority the chain can't express. | Nothing yet; decide before cross-application or model-proposed reactions | unassigned | answered by D-22 |
| Q-05 | Does the server have a boundary worth enforcing the way `layers.test.ts` enforces D-13 in `web/src/otto/`? A candidate: `tools.py` and `app_config.py` as pure rules that must not import FastAPI or ADK transport code, with `route.py` and `bridge.py` as the shell. The answer first shows the boundary is real in `server/app/voice/`, then says whether a test should check it; copying the web test is not a reason on its own. | Any server change that adds a module | unassigned | dropped |
| Q-06 | How does Otto appear in spatial or AR interfaces, given D-12 (one WebGL 2 shader, no 3D library)? D-28 answers this by deferring renderer selection until a target device/runtime and concrete rendering and interaction requirements are specified; issue #12 is the place to define them before implementation. | Spatial / AR epic | unassigned | answered by D-28 |
| Q-07 | What consent, privacy, retention and data-minimisation rules apply to camera frames, screen content and environmental context (multimodal, sign language, environmental intelligence)? D-17 lists what the page snapshot never reads, but a video frame can't be filtered that way, so it needs its own rule. The rule says: when capture is allowed (after which gesture and consent, as with D-05 and D-08); what the visitor is told and how they see that it is on; what is sent to the model, at what size and rate; what may be kept (nothing, by default); when capture stops (end of conversation, tab hidden, consent withdrawn); and how sensitive content is kept out. | Multimodal, sign language, environmental intelligence | unassigned | answered by D-21 |
| Q-08 | How are pages, commands and targets allowed when they aren't known at build time? D-03 needs static `Literal`s; `show_target` already accepts a list the page reports at runtime (D-14). The answer separates what may be discovered at runtime, what must still be registered explicitly, and what the server and browser check before Otto acts on it, so D-02, D-03 and D-14 still hold. Runtime lists lose the build-time parity test, so the answer says what replaces it. | Cross-application | unassigned | answered by D-23 |
| Q-09 | Which sign language and community-validated task should the first sign-input pilot support? Confirm the language with Deaf/signing community partners; define whether the first pilot is a small, bounded vocabulary or continuous conversational signing; identify an appropriate consented dataset or a community-governed collection plan; and agree who validates annotations and signer-independent evaluation. Do not infer the language from deployment geography or treat a dictionary as a video training corpus. Note: the adapter slice shipped with no model selected; this stays open. | Sign-language recognition model and pilot scope | unassigned | open |
| Q-10 | How may visitor-shared environmental observations produce Otto awareness/reaction events without turning model observations or speech into authority, bypassing the checked action chain, or introducing ambient capture? Define the permitted proposer, event vocabulary, checks, consent/session boundary and failure behaviour. | Environmental-intelligence event/reaction path | project owner | answered by D-30 |


