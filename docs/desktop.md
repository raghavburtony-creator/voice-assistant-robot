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

## Planned: Otto as a desktop personal assistant (E7)

Planned work, not shipped behaviour. The brief is [upgrade.md](../upgrade.md); the slices and milestones are in [roadmap.md](roadmap.md#e7-desktop-personal-assistant), and the open decisions are Q-11, Q-12 and Q-13 in [decisions.md](decisions.md). Until those are answered, D-24 and D-25 above still bind.

### What is wrong today

- **Window behaviour.** `tauri.conf.json` makes one 420×640 window with `alwaysOnTop: true` and `decorations: false`, and nothing in the app draws a title bar, a drag region or minimise, maximise and close buttons. Otto floats over every application instead of behaving like one.
- **No view of other windows.** The host can act only on Otto's own window, and reads the foreground window on Windows only. On Linux, desktop awareness reports the monitor, Otto's window and the cursor.
- **Wayland position.** GNOME Wayland does not give a client its own window position, so `otto.x`/`otto.y` are null and move verification in `desktop.ts` cannot pass there.

### Window model (0.4)

| Mode | Behaviour |
|---|---|
| Full | A normal decorated application window: taskbar entry, focus, minimise, maximise, restore, close, stacked by the window manager like any other app. Never on top unless the visitor asks. |
| Compact | A small second window with Otto and the voice controls. The visitor may pin it on top; the model can't. |

Size, position and mode are saved by the host between runs.

### Which session works

| Session on GNOME (Zorin OS 18.1, GNOME 46) | Listing and moving other windows |
|---|---|
| Wayland (the default) | Only through the Otto GNOME Shell extension. X11 tools (`xdotool`, `wmctrl`) see XWayland clients only, `org.gnome.Shell.Eval` is disabled, and `org.gnome.Shell.Introspect` is read-only and allow-listed. |
| Xorg ("Zorin OS on Xorg" at login) | Through the same extension. No second backend is planned. |
| Other desktops (KDE, wlroots), Windows, macOS | Not planned for E7; the shell (0.4) must not regress there. |

### Window management architecture (0.5)

1. **Otto GNOME Shell extension** (GJS, ES modules, GNOME 46 and later): runs inside the shell, reads `Meta.Window` (frame rect, WM class, title, workspace, monitor, focus, minimised or maximised) and performs `activate`, `move_resize_frame`, `minimize`, `maximize`, `unmaximize`, `delete` and workspace moves. It exports these on the session D-Bus and emits a signal when windows change. It is written for Otto; [gnomelets](https://github.com/raghavburtony-creator/gnomelets) is a design reference only (GPL-3.0, see [source-attribution.md](source-attribution.md)). Enabling a newly installed extension on Wayland needs a logout and login.
2. **Tauri host:** a `zbus` client reads `DesktopState` (monitors, workspaces, windows, Otto's own window) and computes what changed since the previous read. Window ids are opaque handles valid only until the window closes.
3. **Server and browser:** `desktop_observe` and `desktop_window` are checked tools on the server (closed kinds, an id from the latest observation, a closed layout vocabulary such as `left_half` or `beside`), and `toAssistantAction` checks the action again. The model never sends coordinates from free text.
4. **Observe → act → verify:** every action reads the state, acts, reads again and compares with what was asked, re-reads once on a mismatch, and otherwise returns a verification failure that Otto says out loud. This generalises the shipped move check (`verifyDesktopMovement`).

### Memory on the desktop (0.6)

Persistent memory already exists on the server (`memory_service.py`, SQLite) but switches on only with a trusted-proxy identity (D-26), which the desktop companion doesn't have. Q-12 proposes an opaque owner identity created by the Tauri host. See [roadmap.md](roadmap.md#06-personal-memory-blocked-by-q-12).

## Troubleshooting

- If `desktop:check` or `desktop:test` fails on Linux, install the Tauri WebKitGTK/system packages used by the CI workflow.
- If `desktop:build` cannot find native build tools, install the platform's Rust/Tauri prerequisites and retry.
- If the packaged application starts but cannot reach Otto, check `VITE_API_URL` and the server's network accessibility.
- Browser mode does not require Tauri and remains supported through the normal Vite commands.
- **Planned (E7):** if window management reports the extension as missing, install and enable it, then log out and in again. `gnome-extensions list --enabled` shows whether GNOME has loaded it.
