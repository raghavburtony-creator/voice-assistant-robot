# Otto voice kit

A starter kit for adding **Otto**, a clay robot voice guide, to a web app. You talk to Otto (or type), it answers out loud with Gemini Live, and it can act on the page: open a page, run one of your app's commands, read what is on screen. Taken out of the NASA Earth Jukebox and made generic.

- **Robot**: Otto is Originkit's Clay Robot (`web/src/components/originkit/ui/clay-robot.tsx`), drawn by a WebGL 2 shader, with a mouth and a control hook added for the voice kit.
- **Web** (`web/`): React, TypeScript and Vite. The robot, the voice panel, "Hey Otto", consent, push-to-talk or open mic, a text fallback.
- **Server** (`server/`): FastAPI and Google ADK. It holds the Gemini session and the API key, and runs Otto's tools.

Where the project is going, and how to work on it: [docs/architecture.md](docs/architecture.md) (today's pipeline and the target), [docs/roadmap.md](docs/roadmap.md) (the epics), [docs/decisions.md](docs/decisions.md) (decisions and open questions, with an index), and [CONTRIBUTING.md](CONTRIBUTING.md) (issue templates, labels, milestones, and the path from issue to merged PR).

## Run it

You need Node.js 22 or newer, Python 3.11 or newer, and a Gemini API key (https://aistudio.google.com/apikey).

```bash
# Server, in one terminal
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env          # then set GEMINI_API_KEY
.venv/bin/uvicorn app.main:app --reload --port 8000

# Web, in another
cd web
npm install
npm run dev                   # http://localhost:5173
```

Click the robot, or press **Alt+O** (change it with `SHORTCUT_KEY` in `web/src/otto.config.ts`), and say "Take me to About" or "Show me a message".

To try the robot without a key or a server, open http://localhost:5173/lab.html. Otto stands along the bottom of the page there, as in an app, and you can test each part on its own:
- **Movement**: walk left, centre, right or home, to a target, away from it, turn toward it, look at it, follow a moving dot, stop mid-walk, and dodge a simulated panel. Speed and a reduced-motion snap are adjustable, and every departure and arrival is logged.
- **Idle and sleep**: skip ahead to idle or to sleep, or wake him. Short timeouts are on by default.
- **Body**: every pose, all seven faces and every gesture.
- **Mouth and sound**: the mouth from a fake voice or any audio file, with a meter of the five bands, and each sound cue.
- **Awareness and themes**: send any event at any importance and place, long tasks, floods of events; each decision is logged with why, next to what Otto knows now. Switch theme presets live.
- **A simulated voice session**: "Run a conversation" plays the lifecycle gestures through the same rules as the app.
- **The real Otto against a simulated Gemini server**: the panel, streamed synthetic speech through the real speech player, the bubble in step with the audio, and barge-in from either side.

Checks: `cd server && .venv/bin/python -m pytest`, `cd web && npm test` (the gesture engine and the lifecycle rules) and `cd web && npm run build`. Browser tests: `cd web && npm run test:e2e` (Playwright, Chromium, against the lab and the mascot; the first time, run `npx playwright install chromium`).

## Run Otto as a desktop companion

The desktop host is a Tauri v2 shell around the same React application. It does not create a second avatar or voice runtime: the existing Otto UI continues to connect to the FastAPI/Google ADK server.

Prerequisites: the web and server prerequisites above, Rust 1.90 or newer, and the native build tools required by Tauri for your operating system (for Windows, the Microsoft C++ Build Tools and WebView2; for macOS, Xcode Command Line Tools; for Linux, the Tauri system packages).

```bash
cd web
npm install
npm run desktop:dev
```

The first run downloads the Tauri CLI through `npx` and builds the Rust host. To create release bundles:

```bash
cd web
npm run desktop:build
```

For a packaged desktop build, set `VITE_API_URL` to the reachable Otto server origin before building (for example, `https://otto-api.example.com`). See [`docs/desktop.md`](docs/desktop.md) for native checks, CI packaging and troubleshooting. In development, Vite continues to proxy `/api` to the local server. The desktop window is transparent, frameless and always on top; it reuses the web app's React/robot implementation.

The native/web boundary stays intent-based:
- the webview may query read-only runtime information with `getDesktopStatus()`;
- the host announces `otto://desktop-ready` and `otto://desktop-page-loaded` lifecycle events;
- `onDesktopError()` remains the reserved native error subscription;
- `executeDesktopAction()` accepts only the closed native action set: minimize/restore Otto, move to one of five named positions, or launch Calculator/Text Editor;
- the native host calculates physical coordinates, clamps the window to the current monitor's work area and animates the transition;
- movement emits structured `started`, `completed` or `failed` events on `otto://desktop-movement`, available through `onDesktopMovement()`;
- the ADK `desktop_action` tool exposes the same fixed action set; `move_desktop` routes through it for compatibility;
- `getDesktopContext()` reports monitor work area, Otto's window position/visibility and cursor position; on Windows it also reports the foreground application's executable name and window title only.
- The voice panel has a session-only **Share desktop context with Otto** switch. Sampling runs only while a conversation is open and the switch is on, and stops immediately when disabled or the conversation ends. The same session permission gates desktop metadata reads and desktop actions; it is off again after a reload/restart, and disabling it does not persist a grant.
- No screenshots, application contents, keystrokes, process ids or executable paths are sent.
- the native Tauri command displays an operating-system confirmation for each exact action before execution; a direct webview invocation cannot skip approval, and the Rust host independently deserializes a closed action enum and rejects unknown variants;
- application launching is limited to Calculator and Text Editor, using fixed platform-specific executable/app identifiers and no caller-supplied arguments;
- results distinguish verified window state, native movement completion and process spawn; after a movement completes, the bridge takes a fresh metadata-only observation and reports success only when Otto's position matches the requested destination; a missing or mismatched observation is a verification failure. Launching a process is not reported as proof that its window is ready;
- no arbitrary shell, filesystem, input automation, arbitrary application, URL, path, argument or general window-control command is exposed.

The desktop-awareness boundary is opt-in and metadata-only: no context is sent to the ADK unless the visitor enables the switch in the panel. The switch resets at the end of each conversation. Active-window metadata is currently available on Windows; other platforms report it as unavailable.

The movement controller stays on the monitor Otto currently occupies; it uses that monitor's work area (including non-primary monitors with negative desktop origins) and does not silently jump Otto between displays. Browser mode remains unchanged: movement returns an explicit unavailable result when the Tauri runtime is absent.

## Using it in a new project

The two files you edit every time are the two config files. Their static page and command lists must match (a server test checks it).

What Otto only shows, walks the visitor through or opens for them (guide targets, guided tasks and destinations) can be reported by the page at runtime instead, as ids checked on both ends. Commands, which change something in your app, always stay in both config lists. The page can't add one (D-23).

| What | Web | Server |
|---|---|---|
| Otto's name, your pages, your commands | `web/src/otto.config.ts` | `server/app/voice/app_config.py` |
| What Otto knows and how it speaks | | `app_config.py`: `PAGES`, `FAQ`, `APP_DESCRIPTION`, `system_instruction()` |
| What Otto can do | `App.tsx` `onAction` | `server/app/voice/tools.py` |

In your app:

```tsx
import { useEffect } from 'react'
import { Otto, publishContext, useAssistantContext, type AssistantAction } from './otto'

// Routes stay in host code. Otto receives ids and labels, never these URLs.
const routes: Record<string, string> = {
  home: '/', features: '/features', about: '/about',
  'project.42': '/projects/42',
}

// Once, near the top of the app. `page` is the visitor's current page id.
<Otto page={page} onAction={(action: AssistantAction) => {
  if (action.action === 'navigate') {
    const route = routes[action.page]
    if (route) router.push(route) // keep `page` equal to action.page when that view is current
  } else if (action.action === 'command' && action.name === 'toggle_theme') toggleTheme()
}} />

// In any component: tell Otto what is on screen. It reads this with get_screen_context.
useAssistantContext('cart', { items: 3, total: 'Rs 450' })

// While this view is current, offer a runtime destination. Clear it when the view leaves.
useEffect(() => {
  publishContext('destinations', { destinations: [{ id: 'project.42', label: 'Project Forty Two' }] })
  return () => publishContext('destinations', null)
}, [])
```

A destination has only an `id` and a page-data `label`. Its id follows the shared runtime-id rule: 1 to 64 characters from `A-Z a-z 0-9 _ . : -`, beginning with a letter or digit. The kit caps the list to the context budget. `navigate_to` accepts a static page id or an id in the current `destinations` list; the browser checks the id against that live list again immediately before `onAction`. An old, unreported id, a URL and a path are refused. The host maps the accepted id to a route, as above; neither the model nor the reported context supplies a URL.

After the host opens a runtime view, it passes that destination id back as `<Otto page={page}>` for as long as the view is current (the example router derives `page` from its current route). On session start and every page change, the browser validates the value and sends `{ page, title }`: a runtime title uses the destination's capped, plain-text label when it is available, otherwise its id, while a static page title always comes from the deployment config. A URL, path or malformed host value is never sent as the page id; it falls back to the first static page, and the server validates the message again. `explain_page` remains limited to static pages because their explanatory text comes from the deployment.

Copy `web/src/otto/`, `web/src/otto.config.ts`, `web/public/otto/` and `server/app/voice/` into the new project, or start from this repository. Otto's colours are `ROBOT_COLORS` in `otto.config.ts`.

### Adding a tool

1. Write the checked function in `server/app/voice/tools.py` and add it to `TOOL_FUNCTIONS`. Check every argument: the model's output is untrusted. Add matching metadata in `server/app/voice/tool_registry.py` (family, description, JSON schemas derived from annotations, risk, permission, timeout, async and verification flags); the registry rejects missing or duplicate entries.
2. If it changes the page, return an action through `_send(...)`, for example `{"action": "command", "name": "open_cart"}`.
3. Allow that action in the browser: add the command to `COMMANDS` in both config files (and to the `Command` type in `tools.py`), or, for a new kind of action, add a variant to `AssistantAction` in `web/src/otto/messages.ts`, with its check in `toAssistantAction` and any new field in `messageSchema` (`move_guided_task` and its `task_move` action are a worked example).
4. Handle it in your `onAction`, and describe it so the panel's "Otto did" list says what happened: in `COMMAND_LABELS` for a command, or in `describeAction` (`useVoiceAssistant.ts`) for a new kind of action.
5. Tell Otto when to use it in `system_instruction()`.

The registry gateway applies a fail-closed, per-call policy decision from reviewed risk and permission metadata before dispatch. Desktop actions require desktop awareness and then explicit approval in the existing host UI; neither policy nor dispatch is consent. A bounded session-local audit stores the decision and outcome without raw arguments or user content. For high-risk desktop actions, the native host issues an exact-action consent certificate after its OS dialog; the browser reports that receipt and the final execution/verification status to the server. The server binds it to one pending request and rejects mismatched or replayed receipts. Revoking desktop awareness before the native prompt records a preflight cancellation without invoking the host. These browser-transported records are marked native-host-reported, not cryptographically attested.

A tool that only reads (a lookup, a calculation) needs only step 1 and step 5.

`ToolRegistry` is the single source for the ADK tool adapters. Its gateway validates arguments against the registered annotations before calling the existing checked function and returns a stable envelope: `status` (`success` or `error`), the original structured `data`, `evidence` (an empty list when none is supplied), `provenance`, `verification` (`required`, `status` and optional `details`), a safe `error` object or `null`, UTC `timestamps` (`started_at`, `completed_at`) and declared `side_effects`. Execution status is separate from verification: a queued or approval-requested action can be successful with verification `pending`; it is not proof that the effect happened. Execution failures use `not_run` when verification was required. Evidence is never inferred, and side-effect labels are declarations, not proof. The `policy` field records the request id, risk, required permission, decision and verification state. Denied requests never reach the checked function; high-risk desktop requests are dispatched only after desktop awareness is enabled and still require exact host approval. Exception diagnostics log only the tool name and exception class, while model-visible errors remain generic. The metadata records policy and execution requirements; it does not grant permissions or replace the server/browser/native checks (D-02, D-22). Current registered tools cover browser, computer, screen, camera and tasks. Files, web/research and memory remain unregistered until those capabilities have real implementations and explicit safety boundaries.

## Memory

The server includes an explicit, identity-scoped memory store (`server/app/voice/memory_service.py`). It is enabled for a session only when a trusted deployment proxy supplies the existing opt-in continuity identity. The raw identity is hashed and never placed in ADK state. When the visitor explicitly asks Otto to remember one fact or preference, Otto may propose a bounded, redacted entry in the panel. Nothing is written until the visitor presses Save; Not now discards it. Proposals expire after two minutes, are limited to three pending requests per session and can be confirmed only once. A confirmation for a proposal that has expired (and so was already dropped), or that never existed in the session, is answered `expired`, so the panel never waits for an answer that does not come. A repeat of one of the last 16 answered proposals stays silent, and the panel applies an answer only to a proposal that is still open, so a late answer cannot change a saved one. Confirmed writes carry visitor-approval provenance; redacted entries are marked sensitive and excluded from recall and model context by default. Working records are deleted from SQLite on service startup and before memory operations once they are older than 24 hours. Retrieved memory is bounded JSON treated as untrusted data. The service cannot trigger tools or user-facing actions.

## Task engine

`server/app/voice/tasks.py` (TASK-01, #49) runs long work beside the live voice session, so the voice loop never waits on it. The server hands it a *worker* (an async function) with `submit`, which returns at once with a task id or a refusal (`busy`, `closed`, `invalid`). Each session's `Bridge` owns one engine (`bridge.tasks`), and the route closes it when the session ends: every unfinished task is cancelled and awaited, so none outlives its session.

- **Lifecycle.** `created`, `queued`, `running`, `waiting`, `verifying`, then `completed`, `failed` or `cancelled`. `TRANSITIONS` is the only way a state changes. A worker reports `ctx.progress(0..1, note)` or `ctx.waiting(note)`; `engine.get(id)` and `snapshots()` return immutable copies.
- **Bounds (per session).** Four unfinished tasks (`MAX_ACTIVE`; a fifth is refused, never dropped silently), two running at once (`MAX_RUNNING`; the rest queue), 100 submitted in all (`MAX_SUBMITTED`; then `limit`), two retries (`MAX_RETRIES`, only for a `RetryableError`), a timeout of at most 300 seconds (per attempt, and again for the `verify` check), and the last 20 finished tasks kept (`MAX_KEPT`). A timeout is final and never retried.
- **Priority and preemption (RUNTIME-01, #56).** A task is `low`, `normal` (the default) or `high`. A free slot goes to the highest priority first, the oldest within a priority. Only a `high` task preempts: when the session is full it cancels one running, cancellable task of lower priority (the lowest, then the newest) with the reason `preempted`, and Otto is told "Stopped to make room.". A `normal` task waits its turn, and a task submitted `cancellable=False` or of equal priority is never pushed out. What counts as a critical event is for whoever submits the task; the engine only gives them the means.
- **Honest endings.** A task with a `verify` check is `completed` only when the check returns exactly `True`; anything else is `failed` ("verification_failed"). An exception's text is never stored or sent. Otto is told only a fixed sentence (`Something went wrong.`, `It took too long.`, `I could not confirm it worked.`, `Cancelled.`).
- **Cancel.** `engine.cancel(id)` stops a task now and starts the next queued one. A task submitted with `cancellable=False` (not safe to stop part-way) refuses the visitor; ending the session still stops it.
- **Telling Otto.** Through `Bridge.avatar`, the existing path: `working` when it starts, then `success` or `failure`, checked on both ends like any avatar event. No new message type, event bus or action route (D-19).
- **Telling the model.** Every step is also a typed `TaskEvent` (id, title, state, reason, progress, priority, whether it ever ran): never a worker's result or note. State, reason and priority are closed values; the title is the one free-text field (server-set plain text, at most 80 characters) and always reaches the model quoted and labelled as untrusted text. The bridge mirrors a checked list of them into session state for the read-only `get_background_tasks` tool, so "is it done yet?" is answered from status, not a guess. When a task that ran has ended, the bridge also tells the model once, in one fixed-format message built from those same fields, marked as a status and not an instruction or permission, the way it relays a desktop action's outcome. It sends one such message per task that ran, bounded only by `MAX_SUBMITTED`, so a producer that starts many tasks must coalesce them. A slot is held by a task's state, not its coroutine: a worker that ignores cancellation frees its slot at once but may run on until the session closes (bounded by `CLOSE_TIMEOUT`). A task that never ran, and anything after the session closes, tells nobody. The bridge's `close()` ends the session's tasks and drops any update not yet sent.
- **Not done yet.** Nothing submits a task today: there are no worker adapters, and the model has no tool to start or cancel one (D-02). How a worker's result reaches the visitor (a `show_card` card, D-18) and what a producer treats as a critical event are separate slices.

## Privacy

What the server may keep is listed in `DATA_CLASSES` in `server/app/voice/privacy.py` (the same table is in [docs/architecture.md](docs/architecture.md#privacy-and-lifecycle-invariants)). Four classes are persisted: memory records; metadata-only memory audit rows; continuity records (task id, step id and time); and a hashed continuity-withdrawal marker. Voice transcripts, screenshots, camera frames, files, tool arguments and tool results are not. `persist_allowed(name)` is false for those, and false for any name it does not know.

**Redaction.** Memory content and provenance pass through `redact_text` before they are written, on `remember` and `update`. It replaces email addresses (`[email]`), phone numbers in the `(555) 123-4567` or `+44 ...` shapes (`[phone]`), payment-card numbers that pass the Luhn check (`[card]`), and API keys, bearer tokens, `?api_key=` values, passwords inside URLs and "password is ..." phrasing (`[secret]`). A record that needed redaction is stored as `sensitive`, which recall and model context leave out by default, and `update` never lowers that. The audit table keeps the category names for a write (`audit_events` shows them as `redacted`), never the values. The same function also runs over the error text the voice route logs, after the Gemini key is removed.

**Not caught.** Cards or phones with unusual separators (zero-width characters, newlines, dots, double spaces); emails that are URL-encoded, base64 or spelled out ("jo at example.com"); non-ASCII local parts; short or all-letter tokens; PINs, SSNs, IBANs, IP addresses and dates of birth; PEM blocks; `Authorization: Basic` values. Classes the table marks "not stored" are never written, so redaction does not apply to them.

**What this does not do.** Pattern redaction is best-effort, not a guarantee. It does not find names, addresses, health details or any other free-form personal fact, and an unusual number format can slip through or an unrelated number can be hit. Do not rely on it to make a record safe to share. The rule that raw camera frames, screenshots and files are never persisted is a policy plus a test (`test_privacy.py` checks that no server module but the two stores can write to disk, and that a frame passes the gateway with every write blocked). It is not a technical impossibility: new code that writes a file would be a change to that policy.

**Forgetting a visitor.** `forget_identity` (`server/app/voice/forget.py`) is a plain function for the host's own server code. No tool, message or route reaches it, so the model cannot call it. Call it when your visitor asks to be forgotten:

```python
from app.voice.bridge import continuity_store, memory_service
from app.voice.forget import forget_identity

counts = forget_identity(memory_service, continuity_store, scope, identity, explicit=True)
# {"memory_records": 3, "continuity_records": 1}
```

It deletes every memory record for that scope and identity, writes one audit row with the action and the count, deletes the continuity record and disables continuity for that identity, as a withdrawal does (D-26). Continuity comes back only when the host next opens a session with that identity enabled. Other identities and other scopes are untouched. Earlier `memory_audit` rows survive it: they hold only the hashed identity key, a redacted provenance string and category names, never the values. `forget_identity` is synchronous (SQLite); from async code call it with `await asyncio.to_thread(forget_identity, ...)`. The two stores are separate databases, so the call is not atomic: if one part fails, the other is still done and `ForgetIncomplete` names what is not. Call it again; repeating is safe.

**Audit and withdrawal retention.** `memory_audit` contains only the hashed identity key, record id, action, timestamp, redacted provenance and redaction-category names; it never stores memory content or the values that were redacted. It keeps the latest 1,000 events per identity and prunes older rows on the next audit write. Existing audit rows deliberately survive `forget_identity` as a metadata-only record of the deletion. `continuity_withdrawal` contains only a SHA-256 key derived from the host scope and identity. It has no time-based expiry: it remains until the host explicitly re-enables continuity, so a visitor's withdrawal cannot silently lapse (D-26).

## How it works

```
Browser                                    Server                               Gemini Live
mic -> 16 kHz PCM ---- WebSocket ------->  Bridge -> ADK LiveRequestQueue ---->  model
speaker <- 24 kHz PCM <- WebSocket ------  Bridge <- ADK events <-------------   speech, transcripts, tool calls
onAction(action) <---- {"type":"action"}   tools.py -> sink (checked actions)
useAssistantContext -> {"type":"context"}  session state "screens" -> get_screen_context
sendFrame (a share) -> {"type":"frame"}    checked (JPEG, 256 KB, 1/s) -> LiveRequestQueue ->  model (D-21)
```

- The API key never reaches the browser. Sessions are limited in length (`MAX_SESSION_SECONDS`) and number (`MAX_SESSIONS`), because live audio is billed per minute.
- Every action is checked twice: by the tool on the server, and by `toAssistantAction` in the browser. Most can be undone from the panel.
- One context update is at most 16 KB (UTF-8, compact JSON; `MAX_CONTEXT_BYTES` in `bridge.py` and `contextBudget.ts`, kept equal by a test). The server refuses a bigger one and clears that key, so the model never keeps reading an old value (D-23).
- Only tool calls make anything happen. Nothing Otto says is turned into an action. Some things only the visitor can do, and no tool does them: answering the mic consent, turning on "Hey Otto", starting a camera or screen share, and pressing a card's follow-up. The visitor's Stop, Not now and undo win over the model (D-22).
- The robot is only a picture. It is hidden from screen readers; the panel shows everything Otto says as text.
- Otto's mouth follows its real voice: five bars from five speech bands (`web/src/otto/mouth.ts`): the centre bar is vowel pitch (85-300 Hz), the inner pair the formants (300 Hz-2 kHz), the outer pair consonants and sibilants (2-4 kHz). A noise gate shuts the mouth in pauses, and bars rise in ~25 ms and fall in ~140 ms. The live voice, an audio file in the lab and the lab's fake voice all go through the same `MouthAnalyzer`. With reduced motion the mouth still moves; only body motion stops. The speech bubble shows the transcript as far as the audio has actually played, read from the speech player's own clock. It is held to at most 24 characters a second, so a transcript that arrives ahead of its audio does not run ahead. Without a clock, as in the lab's fake voice, it types at `SPEAK_CPS`.
- Barge-in: cut Otto off and he stops at once. Queued audio is stopped and disconnected, and the rest of his turn still arriving from the server is dropped. The mouth closes, whatever gesture was playing stops, and he nods (`GESTURE_SETTINGS.onInterrupt`, with its chirp) as he goes back to listening. Four things can cut him off:
  - the server hearing the visitor;
  - the panel's Stop talking;
  - typing a message (an interruption like speaking over him: what he was saying is void at once, not when the server answers);
  - pressing Talk;
  - with an open mic, a voice clearly louder than his echo and than the room.

  While Otto is audible the microphone sends nothing, because browsers do not cancel his echo reliably. So the page itself listens for that louder voice (`BARGE_IN` in `otto.config.ts`), then sends what it held back, so the first words are not lost. The voice must stay above both the fixed `level` and `floorRatio` times the room's noise floor (learned while Otto is silent, never from his echo) for `holdMs`; a fan therefore never cuts him off, and a noise shorter than `holdMs` is rejected and reported. Until `calibrationMs` of his silence has taught the page the room (right after the microphone opens), a voice cannot cut him off by volume, so a loud room cannot do it either; Stop talking and Talk always work. `BARGE_IN.level` needs tuning on real speakers and microphones.
- Listening and speaking are separate paths on the server (`server/app/voice/`). The input service reads the browser (audio, text, context) and feeds the model; it never waits on Otto's speech. `events.py` turns each model event into a typed one (transcript, speech, interrupted, turn complete, action), and `output.py` delivers them through one queue and one writer, in the order the model made them. An interruption is an event: it drops the speech still queued (the page already stopped what it was playing) and keeps every message, so an action the model took still arrives. A browser that stops reading cannot stall the model or the visitor's input: its queued speech is capped (`MAX_QUEUED_AUDIO_BYTES`, oldest first), messages are not dropped.
- The open microphone is gated (`speechGate.ts`, core). The page follows the room's noise floor (it falls fast, rises slowly, and is capped), starts a turn when the level stays above `enterRatio` times the floor for `speechOnsetMs`, holds it down to `exitRatio` times the floor (hysteresis), and ends it after `silenceTimeoutMs` below that. Only a validated turn is sent to the server (with the last 600 ms before it, so the first word is whole), and `mic_off` follows its end; between turns a fan is dropped on the page, not streamed and billed. Text and the microphone are separate inputs of one conversation: typing neither stops the microphone nor starts a new session, and a refused or stopped microphone leaves text working. Push-to-talk is not gated: pressing Talk is the visitor's own gate. Tune with `VAD` in `otto.config.ts`.
- Autoplay: the speech player is made inside the Start click. Made any other way ("Hey Otto"), it may start suspended. Its chunks are then queued, not dropped, and play once the visitor's next click, tap or key (Alt+O too) resumes it.
- "Hey Otto" uses the browser's speech recognition. In Chrome and Edge that sends microphone sound to the browser maker while it listens. It is off until the visitor turns it on, and a banner shows whenever it is listening.

## Otto's robot

Otto is the **Clay Robot** from [Originkit](https://www.originkit.dev), added with `npx originkit add clay-robot`: a soft lilac clay bot with a round helmet, a navy visor screen with glowing eyes, side ear pods and a short body with stubby arms. It is drawn by one raymarching shader (WebGL 2, no 3D library), follows the cursor, blinks, glances about and hops when tapped.

| Layer | Where | What it does |
|---|---|---|
| Robot | `web/src/components/originkit/ui/clay-robot.tsx` | The Originkit component. Two additions, marked `Otto:` so they can be re-applied after an update: a five-bar mouth on the visor, a `control` prop the host drives every frame, and a `transparent` mode with no backdrop |
| Scene | `web/src/otto/robot/ClayScene.tsx` | Turns pose, face, the voice and gestures into that control: listening leans in, thinking holds a hand to the chin, talking moves the mouth |
| Wrapper | `web/src/otto/robot/OttoRobot.tsx` | Loads the robot after the page, shows the speech bubble, draws nothing without WebGL 2 |
| Faces | `web/src/otto/robot/robot.ts` | Seven faces (happy, searching, excited, alert, resting, sad, curious): eye openness, happy arcs, gaze, glow, colour, per-eye tilt and size, head pose and blink rate, all eased so a change of mood never snaps |

Colours (clay, visor, eyes) and the backdrop are `ROBOT_COLORS` and `ROBOT_BACKGROUND` in `web/src/otto.config.ts`. By default there is no backdrop: only the robot and a soft floor shadow over your page (`transparent: true`); set it to `false` for the gradient card. Re-running `originkit add clay-robot` overwrites the component: put the `Otto:` changes back after it.

### Gestures

Otto has ten short gestures: `welcomeWave`, `goodbyeWave`, `celebrate`, `nod`, `headShake`, `thinkingHand` (held while thinking), `pointLeft` and `pointRight` (the arm out toward a spot on that side, for guidance), and two idle ones, `lookAround` and `stretch`, which anything else cuts into. They are defined in [`web/src/otto/robot/gestures.ts`](web/src/otto/robot/gestures.ts) as offsets on the clay robot's rig (head turn, nod and tilt, a hop, each arm's raise, swing and stretch, happy eyes and gaze), blended over its own motion. The lifecycle mapping (which gesture plays on connect, disconnect, turn end and error), the intensity, the cooldown and reduced motion are in the `GESTURE_SETTINGS` block of [`web/src/otto.config.ts`](web/src/otto.config.ts). With `enabled: false`, Otto stays still.

To play one from your own code, make a channel once and pass it to `<Otto>`. The same channel tells you when gestures start and end:

```tsx
const gestures = useMemo(createGestureChannel, [])
<Otto gestures={gestures} /* ... */ />
gestures.play('celebrate')
useEffect(() => gestures.onEvent(event => console.log(event.type, event.name)), [gestures])  // 'end' events carry a reason
```

How it fits together: the voice status goes through `gestureForTransition` (`web/src/otto/useGestureTriggers.ts`, a pure function) to decide what plays; the channel carries that, and anything your code plays, to the robot; `ClayScene.tsx` runs one gesture controller per robot and reports starts and ends back on the channel. A new gesture interrupts the current one if its priority is the same or higher (celebrate > waves and head shake > nod), never queues, and blends in while the old one blends out.

### Movement

Otto walks along the bottom of the page (`web/src/otto/movement/stage.ts`, pure logic; `useStage.ts` moves the element). When the voice panel opens he turns, walks aside and stands beside it, and he walks back home when it closes. On a phone, where the panel covers the whole bottom, he hides until it closes. A move goes:
1. He turns toward the destination.
2. He walks, speeding up and slowing to stop on the spot. The clay robot's own legs step in time with the distance covered, so his feet do not slide. His body turns and leans the way he goes, and his head leads.
3. He turns back to face you, and cursor tracking fades back in.

A reversal mid-walk brakes, turns, then walks back. Your code says where he should go, and the stage works out how:

```tsx
const stage = useMemo(createOttoStage, [])
<Otto stage={stage} gestures={gestures} /* ... */ />
if (await stage.moveToElement('#cart')) gestures.play('celebrate')   // true on arrival, false if stopped or superseded
stage.moveToX(0.3); stage.goHome(); stage.moveAwayFrom('.toast'); stage.stop()
stage.turnToward('#cart'); stage.lookAt('#cart', 2)                    // orient, or look, without walking
stage.moveToElement('.marker', { follow: true })                       // keep going to it as it moves
stage.onEvent(e => console.log(e.type))                                // depart, arrive, cancel, hidden
```

One destination is kept until the next command. Obstacles only bend it: the voice panel, and any selectors in `MOVEMENT_SETTINGS.avoid`. An element on the stage itself is stood beside, not on. A click elsewhere on the page makes him turn toward it for a moment (`noticeClicks`); his head already follows the cursor.

Settings are in `MOVEMENT_SETTINGS`:
- `movementEnabled`: off, Otto stays home, only stepping clear of the panel, and refuses other commands.
- `moveSpeed`, `stageMargins`, `home` and `obstacleGap`.
- `roam`: wander near home when idle. Off by default, because a robot strolling over your footer's buttons gets in the way.

With prefers-reduced-motion he does not walk: he moves straight to the spot.

### Idle and sleep

After `IDLE_SETTINGS.idleLookAroundMs` with nothing happening, Otto looks about now and then, taking turns through the gestures in `GESTURE_SETTINGS.idle` (`lookAround`, `stretch`).

After `sleepTimeoutMs` he dozes off: eyes shut, dim glow, head bowed, slow breathing, at a third of the frame rate. He wakes when the cursor comes over him, on a click or tap, or on a key press (the hotkey included). Merely moving the cursor or scrolling keeps him awake but does not wake him, so reading the page does not disturb him. A voice session or the panel open keeps him awake. The lifecycle is `web/src/otto/idle.ts`, a state machine with a test suite.

### Awareness: Otto reacts to what happens in your app

Your app says what happened; Otto decides whether and how to react. You never call his face, gestures or movement for this:

```tsx
const events = useMemo(createOttoEvents, [])
<Otto events={events} /* ... */ />
events.notify({ type: 'success', where: '#save', topic: 'upload' })
const job = events.task('render', { topic: 'image generation', where: '#preview' })  // a long operation
job.succeed('Your image is ready')                                                   // or job.fail('...'), job.done()
```

**Event types:** `success`, `failure`, `attention`, `task`, `complete`, `section`, `select`, `waiting`, `arrive`, `leave`, `interact`, `idle`, `permission` and `express`. Each can carry:
- `importance`: `minor`, `normal` or `major`;
- `where`: a selector, element or rect;
- `topic`: what it was about;
- `message`: words for screen readers.

**Reaction sizes:** Otto (`web/src/otto/awareness/reactions.ts`, pure and tested) picks the smallest reaction that says enough:
- **Glance:** a look toward it and a passing mood.
- **Gesture:** a small celebration, a head shake or a nod.
- **Big:** walk there, the full gesture, and the bubble.

**Built-in reactions:**
- **Success:** happy, then a celebration.
- **Failure:** concerned. He turns and looks toward the problem and shakes his head.
- **Attention:** a curious look at it, plus a wave if it's major.
- **A long task:** searching, after `taskNoticeMs`; then thinking hard, after `thinkingAfterMs`. When it ends he looks at where it ran.
- **Interaction with Otto:** he looks at you and nods.

**What keeps him from being annoying:**
- With the tab hidden, nothing happens. A failure or attention item waits and is shown when the visitor comes back.
- Asleep, only a failure, attention or a major event wakes him.
- During a voice conversation, a glance at most, and the voice keeps his face.
- Repeats (same type and topic) shrink, and the third is ignored.
- Each reaction size has a cooldown.
- A per-minute gesture budget limits how often he gestures.

**Asking permission:** `permission` means Otto (or your app) is asking the visitor for a go-ahead. Give it a `task` id: Otto holds an alert face, even in a conversation, with the `message` (the question) in his bubble and, for a server's request, as a line in the panel, until an ending event with the same `task` answers it (`complete` with `data: { permission: 'granted' | 'denied' }`; a refusal ends the hold with no smile). It wakes him, and when the visitor is away it waits for their return. Without a `task` id it is one brief reaction, since nothing can answer it. Otto only shows the question: whether an action is allowed is the server's and the policy layer's job (D-22).

**From the server (avatar events):** the server can tell Otto how things are going with `{"type":"avatar","event":{...}}` (`server/app/voice/avatar.py`, `web/src/otto/awareness/avatar.ts`, pure and tested). Presentation only: an event says what is happening, never what Otto should do, and it is not a tool, so the model cannot send one. Kinds: `thinking`, `working` (both take an `id`), `waiting`, `permission` (`id` and `state`: `asking`, `granted`, `denied`), `success`, `failure`, `emotion` (one of Otto's faces), `gesture` (one of his gestures), `movement` (`to: 'visitor'`: a look), and `listening`, `speaking` and `interruption`, which the voice session's own status already shows. Each is checked on both ends (ids, caps on text, only names Otto has), and then becomes the events above (`working` is a `task`, `success` is a `success`), so it gets the same judgement as an app event: the same sizes, cooldowns and quiet while he talks. Server code calls `Bridge.avatar({...})`; the server's task engine (below) sends `working`, `success` and `failure` for its tasks, and nothing else in this repo sends one yet (the policy layer will: #47), and the lab's "Server:" buttons try them.

**What the voice model sees:** `<Otto>` also reports the `events.task(...)` handles under `app_tasks` (`awareness/busy.ts`, pure and tested). `running` lists the handles still open, with id and topic. `ended` lists the last five that finished, newest first, each with its outcome (`succeeded`, `failed` or `complete`) and message. Each list keeps at most five entries, and topics and messages are cut at 160 characters. No other event type is sent. Like all context, it reaches the server only while a conversation is open, so "Is my upload done?" or "Why did it fail?" is answered from what your app reported. Keep task messages free of anything the visitor wouldn't want read back.

**Environmental observations (D-30):** while the visitor has actively started camera sharing in the current voice session, Otto can propose a bounded `attention` event about a notable visible object, activity, scene change or potential hazard. A dedicated tool requires a fresh camera frame and sufficient confidence; the server applies session-scoped rate and duplicate limits, then the browser independently checks that camera sharing is still active. Accepted proposals become only a minor `attention` event on the existing `createOttoEvents` path. They cannot start/restart capture, set a page location, trigger actions, or come from speech/transcripts. Stop, hidden-tab stop, session end and consent withdrawal invalidate pending proposals. Screen sharing alone does not enable this camera-only path. No frame bytes or proposal history are retained.

**What Otto notices by himself:** the visitor leaving the tab and coming back, the cursor resting on him or a click on him, and page changes in `<Otto>`.

**Your own rules:** `awareness.rules` in the config are functions of the event and what Otto knows. Return a reaction to react differently, for example by `topic`; the limits above still apply. The lab logs every decision with its reasons.

### Interactive guidance

Your app says what to show; Otto decides how. First mark the things he may show, in markup or in code:

```tsx
<button data-otto-target="save" data-otto-label="the Save button" data-otto-description="Saves your draft.">Save</button>
const off = registerGuideTarget('save', '#save', { label: 'the Save button' })   // code wins over markup with the same id
```

Without `data-otto-label`, the label is the `aria-label`, then the element's text. An id is 1 to 64 of `A-Z a-z 0-9 _ . : -`, starting with a letter or a digit, with no spaces. The same rule holds for guided task ids. A target or task whose id breaks it is never told to the model (the console warns once), and both ends refuse it (`runtimeId.ts`, `RUNTIME_ID` in `tools.py`; D-23). Then make a guide channel once and ask:

```tsx
const guide = useMemo(createOttoGuide, [])
<Otto guide={guide} /* ... */ />                  // <otto-mascot>: otto.guide, otto.showTarget(...), otto.startGuide(...)
guide.show('save')
guide.show({ target: 'save', mode: 'point', reason: 'app', importance: 'normal', say: 'Press here.' })
guide.onEvent(e => console.log(e.type))           // shown, offered, missing, step, done, cancelled
```

A request can carry `mode` (`auto`, `offer`, `glance`, `point`, `approach`, `explain`; `offer` asks first whatever the importance, in the words of `offer` if given), `reason` (`asked`: the visitor asked; `task`: a task step; `app`, the default: your app suggests), `importance` (`minor`, `normal`, `major`) and `say` (his words; `null` says nothing, for when the voice speaks).

**What Otto decides** (`web/src/otto/guidance/guide.ts`, pure and tested; every plan says why):
- **Glance:** a curious look toward it.
- **Offer:** a curious look and "Want me to show you the Save button?", with **Show me** and **Not now**. Nothing moves until the visitor says yes.
- **Point:** he looks and points toward its side (`pointLeft`, `pointRight`, or a nod when it is straight ahead).
- **Approach:** he walks over, looks and points.
- **Explain:** he looks and says what it is.

A target off screen is scrolled into view first. Asked or a task step, he points, or walks over when it is far (`approachMinDistance`). When the target is not on the page, a suggestion is dropped; asked, he looks sad and says "I can't find that on this page."

**How he respects attention** (for `reason: 'app'`):
- With the tab hidden, nothing happens.
- One suggestion per `cooldownMs`.
- Asleep, he lets all but a major one pass.
- Unasked, a minor one is a glance and a normal one an offer (`offerFirst`). An explicit `mode` is capped at point unless it's major.
- In a voice conversation, a glance at most.

Settings are `guidance` in the config: `cooldownMs`, `offerFirst`, `approachMinDistance`, `lookSeconds`, `helpAfterFailures`, `helpWindowMs`, and for friction (below) `proactiveHelpEnabled`, `frictionCooldownMs`, `stallMs`.

**Tasks** walk the visitor through steps:

```tsx
const task = guide.startTask({ id: 'theme', title: 'Change the theme', steps: [
  { id: 'open', target: 'settings', say: 'First open Settings.' },
  { id: 'pick', target: 'theme', say: 'Then pick a theme.' },
] })
task.complete()          // this step is done: Otto shows the next, or celebrates at the end
task.complete('pick')    // the visitor already did 'pick': skip past it
task.back(); task.goTo('open'); task.cancel()
```

Your app can report progress with `complete`. Or Otto can see it for himself: a step may say what finishes it (`doneWhen`) and what undoes it (`undoneWhen`), and the task what abandons it (`cancelWhen`). A signal is one of three things:
- the visitor using a target: a click or a press (`{ on: 'activate' }`, the step's own target unless `target` says otherwise);
- typing in it (`{ on: 'input' }`);
- an app event in the awareness vocabulary (`{ on: 'event', type: 'success', topic: 'save' }`).

```tsx
{ id: 'open', target: 'settings', say: 'First open Settings.', doneWhen: [{ on: 'activate' }],
  undoneWhen: [{ on: 'event', type: 'complete', topic: 'settings-closed' }] }
```

What the signals do:
- the current step's signal moves on to the next step;
- a later step's skips ahead past it;
- an earlier step's `undoneWhen` goes back to that step;
- `cancelWhen` cancels the task;
- anything else changes nothing.

The rules are `observe` in `guidance/task.ts` (pure, tested). `guidance/observe.ts` watches clicks and typing on targets, and the app's events, only while a task runs. Steps without signals wait for `complete`, as before. Starting a task cancels the one before, and `guide.stop()` ends it.

**When something that happened needs help:** most events only get a reaction (see Awareness). An event that names a guidance target in `help` may get an offer to show it (`guidance/help.ts`, pure and tested):
- **One failure** may be a slip, so it gets no offer.
- **The same failure again** within `helpWindowMs` (it counts after `helpAfterFailures` failures), or a major failure, gets an offer.
- **Attention** gets an offer, or is shown at once when it's major.
- **Waiting on the visitor** gets an offer only when it's major.
- **A success on the same topic** forgets the failures.

The offer still goes through the guide's judgement: cooldown, tab hidden, asleep, conversation. While a task runs, its steps are the guidance, so no extra offers are made.

```tsx
events.notify({ type: 'failure', topic: 'signup', help: 'email', message: 'Check the email address.' })
```

**Events:** `guide.onEvent`, or `otto:guide` on `<otto-mascot>`. An `offered` event carries the request: answer yes with `guide.show({ ...request, reason: 'asked' })`. `<Otto>` shows the Show me and Not now buttons itself.

**Highlight:** while Otto shows something, it carries `data-otto-guiding`. The voice kit outlines it; style `[data-otto-guiding]` in your CSS to change that. A point, approach or explain also rings it with the spotlight (`guidance/spotlight.ts`): a fixed-position ring in viewport pixels that follows the target while it scrolls. It never takes focus or the pointer, Escape or any press dismisses it, it is `aria-hidden` (the words are in the panel), and with reduced motion it appears in place. An offer or a glance never rings anything.

**Missing, hidden or disabled targets:** a target that isn't on the page, or is there but not drawn (`display: none`, a collapsed panel), gets the fallback: a sad face, a head shake (its cue is `chirpNegative`) and "I can't find that on this page." The `missing` event says which (`reason: 'not_found' | 'hidden'`). The voice is told before it acts: `<Otto>` reports each target's state, `show_target` refuses a hidden one with a structured error, and accepts a disabled one with `disabled: true` so the model says it can't be used yet.

**Voice:** "Where is…" or "Show me…" makes the model call the `show_target` tool. "How do I…" or "Help me with…" makes it call `start_guided_task` when a task fits. `<Otto>` reports the page's targets and its offered tasks (`registerGuideTask(spec)`) to the server, and each tool accepts only those ids. The browser checks the id again before Otto acts (D-02, D-14, D-16). Otto then says each step himself and follows the visitor's progress; the model only introduces the task. The demo app offers one, "Show an example message", which Otto follows by himself across a page change. Both lists are capped to the context budget: entries are kept in order (registered targets first, then marked-up ones in page order) and the rest are left out whole, with `omitted` telling the model how many (D-23). Register the targets that matter most first.

**What the model sees of a running task:** while a guided task runs, `<Otto>` also reports it under `guide_task_running`: its id and title, the visitor's step (`step` of `total`, 1-based) and that step's words, capped at 80 and 200 characters (`taskProgress` in `guidance/task.ts`). The report is cleared when the task is done or cancelled. Like all context, it reaches the server only while a conversation is open. "Where was I?" or "What's next?" is answered from it, and the model is told not to start that task again or `show_target` the current step.

**Steering a running task by voice:** "Stop the tour", "Go back" or "I've done that, skip it" makes the model call `move_guided_task` with `stop`, `back` or `next`. The server refuses any other move, and refuses when no task is reported as running or when "back" would go before the first step. The browser checks the move again (`toAssistantAction`). Otto then calls the guide's `move`, which cancels the task (reason `user`), goes back a step or completes the current one, and he shows the new step himself. The panel's "Otto did" list says "Stopped the task", "Went back a step" or "Moved on a step" (D-06). Jumping to a named step isn't supported.

**A running task survives a reload (D-20):** `<Otto>` keeps the running task in the tab's `sessionStorage` (key `<STORAGE_PREFIX>:guide-task`), as `{ task, step, savedAt }` only: the task id, the current step's id and when it was saved, never a title, the step's words or anything typed. It is written on every step and removed when the task is done or cancelled. After a reload or a page change in that tab, Otto resumes it straight at that step (a `step` event with `via: 'resume'`, without the intro) once the page has registered its tasks (one frame after he mounts), but only if the page still offers a task with that id that still has that step, and the entry is under 30 minutes old. Otherwise the entry is removed and nothing resumes. Closing the tab, or ending the task, forgets it. `<otto-mascot>` keeps tasks in memory only; a host that wants one to survive a reload starts it again at its step with `guide.startTask(spec, stepId)`.

**Lab:** the Guidance panel in `/lab.html` can:
- ask for each mode;
- send app suggestions at each importance, and reset the cooldown;
- run a narrated task;
- run a task Otto follows: click the cards, or send "saved", "undone" and "left" events;
- send a failure or attention naming a help target;
- with the real Otto against the simulated server, have the "voice" start an offered task, or one the page never offered;
- with the real Otto, type "Where was I?" or "What's next?" to hear the step the page reported (`guide_task_running`), or that no task is running.

Every plan and offer is logged with why.

### Embodied assistance: page context, cards, friction

Otto can read what the page shows, put what reads better than it sounds in his panel, and notice when the visitor is stuck. All of it builds on the guidance above; none of it adds a new way to move or gesture.

**Page context** (`awareness/collectPage.ts`; the shape and budget are core, `awareness/page.ts`). While a conversation is open, `<Otto>` sends the model a snapshot under the context key `page`, refreshed as the visitor works (clicks, focus, typing, submits, dialogs, scrolling; debounced):

```json
{ "path": "/#features", "title": "Features", "headings": ["h1: Features"], "landmarks": ["navigation: Pages", "main"],
  "open": ["dialog: Settings"], "errors": [{ "field": "Email", "message": "Enter an email.", "target": "email" }] }
```

What it never reads, whatever the options:
- anything under `[data-otto-private]`, or Otto's own panel (the conversation is the visitor's words);
- password, hidden and payment (`autocomplete="cc-*"`) fields: not their value, label or error;
- any typed value: a field is only its label and its error text;
- the query string, or a hash that isn't route-shaped (`#access_token=...`).

The visitor's selected text is left out unless `pageContext.includeSelection` (off by default: it can be anything, and it goes to Google). The snapshot is cut to `pageContext.maxChars` (3000) and `pageContext.maxNodes` (60), keeping errors first, then open dialogs, targets, headings and landmarks; a cut one says `truncated`. `pageContext.enabled: false` sends nothing. Outside `<Otto>`, call `collectPageContext(options)` or `watchPageContext(onSnapshot, options)` yourself.

**Two channels.** Otto's voice is the model's own audio, so it can't be filtered after the fact. Instead:
- The model is told that speech is heard, not read: short sentences, and never a URL, code or markdown aloud (`system_instruction` in `app_config.py`).
- What must be read goes on a card: the `show_card` tool (`title`, `body`, optional `code`, up to three `follow_ups`). The server checks and caps it, the browser checks it again (`toAssistantCard` in `messages.ts`), and the panel renders it as text: no HTML, no links. A follow-up is sent only when the visitor presses it. A copy button copies the code.
- The bubble shows the spoken channel only (`toSpoken`, `gemini/channels.ts`): no URLs, code or markdown symbols.

**Friction** (`guidance/friction.ts`, core; `guidance/frictionObserver.ts`, shell). Off by default (`guidance.proactiveHelpEnabled`). When on, Otto watches forms without the host wiring anything:
- a refused submit (the browser's own validation, or fields the app marks `aria-invalid="true"` after submit), `helpAfterFailures` times within `helpWindowMs`;
- sitting on a field marked invalid without typing for `guidance.stallMs` (20 s).

Either gets a quiet offer on the first invalid field's target: a curious look and "Need a hand with this?" with Show me and Not now. Never speech, never focus, no sound of its own. At most one per `guidance.frictionCooldownMs` (60 s), none in a private form or while a task runs, and the guide's own judgement still applies (in a conversation it is a glance). Show me points at the field and says the app's own error text (`aria-errormessage`), else the browser's.

**What was left out, on purpose:**
- No `scrollToSection` tool: a section is a target, and `show_target` already scrolls to it.
- No `celebrate` tool: Otto celebrates a finished task himself (excited face, `celebrate`, `chirpCelebration`), because he saw it (D-16). The model can't see the screen, so it can't know a step is done.
- No sound on a friction offer: cues follow gestures (D-11), and an unasked chirp is the interruption this is meant to avoid.

**Lab:** the Embodied Assistant sandbox in `/lab.html` has a sample form, with a password, a card number, private notes and a hidden field the snapshot must never read. It can:
- show the snapshot the model would see (with the real Otto, what the simulated server received);
- simulate `show_target` (with the spotlight) and `show_card`;
- finish a step, so Otto celebrates;
- try a missing, hidden or disabled target;
- split a model reply into its spoken and visual channels, or stream it;
- trigger form friction, with proactive help on or off.

**For your own Gemini session** (`otto-mascot/gemini`): `buildOttoSystemPrompt({ appName, description, page: collectPageContext() })` writes a prompt with the same rules, the page fenced as data. The bridge's bubble gets the spoken channel, and `onVisual(parts)` gets the code blocks and links. Links are model output: check one against your own allow-list before making it clickable.

### Sharing the screen or the camera

During a conversation, the panel has **Share screen** (in browsers with `getDisplayMedia`) and **Show camera** (with `getUserMedia`), one share at a time. The rules are D-21:
- **Asked first, every time.** Pressing it shows what is sent and to whom before the browser's picker opens. Nothing remembers a yes, and the model has no tool to start a share.
- **Shown the whole time.** While it runs, the panel says "Sharing your screen" with **Stop sharing**, beside the browser's own indicator.
- **What is sent.** JPEG stills, at most one a second and 768 px on the long side, through the same session as the voice (`sendCapture`, `sendFrame` in `useVoiceAssistant.ts`). The server checks the type, size and rate again (`Bridge.send_frame`). Nothing is kept: no storage, no logs, and ADK's `save_live_blob` is off.
- **Private regions.** The picker asks for this tab first. When the visitor picks this tab (known through Chrome's Capture Handle), every region the page snapshot never reads (D-17: `[data-otto-private]`, Otto's panel, password, hidden and `cc-*` fields) is painted over before encoding. When they pick another tab or window, the panel says "Otto sees everything in this window." instead.
- **The camera.** Its notice says "Everything in view is sent." and nothing is masked: a camera frame can't be filtered. While it runs, the panel says "Camera on" with **Turn camera off**. It has the same limits and stop paths as the screen. No microphone audio comes with it; the voice keeps its own consent.
- **When it stops.** At Stop sharing (or Turn camera off), at the end of the conversation (the time limit too), when the tab is hidden, at the browser's own Stop sharing, or when the panel closes. It never restarts by itself.

The rules are core (`capture.ts`: `captureStop`, `frameDue`, `frameSize`, `maskBoxes`); the capture is shell (`useScreenShare.ts`, `ScreenShare.tsx`). `<otto-mascot>` doesn't capture. In the lab, "What the server has of a share" shows the source and a frame count, never the pictures. Whether the live endpoint accepts these frames is unverified until Q-01 is answered.

### Sign input (adapter slice, no recognizer)

The panel can take signed input through a **recognizer adapter** the app plugs in (D-29). **The kit still ships no production recognizer**: no model is bundled or connected to the camera, and with no adapter configured the panel shows no sign controls. A separate, offline **personal BSL ML prototype** now lives in `ml/sign/`; it collects consented landmark sequences and provides a training/export pipeline, but does not alter runtime capture or close Q-09's broader community-validation requirements. What ships in the kit is the boundary around a future adapter:
- **Its own notice, every time.** **Sign to Otto** opens a plain-language notice: what is captured (the camera is turned on and watches you sign), who receives it (the adapter's `recipient`), whether it is processed `local` or `remote`, the limits, that Otto keeps no video, and that the words it reads come back and are sent on to Otto's voice service, as if you had typed them, only after you confirm them. D-21's camera consent does not cover it, and nothing is remembered: each start asks again, and a stopped capture never restarts by itself.
- **Shown the whole time.** "Signing is on" with **Stop signing**. It stops at Stop, when the tab is hidden, when the conversation ends, on an adapter failure, and after 120 seconds. Video held in memory is bounded (150 frames, 10 seconds, 16 MB, oldest dropped) and emptied at every stop. No frame goes to logs, storage, analytics, the lab or the server.
- **Uncertain text.** Updates are `partial`, `final` or `unrecognized` (with an optional 0 to 1 `confidence`), and every one passes a `SignRecognitionGate` made for that capture: updates for another session or language, repeated or out-of-order ones, ones after a final for the same utterance, and malformed, control-character or over-long (500 characters) text are dropped. A partial is shown as "not final" and replaced by the next one. A final waits for **Confirm and send**, **Correct** (an editable box) or **Discard**; only a confirmed or corrected result is sent, as ordinary typed text through `sendText` with a prefix: `[Signed, confirmed by visitor] ...` or `[Signed, corrected by visitor] ...`. `unrecognized` never becomes text. There is no new wire message, and the text can start no tool or action (D-02, D-22). Otto's reply stays in the panel's text channel.

Implement `SignRecognizer` (`processing`, `recipient`, `language`, `start(sessionId, onUpdate)`, optional `push(frame)`, `stop()`; each update carries the `sessionId` it was given, a `sequence`, `capturedAtMs`, `utteranceId` and the `language`) and provide it with `SignRecognizerProvider` (`web/src/otto/sign/useSignRecognizer.ts`; not exported from `otto-mascot`, `otto-mascot/react` or `otto-mascot/gemini`). The adapter owns how frames are captured; a host that captures them can call `pushFrame` from `useSign`. If the app removes or swaps the recognizer while signing, the capture ends as a failure (the reader that was started is stopped and the buffer dropped), so the indicator never disappears while video is captured. The rules are core (`sign/sign.ts`, and the update contract and gate in `signRecognition.ts`); the hook is `sign/useSign.ts`; the panel part is `sign/SignInput.tsx`. In the lab, "Sign reader script" selects a scripted fake (`web/src/lab/fakeSignRecognizer.ts`: no camera, no model) so the flow can be tried. An adapter's provider terms (retention, training use, region) must be checked and disclosed before a remote one is enabled.

### Sign-language ML prototype (BSL)

The offline workspace in `ml/sign/` is the first personal British Sign Language (BSL) prototype. It starts with isolated signs; continuous signing and sentence recognition are later work. It does not run inside Otto, access the production camera path, send frames to a service, or provide a trained model by default.

**Set up the local training environment** (Python 3.11+):

```bash
cd ml/sign
python3 -m venv .venv
. .venv/bin/activate                 # macOS / Linux
# Windows PowerShell: .venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

**Record your own examples.** The collector asks you to press Space to start and stop each take. It displays the live camera locally, extracts MediaPipe Holistic landmarks and saves compressed landmark sequences only; it does not save the camera video. Use a pseudonymous signer ID and a new session ID for each separate recording session:

```bash
otto-sign-record --label HELLO --gloss HELLO --signer-id owner --session-id day-01 --takes 15 --consent-confirmed
otto-sign-record --label THANK_YOU --gloss THANK_YOU --signer-id owner --session-id day-01 --takes 15 --consent-confirmed
```

Run the same labels over several separate sessions (use a new session ID each day). Three sessions is the minimum for a personal session-held-out split; five or more is preferable. The first version uses the owner's explicit consent as its data basis. Do not record another person without their informed permission.

**Train and export** after the local manifest contains enough examples:

```bash
otto-sign-train --manifest data/manifest.csv --data-root data --output runs/bsl-personal
pytest -q
```

The training pipeline normalizes both hands, upper-body pose and selected facial/non-manual landmarks, adds temporal motion features, trains a temporal Conv-Transformer candidate and exports an ONNX file plus a checkpoint and metrics. Artifacts under `data/` and `runs/` are ignored by Git.

**Evaluation limits matter.** With one signer, the tool holds out entire capture sessions and labels the result `personal-session-held-out`; it never calls this signer-independent accuracy. When three or more signers are present, it holds out signers. A held-out signer/session need not demonstrate every label, so per-class metrics report missing support rather than leaking examples across splits. These early measurements are not a claim of general BSL recognition quality.

Use only data you have rights and consent to use. The collector defaults to self-recorded data. Third-party manifest rows require a rights basis and attribution, but that metadata is not legal verification: check the specific source video's permissions before downloading, annotating or training. The BSL SignBank prohibits scraping and bulk downloads without permission; the BOBSL dataset has access restrictions. [Oxford BSLDict](https://www.robots.ox.ac.uk/~vgg/research/bsldict/) documents a CC BY 4.0 dataset, while noting original video copyright remains with original owners, so check the relevant clip/source terms and keep attribution. No third-party data is downloaded automatically.

This is a training foundation, not the finished recognizer. The exported ONNX model is not yet integrated with `SignRecognizerProvider`; a later slice must implement and benchmark browser landmark parity, worker inference, calibrated abstention and visitor-started capture before it can be connected to Otto.

### Themes and per-instance config

Every mascot setting has a default in `web/src/otto/config.ts`. `defineOttoConfig(overrides)` layers three things, merging deeply (arrays are replaced):
1. the defaults;
2. a theme preset: `default`, `midnight`, `cyber` or `minimal`. Each sets look and personality: colours, glow, gesture size, sound, speed, and how lively his reactions are;
3. your overrides.

This app's overrides are `OTTO_CONFIG` in `web/src/otto.config.ts`. `<Otto config={...}>` and each `<otto-mascot>` can have their own. A theme change applies live, without rebuilding the robot.

## `<otto-mascot>`: Otto in any page

The mascot works without React in the host page. It includes the robot, stage, gestures, sound, lip-sync, idle life and awareness, but not the Gemini voice panel, which needs this repo's server.

```bash
cd web && npm run build:lib
```

The build writes these to `dist-lib/`, then runs `scripts/check-dist.mjs` to prove the three entry points stay separate (D-15):
- `otto-mascot.js`, the main module (the package root), about 355 kB raw;
- a separate chunk for the robot's WebGL scene, loaded later;
- `react.js` (`./react`), about 3 kB, and `gemini.js` (`./gemini`), about 21 kB: optional adapters, below;
- type declarations, wired through `package.json` `exports`.

```html
<script type="module" src="/otto-mascot.js"></script>
<otto-mascot theme="midnight" hotkey="O"></otto-mascot>
<script type="module">
  const otto = document.querySelector('otto-mascot')
  otto.addEventListener('otto:ready', () => otto.playGesture('welcomeWave'))
  otto.notify({ type: 'success', where: '#save' })
</script>
```

**Attributes**, which update live: `state`, `face`, `theme`, `sound-enabled`, `movement-enabled` and `hotkey`. `placement` (`dock`, or `inline` to stay inside the element's own box) is read when the element connects. The `config` property takes an override object.

**Methods:**
- body and look: `playGesture`, `playSound`, `setState`, `setFace`;
- movement: `moveToX`, `moveToElement`, `goHome`, `lookAt`;
- voice: `connectAudioNode`, which lip-syncs to any Web Audio node of yours, and `speakText`, which shows the bubble and screen-reader text with a procedural mouth, optionally spoken aloud by the browser;
- `interrupt`;
- awareness: `notify` and `task`;
- guidance: `showTarget` and `startGuide`, and the `guide` channel (see "Interactive guidance").

**Events:** `otto:ready`, `otto:statechange`, `otto:gesturestart`, `otto:gestureend`, `otto:interrupt`, `otto:error`, `otto:activate`, `otto:reaction`, `otto:move` and `otto:guide`. All bubble and cross the shadow boundary, and they're typed for `addEventListener`. Without the element, `createOtto(container, options)` returns the same controller.

**Isolation:** Otto lives in a shadow root, so page styles don't reach him. Only the `--otto-*` custom properties do, on purpose: they are the theming hook.

**Lifecycle:**
- **Mount:** the element mounts when the browser is idle, and the WebGL code loads after that.
- **Removal:** removing the element disposes everything. The frame loop and observers stop, listeners are removed, sound closes, and the WebGL context is released.
- **Leak test:** 20 mount and unmount cycles left no WebGL contexts or listeners behind.
- **Fallbacks:** without WebGL 2 the robot isn't drawn, and `otto:error` says so. Text and ARIA output still work. With reduced motion he snaps instead of walking.

**React (`./react`):** `<OttoMascot>` and `useOtto()` wrap the element for React and Next.js. It is safe to render on the server (the Next.js App Router included, as the module is `'use client'`): the server writes a plain `<otto-mascot>` tag, and the element code loads in the browser after mount. React is the app's own, an optional peer dependency.

```tsx
import { OttoMascot, useOtto } from 'otto-mascot/react'
const { ref, otto, ready } = useOtto()
<OttoMascot ref={ref} theme="midnight" onActivate={() => otto.playGesture('welcomeWave')} />
```

**Gemini voice (`./gemini`):** `createGeminiVoiceBridge(otto, options)` wires a live voice session into Otto: the audio to his lip-sync, the words to his bubble, the session to his face and gestures. Call `connect()` from a click. It connects either way, and never with a raw API key (D-01), which it refuses:
- `transport: { type: 'proxy', url: 'wss://…/ws/voice' }`: this repo's server, which holds the key (recommended);
- `transport: { type: 'live', token }`: Gemini Live directly, with an ephemeral token your server mints per session.

The bridge also ends the visitor's turn itself: a Web Audio RMS meter on the microphone (`vad` option, defaults and notes under `VAD` in `otto.config.ts`) follows the room's noise floor (an adaptive floor with hysteresis: `enterRatio`, `exitRatio`, `speechThreshold` as the minimum in a silent room), confirms speech after `speechOnsetMs` above the enter line, ends the turn after `silenceTimeoutMs` below the exit line (it stops the mic, sends `mic_off` to the proxy or `audioStreamEnd` to Gemini Live, and Otto starts thinking), cancels back to idle after `noSpeechTimeoutMs` with no speech, and cuts any turn at `maxTurnDurationMs`. The meter is muted while Otto is audible (D-05), and it runs on a timer so a background tab still ends the turn. `vad: false` leaves turn-taking to the server. The noise floor carries over to the detector that reopens the mic after each reply. `onDiagnostic` reports speech start and end, turn complete and, in the main panel (`useVoiceAssistant`, which gates its open mic with the same rules), interruptions accepted or rejected with the reason: levels, durations and reasons only, never audio. The lab has a meter and a simulated cutoff.

The Live protocol details (the endpoint, the model id, message field names, audio formats) are marked `[verify]` in `web/src/otto/gemini/transports.ts`, and haven't been checked against a real endpoint yet (Q-01).

**Dependencies:** React is bundled inside the element, so a page needs nothing else; a React app gets a second, isolated copy (`./react` itself bundles none, but the element it loads still has its own). There is no Three.js to share: the robot is one WebGL 2 shader. Before publishing, give `web/package.json` a public name and remove `private`.

**Playground:** with `npm run dev`, open http://localhost:5173/preview/. It has a live theme picker, every method, an `otto:*` event log, an inline Otto, a 20-cycle mount test, and copy-paste snippets. The page's own styles are deliberately hostile, to show that none of them reach Otto.

### Sound

Otto chirps: six tiny cues synthesised with Web Audio, no audio files (`web/src/otto/sound.ts`): `chirpConnect`, `chirpAcknowledge`, `chirpThinking`, `chirpNegative`, `chirpCelebration`, `chirpGoodbye`. They follow the gestures: each gesture names the cue it plays when it starts in `SOUND_SETTINGS.gestureCues` (`web/src/otto.config.ts`), next to `soundEnabled` and `soundVolume`. Nothing plays from the voice state itself. Browsers only allow sound after the visitor's first click or key press: until then no audio is set up and cues are skipped. To play one yourself, `useGestureSounds(channel)` returns the controller: `sound.current?.play('chirpCelebration')`.

## Deploying

- **Server**: any host that supports WebSockets (Render, Railway, Fly). Set `GEMINI_API_KEY` and `CORS_ORIGINS` (your site's exact origin; no wildcards). Free tiers sleep, and the panel shows "Waking Otto up" while the server starts.
- **Continuity (D-26)**: cross-session continuity is off by default. Set `CONTINUITY_TRUST_PROXY=true` only when a trusted host/deployment proxy injects `X-Otto-Continuity-Enabled: true` and an opaque `X-Otto-Continuity-Identity` header. The identity is consumed only on the server and is never put into browser messages, page context, prompts or logs. CI-2 stores only the app scope, task id, step id and save time in SQLite (`CONTINUITY_STORE_PATH`, default `server/data/continuity.sqlite3`), expires records after seven days, and deletes them on task completion/cancellation or **Clear saved task** in the voice panel. CI-3 supports a one-session handoff through a destination id reported by the current interface: old target/task/destination registries are cleared on navigation, and the destination interface must report the same task and step before Otto resumes it. The host maps destination ids to routes; URLs, paths and identity are never stored or sent to the model. Unrelated host/app scopes remain isolated. Without the trusted boundary, Otto keeps the existing same-tab D-20 behaviour.
- **Web**: any static host. Set `VITE_API_URL` to the server's URL before `npm run build`.

## Where it came from

The voice guide, the panel and the robot wiring come from the NASA Earth Jukebox (2026 NASA Space Apps Challenge). The voice guide was first ported from the FinAssist voice assistant. The jukebox-only parts (player, sound map, data sets, weather and Planetary Computer tools) are left out. The [architecture and source-attribution register](docs/source-attribution.md) distinguishes these implemented origins from reference-only patterns and records the licence checks still required.
