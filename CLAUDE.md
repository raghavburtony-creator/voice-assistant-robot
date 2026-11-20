# CLAUDE.md

Project: **Otto voice kit**, a starter kit that adds Otto, a clay robot voice guide, to a web app. Otto listens, answers out loud with Gemini Live, and acts on the page through checked tools.

## Read these first

| Doc | Authority |
|---|---|
| [docs/decisions.md](docs/decisions.md) | **Wins over every other doc** where it states a decision (`D-xx`) or leaves one open (`Q-xx`). |
| [README.md](README.md) | Source of truth for behaviour: how Otto works, the config surface, the `<otto-mascot>` API. |
| [docs/README.md](docs/README.md) | The routing table: what to load for a task. Load only the rows your task needs. |
| Code comments | Explain why a line is the way it is. They lose to the docs above when they disagree. |

If two docs disagree and `docs/decisions.md` is silent, follow the order above, add a `Q-` entry describing the conflict, and continue. Never pick silently.

## Rules for code

- **The model's output is untrusted.** Every tool argument is checked on the server (`server/app/voice/tools.py`), and every action is checked again in the browser (`toAssistantAction` in `web/src/otto/messages.ts`) (D-02).
- **The Gemini key never reaches the browser** (D-01). No `VITE_` variable holds a secret. `CORS_ORIGINS` is an explicit list; no wildcard (D-09).
- **Two configs, one list.** Pages and commands live in `web/src/otto.config.ts` and `server/app/voice/app_config.py`, plus the `PageId` and `Command` literals in `tools.py`. Change all of them together; `server/tests/test_voice.py` checks they match (D-03).
- **The wire protocol has two ends.** A message type added in `server/app/voice/bridge.py` or `route.py` needs its schema in `messageSchema` in `web/src/otto/messages.ts`, and the reverse. Both ends ship in the same change.
- **Live audio is billed per minute.** Keep the session caps (`max_session_seconds`, `max_sessions` in `server/app/config.py`) (D-04).
- **Otto is decorative.** The robot is hidden from screen readers. Everything he says or does is also in the panel as text (D-06).
- **Reduced motion:** body motion and walking stop (he snaps); the mouth still moves (D-07).
- **No sound before a user gesture.** Cues are synthesised with Web Audio; no audio files (D-11).
- **Nothing leaks.** Stop and disconnect audio nodes, cancel frame loops, remove listeners and release the WebGL context on unmount. `<otto-mascot>` must survive 20 mount and unmount cycles clean.
- **Layers (D-13).** In `web/src/otto/`, *core* files are pure rules and data: no React, no packages, no browser globals, no app config, and they import only core. The list is `CORE` in `web/src/otto/layers.test.ts`. Everything else in the kit is *shell* (adapters and React) and may read `otto.config.ts`. The kit never imports `App.tsx`, `main.tsx` or the lab, and `<otto-mascot>` never reaches `otto.config.ts`. A new rule goes in a core file with a test; its hook goes beside it as `useX.ts` (like `movement/stage.ts` and `useStage.ts`).
- **The vendored robot.** `web/src/components/originkit/ui/clay-robot.tsx` is Originkit's component. Mark every change with an `Otto:` comment so it can be re-applied after `npx originkit add clay-robot` (D-10).
- **Pinned where it matters.** `google-genai` and `google-adk` are pinned exactly in `server/requirements.txt`; keep them pinned and check an API against that version before using it. Never write "latest".
- Don't invent config keys, message types, tools or library APIs that aren't in the code or the docs. Mark an unavoidable guess `// ASSUMPTION:` (or `# ASSUMPTION:`) and report it.

## Checks

```bash
cd server && .venv/bin/python -m pytest
cd web && npm test && npm run typecheck && npm run build
cd web && npm run build:lib   # when element/, react/, gemini/ or the public API changes; ends with scripts/check-dist.mjs
cd web && npm run test:e2e    # Playwright in Chromium; first run: npx playwright install chromium
# A Chromium already on the machine instead of Playwright's download: PLAYWRIGHT_CHROMIUM=/path/to/chrome npm run test:e2e
```

To try the robot without a key, use `npm run dev` and open `/lab.html` (every part, plus a simulated Gemini server) or `/preview/` (the `<otto-mascot>` playground).

## Git workflow

- All work happens on a branch (`feat/…`, `fix/…`, `docs/…`) and reaches `main` through a pull request. Review it with `/otto-pr-review`.
- Never commit or push directly to `main`.
- Agents may create branches and commit locally. Pushing and opening PRs happen only when the user asks.

## Agents and skills

Project agents live in `.claude/agents/` and skills in `.claude/skills/`. Agents work on their own: they don't stop to ask, they make the smallest reasonable choice and report their assumptions.

| Skill | Does |
|---|---|
| `/otto-orchestrate <task> [--rounds N] [--commit]` | plans the task into small units, runs `otto-worker` agents in parallel (haiku, sonnet or opus per unit), checks them with the tests and then the reviewers, and sends findings back to the same workers until the review passes (at most 3 rounds). For multi-part work |
| `/otto-implement <task> [--commit] [--no-review]` | otto-implementer (with otto-voice-engineer for audio work), then otto-code-reviewer with fixes, otto-design-reviewer for UI, robot or sound changes, and otto-docs-keeper when docs must follow |
| `/otto-code-review [paths] [--fix] [--deep]` | otto-code-reviewer; `--deep` adds the language, security, performance and accessibility reviewers |
| `/otto-pr-review <n> [--comment]` | otto-pr-reviewer on a GitHub PR; `--comment` posts the review |
| `/otto-design-review [target] [--fix]` | otto-design-reviewer, with otto-voice-engineer when sound changed |
| `/otto-docs-sync [change]` | otto-docs-keeper: README sections, the routing table, decisions, links |

Project agents: `otto-implementer`, `otto-worker` (one scoped unit, for `/otto-orchestrate`), `otto-code-reviewer`, `otto-pr-reviewer`, `otto-design-reviewer`, `otto-voice-engineer`, `otto-docs-keeper`.

The orchestrator is a skill, not an agent: a sub-agent can't start other sub-agents, so orchestration has to run in the main session.

**Imported from ECC 2.2.3 (MIT, with a project note added):** `typescript-reviewer`, `react-reviewer`, `python-reviewer`, `fastapi-reviewer`, `security-reviewer`, `performance-optimizer`, `a11y-architect`. They ship in this repo, so they work without the ECC plugin. License: `.claude/THIRD_PARTY_LICENSES/ecc.txt`. To update one, copy the new upstream file and put the project note back under its frontmatter.

## Layout

```
server/          FastAPI + Google ADK: the Gemini Live session, the key, Otto's tools
  app/config.py        settings: key, CORS, session caps
  app/voice/           route (WebSocket), bridge (browser <-> ADK), tools, sink, app_config
  tests/               pytest: protocol, tools, config parity
web/             React 19 + TypeScript + Vite
  src/otto.config.ts   this app's pages, commands and Otto overrides
  src/otto/            the kit: voice panel and hook, audio, mouth, sound, idle, consent, wake word
    robot/             scene, wrapper, faces, gestures
    movement/          the stage Otto walks on
    awareness/         app events -> reactions
    guidance/          showing the visitor things: rules and tasks (core), targets and the runner (shell)
    element/           the <otto-mascot> web component
    react/             otto-mascot/react: <OttoMascot>, useOtto
    gemini/            otto-mascot/gemini: the Gemini Live voice bridge
  src/components/originkit/ui/clay-robot.tsx   vendored WebGL 2 robot (Otto: changes marked)
  src/lab/, lab.html   the lab and its fake voice server
  preview/             the <otto-mascot> playground
  e2e/                 Playwright browser tests (lab, mascot)
  scripts/             check-dist.mjs: proves the library's entry points stay separate
docs/            routing table and decisions
```
