# Otto voice kit

A starter kit for adding **Otto**, a 3D robot voice guide, to a web app. You talk to Otto (or type), it answers out loud with Gemini Live, and it can act on the page: open a page, run one of your app's commands, read what is on screen. Taken out of the NASA Earth Jukebox and made generic.

- **Robot** (`blender/`): Otto is modelled in Blender by a Python (bpy) script and exported as `web/public/otto/otto.glb`.
- **Web** (`web/`): React, TypeScript and Vite. Otto drawn with React Three Fiber, the voice panel, "Hey Otto", consent, push-to-talk or open mic, a text fallback.
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

To tune the robot without a key or a server, open http://localhost:5173/lab.html: every pose and face, and a fake voice for the mouth.

There is also a standalone three.js preview with no build step, [`preview/index.html`](preview/index.html): run `python3 -m http.server 8000` in the repository root and open http://localhost:8000/preview/. It can lip-sync Otto to any audio file you pick.

Checks: `cd server && .venv/bin/python -m pytest` and `cd web && npm run build`.

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
- Otto's mouth bars follow its real voice while it speaks: a Web Audio `AnalyserNode` on the speech player (`SpeechPlayer.bands()` in `web/src/otto/audio.ts`) feeds `OttoScene.tsx` every frame. The speech bubble types the transcript at a fixed pace (`SPEAK_CPS`), so it can run slightly ahead of or behind the voice.
- "Hey Otto" uses the browser's speech recognition. In Chrome and Edge that sends microphone sound to the browser maker while it listens. It is off until the visitor turns it on, and a banner shows whenever it is listening.

## Otto's robot

Otto is our own model, built from primitives by [`blender/build_otto.py`](blender/build_otto.py): a chunky graphite bot with a big rounded head, a glossy black visor, rounded-square eyes, side pods, five small mouth bars that act as its voice meter, and a short standing body with stubby arms.

| Layer | Where | What it does |
|---|---|---|
| Model | `blender/build_otto.py` (Blender, bpy) | Builds the mesh, names every moving part, exports `web/public/otto/otto.glb` |
| Scene | `web/src/otto/robot/OttoScene.tsx` (React Three Fiber, three.js, postprocessing) | Lighting, bloom on the glowing parts, and every animation |
| Wrapper | `web/src/otto/robot/OttoRobot.tsx` | Loads the scene after the page, shows the speech bubble, draws nothing without WebGL |
| Faces | `web/src/otto/robot/robot.ts` | Eye shapes and glow colours for happy, searching, excited, alert and resting |

To change the model, edit the script and run it again, keeping the node names listed at its top (the app finds parts by name):

```bash
python3 -m venv .blender && .blender/bin/pip install bpy==5.3.0
.blender/bin/python blender/build_otto.py                      # writes web/public/otto/otto.glb
.blender/bin/python blender/build_otto.py --render otto.png    # and a Cycles render to check it
```

With **Blender MCP**, open Blender with the add-on connected and ask Claude to run `blender/build_otto.py` (its `execute_blender_code` tool), then tweak the model live and export again from File → Export → glTF 2.0 (.glb), "Apply Modifiers" on.

### Gestures

Otto has six short gestures: `welcomeWave`, `goodbyeWave`, `celebrate`, `nod`, `headShake` and `thinkingHand` (held while thinking). They are defined once in [`web/src/otto/robot/gestures.js`](web/src/otto/robot/gestures.js), a plain module that the app and [`preview/`](preview/index.html) both load. The lifecycle mapping (which gesture plays on connect, disconnect, turn end and error), the intensity, the cooldown and reduced motion are in the `GESTURE_SETTINGS` block of [`web/src/otto.config.ts`](web/src/otto.config.ts). With `enabled: false`, Otto stays still.

To play one from your own code, make a channel once and pass it to `<Otto>`:

```tsx
const gestures = useMemo(createGestureChannel, [])
<Otto gestures={gestures} /* ... */ />
gestures.play('celebrate')
```

## Deploying

- **Server**: any host that supports WebSockets (Render, Railway, Fly). Set `GEMINI_API_KEY` and `CORS_ORIGINS` (your site's exact origin; no wildcards). Free tiers sleep, and the panel shows "Waking Otto up" while the server starts.
- **Web**: any static host. Set `VITE_API_URL` to the server's URL before `npm run build`.

## Where it came from

The voice guide, the panel and the robot wiring come from the NASA Earth Jukebox (2026 NASA Space Apps Challenge). The voice guide was first ported from the FinAssist voice assistant. The jukebox-only parts (player, sound map, data sets, weather and Planetary Computer tools) are left out.
