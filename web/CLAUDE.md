# web/CLAUDE.md — the frontend

React 19, TypeScript, Vite, Tailwind 4, zod, Vitest and Playwright. Otto's robot is a vendored WebGL 2 shader with no 3D library (D-12). Every rule in the root [CLAUDE.md](../CLAUDE.md) still applies. This file adds the map. For a task, start from its row in the [routing table](../docs/README.md).

## Commands

```bash
npm ci
npm run dev            # http://localhost:5173; /lab.html and /preview/ need no key or server
npm test               # Vitest: unit tests, plus the layer rule (src/otto/layers.test.ts)
npm run typecheck      # tsc -b, the strictest static check (there is no linter)
npm run build          # tsc -b && vite build
npm run build:lib      # the three package entry points, then scripts/check-dist.mjs
npm run test:e2e       # Playwright on Chromium against the lab (port 5199, software WebGL)
```

Run `build:lib` whenever `element/`, `react/`, `gemini/` or the public API changes.

## Layout (`src/`)

| Path | What it is |
|---|---|
| `otto.config.ts` | **This app's** pages, commands and Otto overrides. Must match `server/app/voice/app_config.py` and the `tools.py` literals (D-03) |
| `App.tsx`, `main.tsx` | The demo host app and its `onAction`. The kit never imports these |
| `lab.tsx`, `lab/` | The lab: `fakeServer.ts` speaks the real wire protocol with no key; `EmbodiedSandbox.tsx` |
| `components/originkit/ui/clay-robot.tsx` | The vendored robot. Every change carries an `Otto:` comment (D-10) |
| `otto/` | The kit (below) |

### The kit (`src/otto/`)

The files are split into **core** (pure rules and data: no React, no packages, no browser globals, no app config, imports only core) and **shell** (React, adapters, the DOM) (D-13). The list of core files is `CORE` in `otto/layers.test.ts`; that test is the authority. A new rule goes in a core file with a test, and its hook sits beside it as `useX.ts` (like `movement/stage.ts` and `useStage.ts`).

| Area | Files |
|---|---|
| Voice session and wire protocol | `useVoiceAssistant.ts` (the WebSocket, mic upload, the start, page and context messages), `messages.ts` (**`messageSchema` and `toAssistantAction`: every server message is checked here, D-02**), `micDiagnostic.ts` (core: `MIC_REQUEST`, and what the lab's microphone check reports), `audio.ts` (16 kHz up, 24 kHz playback clock, barge-in), `speechGate.ts` |
| Panel and consent | `VoiceAssistant.tsx`, `ui.tsx`, `consent.ts`, `wakeWord.ts` / `useWakeWord.ts` (off by default, D-08), `voice.css` |
| The robot | `Otto.tsx`, `OttoStage.tsx`, `OttoDock.tsx`, `robot/` (`OttoRobot.tsx`, `ClayScene.tsx`, `robot.ts` faces, `gestures.ts`), `mouth.ts` (lip-sync), `movement/` (`stage.ts`, `useStage.ts`), `idle.ts` |
| Sound | `sound.ts`, `soundCues.ts`, `useGestureSounds.ts`. Synthesised with Web Audio, no files, nothing before a gesture (D-11) |
| Awareness | `awareness/`: `events.ts` (the event bus), `reactions.ts`, `avatar.ts`, `environmental.ts`, `busy.ts`, `page.ts` + `collectPage.ts` (the privacy-filtered page snapshot, D-17) |
| Guidance | `guidance/`: `guide.ts`, `task.ts` (the only task state), `help.ts` (core), plus `runner.ts`, `targets.ts`, `observe.ts`, `friction*.ts`, `spotlight.ts`, `hidden.ts` |
| Context | `context.ts`, `contextBudget.ts`, `runtimeId.ts` |
| Capture and gestures | `capture.ts`, `useScreenShare.ts`, `ScreenShare.tsx` (D-21), `gesture-control/` (local hand tracking, D-31) |
| Desktop | `desktop.ts`: the Tauri bridge, consent receipts (D-24, D-25); the host is in `../src-tauri/` |
| Config | `config.ts` (core defaults), `useOttoConfig.ts`, `storage.ts` |
| Packages | `element/` (`<otto-mascot>`, `createOtto`), `react/` (`otto-mascot/react`), `gemini/` (`otto-mascot/gemini`; `transports.ts` refuses raw keys, D-01) |
| Archived | `sign/`, `signRecognition.ts` (retired pilot; don't extend) |

## Package entry points (D-12, D-15)

`package.json` `exports`: `.` → `dist-lib/otto-mascot.js`, `./react` → `react.js`, `./gemini` → `gemini.js`. React is a peer and is never bundled into `react.js`. `gemini.js` never imports React or the element. The element never reaches `otto.config.ts`. `scripts/check-dist.mjs` proves all of this after `build:lib`.

## Changing the wire protocol

A message type lives in four places, and all of them change in one PR:

- the `route.py` docstring and `bridge.py` (server);
- `messageSchema` in `messages.ts`;
- the handler in `useVoiceAssistant.ts`;
- `lab/fakeServer.ts`.

Binary frames stay 16 kHz mono PCM16 up and 24 kHz mono PCM16 down.

## Tests

- **Unit:** a `*.test.ts` beside the file it tests. Core files get pure tests with no DOM.
- **Browser:** `e2e/` (`lab`, `mascot`, `guidance`, `embodied`, `share`; `sign` is archived) runs against `lab.html` with the fake server. In a container, use `PLAYWRIGHT_CHROMIUM=/path/to/chrome`.
- **Leaks:** `<otto-mascot>` must survive 20 mount and unmount cycles with every audio node, frame loop, listener and WebGL context released.
