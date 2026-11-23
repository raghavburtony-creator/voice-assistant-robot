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

## Using it in a new project

The two files you edit every time are the two config files. Their page and command lists must match (a server test checks it).

| What | Web | Server |
|---|---|---|
| Otto's name, your pages, your commands | `web/src/otto.config.ts` | `server/app/voice/app_config.py` |
| What Otto knows and how it speaks | | `app_config.py`: `PAGES`, `FAQ`, `APP_DESCRIPTION`, `system_instruction()` |
| What Otto can do | `App.tsx` `onAction` | `server/app/voice/tools.py` |

In your app:

```tsx
import { Otto, useAssistantContext, type AssistantAction } from './otto'

// Once, near the top of the app. `page` is the visitor's current page id.
<Otto page={page} onAction={(action: AssistantAction) => {
  if (action.action === 'navigate') router.push(action.page)
  else if (action.name === 'toggle_theme') toggleTheme()
}} />

// In any component: tell Otto what is on screen. It reads this with get_screen_context.
useAssistantContext('cart', { items: 3, total: 'Rs 450' })
```

Copy `web/src/otto/`, `web/src/otto.config.ts`, `web/public/otto/` and `server/app/voice/` into the new project, or start from this repository. Otto's colours are `ROBOT_COLORS` in `otto.config.ts`.

### Adding a tool

1. Write the function in `server/app/voice/tools.py` and add it to `TOOLS`. Check every argument: the model's output is untrusted.
2. If it changes the page, return an action through `_send(...)`, for example `{"action": "command", "name": "open_cart"}`.
3. Allow that action in the browser: add the command to `COMMANDS` in both config files (and to the `Command` type in `tools.py`), or, for a new kind of action, add a variant to `AssistantAction` in `web/src/otto/messages.ts`.
4. Handle it in your `onAction`, and describe it in `COMMAND_LABELS` so the panel's "Otto did" list says what happened.
5. Tell Otto when to use it in `system_instruction()`.

A tool that only reads (a lookup, a calculation) needs only step 1 and step 5.

## How it works

```
Browser                                    Server                               Gemini Live
mic -> 16 kHz PCM ---- WebSocket ------->  Bridge -> ADK LiveRequestQueue ---->  model
speaker <- 24 kHz PCM <- WebSocket ------  Bridge <- ADK events <-------------   speech, transcripts, tool calls
onAction(action) <---- {"type":"action"}   tools.py -> sink (checked actions)
useAssistantContext -> {"type":"context"}  session state "screens" -> get_screen_context
```

- The API key never reaches the browser. Sessions are limited in length (`MAX_SESSION_SECONDS`) and number (`MAX_SESSIONS`), because live audio is billed per minute.
- Every action is checked twice: by the tool on the server, and by `toAssistantAction` in the browser. Most can be undone from the panel.
- The robot is only a picture. It is hidden from screen readers; the panel shows everything Otto says as text.
- Otto's mouth follows its real voice: five bars from five speech bands (`web/src/otto/mouth.ts`): the centre bar is vowel pitch (85-300 Hz), the inner pair the formants (300 Hz-2 kHz), the outer pair consonants and sibilants (2-4 kHz). A noise gate shuts the mouth in pauses, and bars rise in ~25 ms and fall in ~140 ms. The live voice, an audio file in the lab and the lab's fake voice all go through the same `MouthAnalyzer`. With reduced motion the mouth still moves; only body motion stops. The speech bubble shows the transcript as far as the audio has actually played, read from the speech player's own clock. It is held to at most 24 characters a second, so a transcript that arrives ahead of its audio does not run ahead. Without a clock, as in the lab's fake voice, it types at `SPEAK_CPS`.
- Barge-in: cut Otto off and he stops at once. Queued audio is stopped and disconnected, and the rest of his turn still arriving from the server is dropped. The mouth closes, whatever gesture was playing stops, and he nods (`GESTURE_SETTINGS.onInterrupt`, with its chirp) as he goes back to listening. Four things can cut him off:
  - the server hearing the visitor;
  - the panel's Stop talking;
  - pressing Talk;
  - with an open mic, a voice clearly louder than his echo.

  While Otto is audible the microphone sends nothing, because browsers do not cancel his echo reliably. So the page itself listens for that louder voice (`BARGE_IN` in `otto.config.ts`), then sends what it held back, so the first words are not lost. `BARGE_IN.level` needs tuning on real speakers and microphones.
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

**Event types:** `success`, `failure`, `attention`, `task`, `complete`, `section`, `select`, `waiting`, `arrive`, `leave`, `interact` and `idle`. Each can carry:
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

**What Otto notices by himself:** the visitor leaving the tab and coming back, the cursor resting on him or a click on him, and page changes in `<Otto>`.

**Your own rules:** `awareness.rules` in the config are functions of the event and what Otto knows. Return a reaction to react differently, for example by `topic`; the limits above still apply. The lab logs every decision with its reasons.

### Interactive guidance

Your app says what to show; Otto decides how. First mark the things he may show, in markup or in code:

```tsx
<button data-otto-target="save" data-otto-label="the Save button" data-otto-description="Saves your draft.">Save</button>
const off = registerGuideTarget('save', '#save', { label: 'the Save button' })   // code wins over markup with the same id
```

Without `data-otto-label`, the label is the `aria-label`, then the element's text. Then make a guide channel once and ask:

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

**Voice:** "Where is…" or "Show me…" makes the model call the `show_target` tool. "How do I…" or "Help me with…" makes it call `start_guided_task` when a task fits. `<Otto>` reports the page's targets and its offered tasks (`registerGuideTask(spec)`) to the server, and each tool accepts only those ids. The browser checks the id again before Otto acts (D-02, D-14, D-16). Otto then says each step himself and follows the visitor's progress; the model only introduces the task. The demo app offers one, "Show an example message", which Otto follows by himself across a page change.

**Lab:** the Guidance panel in `/lab.html` can:
- ask for each mode;
- send app suggestions at each importance, and reset the cooldown;
- run a narrated task;
- run a task Otto follows: click the cards, or send "saved", "undone" and "left" events;
- send a failure or attention naming a help target;
- with the real Otto against the simulated server, have the "voice" start an offered task, or one the page never offered.

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

The Live protocol details (the endpoint, the model id, message field names, audio formats) are marked `[verify]` in `web/src/otto/gemini/transports.ts`, and haven't been checked against a real endpoint yet (Q-01).

**Dependencies:** React is bundled inside the element, so a page needs nothing else; a React app gets a second, isolated copy (`./react` itself bundles none, but the element it loads still has its own). There is no Three.js to share: the robot is one WebGL 2 shader. Before publishing, give `web/package.json` a public name and remove `private`.

**Playground:** with `npm run dev`, open http://localhost:5173/preview/. It has a live theme picker, every method, an `otto:*` event log, an inline Otto, a 20-cycle mount test, and copy-paste snippets. The page's own styles are deliberately hostile, to show that none of them reach Otto.

### Sound

Otto chirps: six tiny cues synthesised with Web Audio, no audio files (`web/src/otto/sound.ts`): `chirpConnect`, `chirpAcknowledge`, `chirpThinking`, `chirpNegative`, `chirpCelebration`, `chirpGoodbye`. They follow the gestures: each gesture names the cue it plays when it starts in `SOUND_SETTINGS.gestureCues` (`web/src/otto.config.ts`), next to `soundEnabled` and `soundVolume`. Nothing plays from the voice state itself. Browsers only allow sound after the visitor's first click or key press: until then no audio is set up and cues are skipped. To play one yourself, `useGestureSounds(channel)` returns the controller: `sound.current?.play('chirpCelebration')`.

## Deploying

- **Server**: any host that supports WebSockets (Render, Railway, Fly). Set `GEMINI_API_KEY` and `CORS_ORIGINS` (your site's exact origin; no wildcards). Free tiers sleep, and the panel shows "Waking Otto up" while the server starts.
- **Web**: any static host. Set `VITE_API_URL` to the server's URL before `npm run build`.

## Where it came from

The voice guide, the panel and the robot wiring come from the NASA Earth Jukebox (2026 NASA Space Apps Challenge). The voice guide was first ported from the FinAssist voice assistant. The jukebox-only parts (player, sound map, data sets, weather and Planetary Computer tools) are left out.
