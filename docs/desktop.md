# Desktop companion development

Otto's desktop runtime is a Tauri v2 shell around the existing React application. The native host is the only component allowed to perform desktop actions; browser mode keeps the same web experience and reports desktop actions as unavailable.

## Local checks

From `web/`:

```bash
npm test
npm run build
npm run desktop:check
npm run desktop:test
```

For a development desktop window:

```bash
npm run desktop:dev
```

For a release bundle:

```bash
npm run desktop:build
```

The Tauri build uses the same `web/dist` output as the normal web build. Set `VITE_API_URL` to the reachable Otto server origin when the packaged application needs to connect to a remote server.

## CI and packaging

`.github/workflows/desktop.yml` runs the web tests/build plus native Rust checks on Ubuntu, Windows and macOS. The packaging job then builds a Tauri bundle on each platform and uploads the generated bundle as a workflow artifact.

The workflow deliberately does not require a Gemini API key: packaging and runtime-boundary tests exercise the shell without opening a live voice session.

## Permission and runtime boundary

The desktop host exposes a closed action enum and asks the visitor for confirmation inside the native command before execution. Supported actions are limited to:

- minimize/restore Otto
- move Otto to the centre, left, right, top or bottom of the current monitor
- launch Calculator
- launch Text Editor

Movement uses the current monitor work area, including monitors with negative desktop coordinates. Application launch reports process dispatch, not proof that the launched application's window is ready. A movement is not reported as successful solely because the native API accepted it: the bridge takes a fresh metadata-only desktop observation and compares Otto's final position with the requested named destination. If that observation does not match, the bridge repeats the read-only observation once; it never repeats the action. A missing observation, or a second mismatch, is returned as a verification failure. Application launch remains explicitly `process_spawned` because the current contract does not observe whether the launched application's window became ready.

Desktop awareness is separate from microphone consent. When enabled during a conversation it exposes only the bounded metadata already defined by the desktop contract; it does not capture screenshots, keystrokes, process ids or executable paths.

## Troubleshooting

- If `desktop:check` or `desktop:test` fails on Linux, install the Tauri WebKitGTK/system packages used by the CI workflow.
- If `desktop:build` cannot find native build tools, install the platform's Rust/Tauri prerequisites and retry.
- If the packaged application starts but cannot reach Otto, check `VITE_API_URL` and the server's network accessibility.
- Browser mode does not require Tauri and remains supported through the normal Vite commands.
