# Echo voice kit

A starter kit for adding **Echo**, a 3D robot voice guide, to a web app. You talk to Echo (or type), it answers out loud with Gemini Live, and it can act on the page: open a page, run one of your app's commands, read what is on screen. Taken out of the NASA Earth Jukebox and made generic.

- **Web** (`web/`): React, TypeScript and Vite. The robot, the voice panel, "Hey Echo", consent, push-to-talk or open mic, a text fallback.
- **Server** (`server/`): FastAPI and Google ADK. It holds the Gemini session and the API key, and runs Echo's tools.

> **Keep this repository private.** The robot (`web/public/robot/`) belongs to the myt Learning Hub and has no open-source licence. Read [`web/public/robot/README.md`](web/public/robot/README.md) before you use it in a new project.

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

Click the robot, or press **Alt+E**, and say "Take me to About" or "Show me a message".

Checks: `cd server && .venv/bin/python -m pytest` and `cd web && npm run build`.

## Using it in a new project

The two files you edit every time are the two config files. Their page and command lists must match (a server test checks it).

| What | Web | Server |
|---|---|---|
| Echo's name, your pages, your commands | `web/src/echo.config.ts` | `server/app/voice/app_config.py` |
| What Echo knows and how it speaks | | `app_config.py`: `PAGES`, `FAQ`, `APP_DESCRIPTION`, `system_instruction()` |
| What Echo can do | `App.tsx` `onAction` | `server/app/voice/tools.py` |

In your app:

```tsx
import { Echo, useAssistantContext, type AssistantAction } from './echo'

// Once, near the top of the app. `page` is the visitor's current page id.
<Echo page={page} onAction={(action: AssistantAction) => {
  if (action.action === 'navigate') router.push(action.page)
  else if (action.name === 'toggle_theme') toggleTheme()
}} />

// In any component: tell Echo what is on screen. It reads this with get_screen_context.
useAssistantContext('cart', { items: 3, total: 'Rs 450' })
```

Copy `web/src/echo/`, `web/src/echo.config.ts`, `web/public/robot/` and `server/app/voice/` into the new project, or start from this repository.

### Adding a tool

1. Write the function in `server/app/voice/tools.py` and add it to `TOOLS`. Check every argument: the model's output is untrusted.
2. If it changes the page, return an action through `_send(...)`, for example `{"action": "command", "name": "open_cart"}`.
3. Allow that action in the browser: add the command to `COMMANDS` in both config files (and to the `Command` type in `tools.py`), or, for a new kind of action, add a variant to `AssistantAction` in `web/src/echo/messages.ts`.
4. Handle it in your `onAction`, and describe it in `COMMAND_LABELS` so the panel's "Echo did" list says what happened.
5. Tell Echo when to use it in `system_instruction()`.

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
- The robot is only a picture. It is hidden from screen readers; the panel shows everything Echo says as text.
- The robot's chest bars follow Echo's real voice while it speaks (`SpeechPlayer.bands()` in `web/src/echo/audio.ts`). The speech bubble types the transcript at a fixed pace (`SPEAK_CPS`), so it can run slightly ahead of or behind the voice.
- "Hey Echo" uses the browser's speech recognition. In Chrome and Edge that sends microphone sound to the browser maker while it listens. It is off until the visitor turns it on, and a banner shows whenever it is listening.

## Deploying

- **Server**: any host that supports WebSockets (Render, Railway, Fly). Set `GEMINI_API_KEY` and `CORS_ORIGINS` (your site's exact origin; no wildcards). Free tiers sleep, and the panel shows "Waking Echo up" while the server starts.
- **Web**: any static host. Set `VITE_API_URL` to the server's URL before `npm run build`.

## Where it came from

The voice guide, the panel and the robot wiring come from the NASA Earth Jukebox (2026 NASA Space Apps Challenge). The voice guide was first ported from the FinAssist voice assistant. The jukebox-only parts (player, sound map, data sets, weather and Planetary Computer tools) are left out.
