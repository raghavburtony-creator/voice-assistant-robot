# Otto voice kit

A starter kit for adding **Otto**, a clay robot voice guide, to a web app. You talk to Otto (or type), it answers out loud with Gemini Live, and it can act on the page: open a page, run one of your app's commands, read what is on screen. Taken out of the NASA Earth Jukebox and made generic.

- **Robot**: Otto is Originkit's Clay Robot (`web/src/components/originkit/ui/clay-robot.tsx`), drawn by a WebGL 2 shader, with a mouth and a control hook added for the voice kit.
- **Web** (`web/`): React, TypeScript and Vite. The robot, the voice panel, "Hey Otto", consent, push-to-talk or open mic, a text fallback.
- **Server** (`server/`): FastAPI and Google ADK. It holds the Gemini session and the API key, and runs Otto's tools.

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

Checks: `cd server && .venv/bin/python -m pytest`, `cd web && npm test` (the gesture engine and the lifecycle rules) and `cd web && npm run build`.

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

Otto has eight short gestures: `welcomeWave`, `goodbyeWave`, `celebrate`, `nod`, `headShake`, `thinkingHand` (held while thinking), and two idle ones, `lookAround` and `stretch`, which anything else cuts into. They are defined in [`web/src/otto/robot/gestures.ts`](web/src/otto/robot/gestures.ts) as offsets on the clay robot's rig (head turn, nod and tilt, a hop, each arm's raise, swing and stretch, happy eyes and gaze), blended over its own motion. The lifecycle mapping (which gesture plays on connect, disconnect, turn end and error), the intensity, the cooldown and reduced motion are in the `GESTURE_SETTINGS` block of [`web/src/otto.config.ts`](web/src/otto.config.ts). With `enabled: false`, Otto stays still.

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

The build writes three things to `dist-lib/`:
- `otto-mascot.js`, the main module;
- a separate chunk for the robot's WebGL scene, loaded later;
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
- awareness: `notify` and `task`.

**Events:** `otto:ready`, `otto:statechange`, `otto:gesturestart`, `otto:gestureend`, `otto:interrupt`, `otto:error`, `otto:activate`, `otto:reaction` and `otto:move`. All bubble and cross the shadow boundary, and they're typed for `addEventListener`. Without the element, `createOtto(container, options)` returns the same controller.

**Isolation:** Otto lives in a shadow root, so page styles don't reach him. Only the `--otto-*` custom properties do, on purpose: they are the theming hook.

**Lifecycle:**
- **Mount:** the element mounts when the browser is idle, and the WebGL code loads after that.
- **Removal:** removing the element disposes everything. The frame loop and observers stop, listeners are removed, sound closes, and the WebGL context is released.
- **Leak test:** 20 mount and unmount cycles left no WebGL contexts or listeners behind.
- **Fallbacks:** without WebGL 2 the robot isn't drawn, and `otto:error` says so. Text and ARIA output still work. With reduced motion he snaps instead of walking.

**Dependencies:** React is bundled inside the element, so a page needs nothing else; a React app gets a second, isolated copy. There is no Three.js to share: the robot is one WebGL 2 shader. Before publishing, give `web/package.json` a public name and remove `private`.

**Playground:** with `npm run dev`, open http://localhost:5173/preview/. It has a live theme picker, every method, an `otto:*` event log, an inline Otto, a 20-cycle mount test, and copy-paste snippets. The page's own styles are deliberately hostile, to show that none of them reach Otto.

### Sound

Otto chirps: six tiny cues synthesised with Web Audio, no audio files (`web/src/otto/sound.ts`): `chirpConnect`, `chirpAcknowledge`, `chirpThinking`, `chirpNegative`, `chirpCelebration`, `chirpGoodbye`. They follow the gestures: each gesture names the cue it plays when it starts in `SOUND_SETTINGS.gestureCues` (`web/src/otto.config.ts`), next to `soundEnabled` and `soundVolume`. Nothing plays from the voice state itself. Browsers only allow sound after the visitor's first click or key press: until then no audio is set up and cues are skipped. To play one yourself, `useGestureSounds(channel)` returns the controller: `sound.current?.play('chirpCelebration')`.

## Deploying

- **Server**: any host that supports WebSockets (Render, Railway, Fly). Set `GEMINI_API_KEY` and `CORS_ORIGINS` (your site's exact origin; no wildcards). Free tiers sleep, and the panel shows "Waking Otto up" while the server starts.
- **Web**: any static host. Set `VITE_API_URL` to the server's URL before `npm run build`.

## Where it came from

The voice guide, the panel and the robot wiring come from the NASA Earth Jukebox (2026 NASA Space Apps Challenge). The voice guide was first ported from the FinAssist voice assistant. The jukebox-only parts (player, sound map, data sets, weather and Planetary Computer tools) are left out.
