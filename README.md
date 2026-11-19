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

To tune the robot without a key or a server, open http://localhost:5173/lab.html: every pose, all seven faces and every gesture; the mouth from a fake voice or any audio file you pick, with a meter of the five bands; each sound cue; and a simulated voice session ("Run a conversation") that plays the lifecycle gestures through the same rules as the app, with a live log of gesture events.

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
- Otto's mouth follows its real voice: five bars from five speech bands (`web/src/otto/mouth.ts`): the centre bar is vowel pitch (85-300 Hz), the inner pair the formants (300 Hz-2 kHz), the outer pair consonants and sibilants (2-4 kHz). A noise gate shuts the mouth in pauses, and bars rise in ~25 ms and fall in ~140 ms. The live voice, an audio file in the lab and the lab's fake voice all go through the same `MouthAnalyzer`. With reduced motion the mouth still moves; only body motion stops. The speech bubble types the transcript at a fixed pace (`SPEAK_CPS`), so it can run slightly ahead of or behind the voice.
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

Otto has six short gestures: `welcomeWave`, `goodbyeWave`, `celebrate`, `nod`, `headShake` and `thinkingHand` (held while thinking). They are defined in [`web/src/otto/robot/gestures.ts`](web/src/otto/robot/gestures.ts) as offsets on the clay robot's rig (head turn, nod and tilt, a hop, each arm's raise, swing and stretch, happy eyes and gaze), blended over its own motion. The lifecycle mapping (which gesture plays on connect, disconnect, turn end and error), the intensity, the cooldown and reduced motion are in the `GESTURE_SETTINGS` block of [`web/src/otto.config.ts`](web/src/otto.config.ts). With `enabled: false`, Otto stays still.

To play one from your own code, make a channel once and pass it to `<Otto>`. The same channel tells you when gestures start and end:

```tsx
const gestures = useMemo(createGestureChannel, [])
<Otto gestures={gestures} /* ... */ />
gestures.play('celebrate')
useEffect(() => gestures.onEvent(event => console.log(event.type, event.name)), [gestures])  // 'end' events carry a reason
```

How it fits together: the voice status goes through `gestureForTransition` (`web/src/otto/useGestureTriggers.ts`, a pure function) to decide what plays; the channel carries that, and anything your code plays, to the robot; `ClayScene.tsx` runs one gesture controller per robot and reports starts and ends back on the channel. A new gesture interrupts the current one if its priority is the same or higher (celebrate > waves and head shake > nod), never queues, and blends in while the old one blends out.

### Sound

Otto chirps: six tiny cues synthesised with Web Audio, no audio files (`web/src/otto/sound.ts`): `chirpConnect`, `chirpAcknowledge`, `chirpThinking`, `chirpNegative`, `chirpCelebration`, `chirpGoodbye`. They follow the gestures: each gesture names the cue it plays when it starts in `SOUND_SETTINGS.gestureCues` (`web/src/otto.config.ts`), next to `soundEnabled` and `soundVolume`. Nothing plays from the voice state itself. Browsers only allow sound after the visitor's first click or key press: until then no audio is set up and cues are skipped. To play one yourself, `useGestureSounds(channel)` returns the controller: `sound.current?.play('chirpCelebration')`.

## Deploying

- **Server**: any host that supports WebSockets (Render, Railway, Fly). Set `GEMINI_API_KEY` and `CORS_ORIGINS` (your site's exact origin; no wildcards). Free tiers sleep, and the panel shows "Waking Otto up" while the server starts.
- **Web**: any static host. Set `VITE_API_URL` to the server's URL before `npm run build`.

## Where it came from

The voice guide, the panel and the robot wiring come from the NASA Earth Jukebox (2026 NASA Space Apps Challenge). The voice guide was first ported from the FinAssist voice assistant. The jukebox-only parts (player, sound map, data sets, weather and Planetary Computer tools) are left out.
