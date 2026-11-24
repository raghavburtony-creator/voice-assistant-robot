# Decisions

This file **wins over every other doc** where it states a decision. `D-xx` is a decision, `Q-xx` an open question or a conflict found between docs.

D-01 to D-12 record choices the kit already made before this log existed. Each one cites where it was stated or enforced.

## Rules for entries

- Take the next free number. Next free: **D-22**, **Q-09**. Before using one, check `main` and the open PRs for the same number. `server/tests/test_docs.py` fails if a number repeats, if this line is wrong, or if the index below misses an entry.
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
| D-20 | A running task survives a reload in the same tab, as ids only | tasks | current |
| D-21 | Camera and screen are sent only while the visitor shares them, as still frames, and never kept | privacy | current |
| Q-01 | Is the Gemini Live wire format right? | voice | open |
| Q-02 | Where does task state live, and for how long? | tasks | answered by D-20 |
| Q-03 | Who is the visitor, across sessions and interfaces? | privacy | open |
| Q-04 | Is runtime authority a chain, or one component? | architecture | open |
| Q-05 | How are the server's layers enforced? | layers | open |
| Q-06 | How does Otto appear in spatial or AR interfaces, given D-12? | robot | open |
| Q-07 | What consent and privacy rules apply to camera and screen input? | privacy | answered by D-21 |
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

This applies to every camera, screen or surroundings input: multimodal input, sign language and environmental intelligence.

**Decision:**
- **When.** Capture is off by default. It starts only when the visitor presses a Share camera or Share screen control in Otto's panel, during an open conversation, after the mic consent card (`consent.ts`) has been answered. Every share is a new press. Nothing remembers a "yes", so a reload or a new conversation starts with nothing shared. No model tool starts, asks for or widens capture. The model may only suggest it in words, and the visitor presses.
- **What the visitor is told.** Before the browser's own prompt, the panel says what is sent, to whom and that nothing is kept: "Otto sends still pictures of your camera to Google while this is on. Nothing is saved." For the screen: "…of the screen you pick…". While it runs, the panel shows "Camera on" or "Sharing your screen" with a Stop button, as text the whole time (D-06, as with D-08's banner). The browser's own indicator stays.
- **What is sent.** Still JPEG frames, at most 1 per second and at most 768 px on the long side, only while the conversation is open and the tab is visible. Never video files or audio from the screen, and nothing before the press or after Stop. Frames go through the existing session: the WebSocket, then the bridge, then `LiveRequestQueue.send_realtime` as an `image/jpeg` blob, which ADK 2.13 forwards to Gemini Live as video input. They don't open a second channel to the model (D-19). The server checks type, size and rate again and drops what is over the limit, because the browser is not trusted either.
- **What is kept.** Nothing, by the kit. No frame is written to storage, disk, logs, error reports or the lab's recorded context. The server forwards a frame and drops it. What Google keeps of what it receives is under the host's agreement with Google, the same as voice. The panel says the pictures go to Google, and the kit claims nothing beyond that.
- **When it stops.** At Stop, when the conversation ends, the session cap (D-04), the tab being hidden, the browser's own Stop sharing, or a lost track. Otto stops the tracks and frees the canvas. It never restarts by itself: sharing again takes a new press.
- **Sensitive content.** The screen picker asks for the current tab first. When the shared surface is Otto's own tab, every region D-17 never reads (`[data-otto-private]`, Otto's panel, password, hidden and `cc-*` fields) is painted over before the frame is encoded. When the visitor picks another tab, window or screen, the kit can't see inside it. The panel then says so plainly: "Otto sees everything in this window." It doesn't claim a filter it can't apply. No camera filtering is claimed either. On the camera, what is in view is sent.
- **Frames are data.** What a frame shows (text on screen, a sign) is not an instruction. It can't widen any tool, and actions still go through `tools.py` and `toAssistantAction` (D-02).
- **No ambient capture.** Nothing captures outside a conversation, in the background, or on a wake word. Always-on environmental sensing would need a new decision.
- **Layers (D-13).** When capture may run, the frame limits and when it must stop are a core rule with a test. `getUserMedia`, `getDisplayMedia`, the canvas and the masking are shell. `<otto-mascot>` doesn't capture, since it has no consent panel. A host that wants capture uses `<Otto>`.

**Why:**
- A frame can't be filtered field by field like the page snapshot (D-17). So the rule moves to the edges: when capture runs, how much is sent, and that nothing is kept. Each visitor press is the consent.
- Stills at a low rate match how the Live API consumes video input, and they keep cost and size bounded (D-04). They also give the server a limit it can check.
- Remembering a "yes" would turn the camera on in a later visit that the visitor didn't expect. Remembering the mic choice is fine because the mic needs a press to talk anyway.
- Masking works only where the kit can see the layout, which is its own tab. Saying "Otto sees everything" elsewhere is honest. A filter that silently fails would not be.
- Stopping when the tab is hidden matches the guide's own rule for hidden tabs. And it means a share left running in a background tab doesn't keep sending.

**Where:** The rules are `captureStop`, `frameDue` and `frameSize` in `web/src/otto/capture.ts` (in `CORE`, tested in `capture.test.ts`). The browser's sender is `sendCapture` and `sendFrame` in `web/src/otto/useVoiceAssistant.ts`. The server's checks are `Bridge.send_frame` in `server/app/voice/bridge.py` (with `save_live_blob=False`), tested in `server/tests/test_voice.py`. The share controls, notice and masking are still to come (#37, #38). The ADK path is `send_realtime` in `google/adk/agents/live_request_queue.py` and `send_realtime_input(video=…)` in `google/adk/models/gemini_llm_connection.py` (pinned `google-adk==2.13.0`). Whether the live endpoint accepts those frame sizes and that rate is unverified until Q-01 is answered, so the first task marks it `[verify]`.

## Open questions

| ID | Question | Blocks | Owner | Status |
|---|---|---|---|---|
| Q-01 | Is the Gemini Live wire format in `web/src/otto/gemini/transports.ts` right, and is it the right boundary? Every `[verify]` item there (the ephemeral-token endpoint, the model id, message field names, audio formats, the setup message) has to be checked against a real Live endpoint and the pinned `google-genai`. The answer also says whether Otto's voice contract stays apart from Gemini (Otto's contract, then a provider adapter, then Gemini Live) or whether Gemini's protocol leaks past the adapter. It covers the audio lifecycle, interruption and barge-in, tool calls, the session lifecycle and reconnection, and what replacing the provider would touch. | `otto-mascot/gemini` in production; a second voice provider | unassigned | open |
| Q-02 | Where does task state live, and for how long? Today a guided task lives in the browser's memory (`createOttoGuide`): a reload ends it, and the server keeps nothing after a session (`InMemorySessionService`, deleted on close). Options: memory only; `sessionStorage` (survives a reload in this tab); `localStorage` (survives closing the tab); on the server. Each step out widens what is stored about the visitor (D-17). | Task continuity (reload, new session); investigated in #16 | unassigned | answered by D-20 |
| Q-03 | Who is the visitor, across sessions and interfaces? The server uses one fixed `USER_ID = "visitor"` (`bridge.py`). Continuity across devices or apps needs an identity the kit doesn't have. Proposed direction: the host supplies the identity and the kit never invents one; the kit applies the consent and retention rules to what it keeps under it. The answer says what may be kept and for how long, how the visitor agrees and withdraws, and that nothing is kept without a host identity. | Task continuity across interfaces, cross-application memory | unassigned | open |
| Q-04 | Is the authority chain in architecture.md (the model proposes, the server checks in `tools.py`, the browser checks in `toAssistantAction`, the host executes, Otto decides how) enough, or is one authoritative component needed? Issue #6 calls it an "orchestrator", but no such module exists (D-19). A component would be a new layer every action passes, so it is added only if the answer finds an authority the chain can't express. | Nothing yet; decide before cross-application or model-proposed reactions | unassigned | open |
| Q-05 | Does the server have a boundary worth enforcing the way `layers.test.ts` enforces D-13 in `web/src/otto/`? A candidate: `tools.py` and `app_config.py` as pure rules that must not import FastAPI or ADK transport code, with `route.py` and `bridge.py` as the shell. The answer first shows the boundary is real in `server/app/voice/`, then says whether a test should check it; copying the web test is not a reason on its own. | Any server change that adds a module | unassigned | open |
| Q-06 | How does Otto appear in spatial or AR interfaces, given D-12 (one WebGL 2 shader, no 3D library)? Options: (A) extend the shader; (B) a second renderer driven by the pure robot state (`robot/robot.ts`, gestures, movement); (C) amend D-12; (D) keep the renderer and add a separate spatial presentation layer around it. It stays open until the AR requirements and the shader's limits are known. | Spatial / AR epic | unassigned | open |
| Q-07 | What consent, privacy, retention and data-minimisation rules apply to camera frames, screen content and environmental context (multimodal, sign language, environmental intelligence)? D-17 lists what the page snapshot never reads, but a video frame can't be filtered that way, so it needs its own rule. The rule says: when capture is allowed (after which gesture and consent, as with D-05 and D-08); what the visitor is told and how they see that it is on; what is sent to the model, at what size and rate; what may be kept (nothing, by default); when capture stops (end of conversation, tab hidden, consent withdrawn); and how sensitive content is kept out. | Multimodal, sign language, environmental intelligence | unassigned | answered by D-21 |
| Q-08 | How are pages, commands and targets allowed when they aren't known at build time? D-03 needs static `Literal`s; `show_target` already accepts a list the page reports at runtime (D-14). The answer separates what may be discovered at runtime, what must still be registered explicitly, and what the server and browser check before Otto acts on it, so D-02, D-03 and D-14 still hold. Runtime lists lose the build-time parity test, so the answer says what replaces it. | Cross-application | unassigned | open |
