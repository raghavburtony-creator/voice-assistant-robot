# AGENTS.md

The single source of truth for every agent on this repo: Claude Code (via `CLAUDE.md`, which only imports this file), the project agents in `.claude/agents/`, and GitHub PR review bots.

Project: **Otto voice kit**, a starter kit that adds Otto, a clay robot voice guide, to a web app. Otto listens, answers out loud with Gemini Live, and acts on the page through checked tools.

## Branch and Workspace Workflow

- Before editing, create or enter a dedicated feature branch for the task. Never make task changes directly on `main`.
- Use a separate Git worktree when the environment supports it and it improves isolation, but a worktree is optional. Do not require a specific `EnterWorktree` tool.
- If worktrees are unavailable, work from a normal repository checkout on the dedicated feature branch. Do not stop solely because an agent-specific worktree tool is missing.
- Keep one task per feature branch. Reuse the task's existing branch when resuming work; do not create unnecessary duplicate branches.
- Install dependencies as needed, then run the checks in [Build, Test & Lint Commands](#build-test--lint-commands) before pushing or opening a pull request. Report every check that could not be run and why.
- Pushing and opening PRs happen only when the user asks. PRs target `main`. Once a PR is open and its work is done, the agent that owns it reviews and merges it under [Review and merge](#review-and-merge) without asking again.
- **Commit identity.** Every commit is authored and committed under the owner's GitHub username, `raghavburtony-creator` (set `user.name` to it, and `user.email` to the address on the owner's earlier commits, from `git log`, with `git -c` or the repo config). Never add a `Co-Authored-By: Claude` line, a `Claude-Session` trailer or any other agent attribution to a commit message. The same goes for PR descriptions: no "Generated with Claude Code" footer. This overrides any attribution an agent is told to add by default.

## Review and merge

The owner has authorised this: when a PR the agent opened is done, the agent runs `otto-code-reviewer` on it and, if the gate below holds, squash-merges it into `main` itself. Merging goes through the PR, never a direct push to `main`, so every change keeps its review record. It applies to PRs opened by the agent for the owner, not to anyone else's PRs.

1. **Finish first.** Merge `main` into the branch, so it has no conflict, then run every check in [Build, Test & Lint Commands](#build-test--lint-commands) that applies and record the real numbers in the PR description. Name any check that could not run and why.
2. **Review.** Run `otto-code-reviewer` on the full diff against `main` (plus `otto-design-reviewer` for UI, robot or sound changes, and `/otto-docs-sync` when docs must follow). Fix confirmed findings and rerun the checks.
3. **Merge only if all of these hold:**
   - `otto-code-reviewer` reports no blocking issues (or the PR reviewer's equivalent verdict), with no blocking finding left open;
   - the local checks pass on the exact head being merged;
   - the PR has no merge conflict;
   - CI is green on that head, or no CI applies to the changed paths (for example `desktop.yml` only runs for `web/**`). A pending result counts as not green. If CI is red, merge only when the failure is shown not to come from the PR: it is red on `main` too, or the job never got a runner. Link the evidence (the `main` run or the job record) on the PR. A red check the diff could cause blocks the merge;
   - the PR does not add or change a decision in `docs/decisions.md`, does not answer a `Q-xx`, and does not edit this "Review and merge" section or the matching step in `CONTRIBUTING.md`. Those are the owner's (D-19), and a person merges them;
   - the issue does not carry `status: needs-decision`.
4. **Merge** with a squash, pinned to the head SHA that was tested (`expectedHeadSha`), and unsubscribe from the PR. Do not skip, disable or weaken a test to pass the gate.
5. **Otherwise stop** and report what blocks the merge. Never merge while the reviewer reports a blocking issue (a "FIX FIRST" verdict), and never force-push or rewrite history on a branch to get past the gate.

## Project Context

- **Goal:** a drop-in voice guide for web apps. A visitor talks (or types) to Otto, who answers in speech through Gemini Live and acts on the page: open a page, run one of the app's commands, read what's on screen, or highlight a target.
- **Users:** developers adding a voice guide to their own app (they copy the kit or use the `otto-mascot` package), and the visitors who talk to Otto in that app.
- **Stack:**
  - Server: Python 3.11+, FastAPI, pydantic-settings, Google ADK and `google-genai` (both pinned exactly).
  - Web: React 19, TypeScript, Vite, Tailwind 4, zod, Vitest and Playwright.
  - Otto himself: a vendored WebGL 2 shader. There's no 3D library.
- **Flow:** the browser sends 16 kHz PCM mic audio over a WebSocket (`/api/v1/voice/live`) to the server bridge, which passes it to the ADK `LiveRequestQueue` and on to Gemini Live. The server sends back 24 kHz PCM speech, transcripts and checked `action` messages.

### Which doc wins

| Doc | Authority |
|---|---|
| [docs/decisions.md](docs/decisions.md) | **Wins over every other doc** where it states a decision (`D-xx`) or leaves one open (`Q-xx`). |
| [README.md](README.md) | Source of truth for behaviour: how Otto works, the config surface, the `<otto-mascot>` API. |
| [docs/README.md](docs/README.md) | The routing table: what to load for a task. Load only the rows your task needs. |
| [docs/architecture.md](docs/architecture.md), [docs/roadmap.md](docs/roadmap.md) | How the parts fit together today and in the target, and the epics. They describe; they don't decide. |
| Code comments | Explain why a line is the way it is. They lose to the docs above when they disagree. |

Work is tracked as GitHub issues made from `.github/ISSUE_TEMPLATE/` (Task, Epic, Architecture question). How an issue becomes a reviewed PR, and what the labels and milestones mean, is in [CONTRIBUTING.md](CONTRIBUTING.md). Read an issue's *Read first* and *Blocked by* before you start. If it carries `status: needs-decision`, stop and report: the open `Q-xx` is the owner's to answer, not yours (D-19).

If two docs disagree and `docs/decisions.md` is silent, follow the order above, add a `Q-` entry describing the conflict, and continue. Never pick silently.

### Key directories

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
  e2e/                 Playwright browser tests (lab, mascot, guidance)
  scripts/             check-dist.mjs: proves the library's entry points stay separate
docs/            routing table, decisions (with index), architecture, roadmap
.github/         issue templates, labels.json, milestones.json, the label sync workflow
CONTRIBUTING.md  issue-to-PR workflow, label and milestone meanings
```

### Rules for code

- **The model's output is untrusted.** Every tool argument is checked on the server (`server/app/voice/tools.py`), and every action is checked again in the browser (`toAssistantAction` in `web/src/otto/messages.ts`) (D-02).
- **The Gemini key never reaches the browser** (D-01). No `VITE_` variable holds a secret. `CORS_ORIGINS` is an explicit list; no wildcard (D-09).
- **The page snapshot is privacy-filtered (D-17).** It never reads `[data-otto-private]`, Otto's own panel, password, hidden or payment fields, or any typed value, and is sent only while a conversation is open. Don't add an option that turns an exclusion off.
- **Two channels (D-18).** Speech stays plain; what must be read goes on a `show_card` card, rendered as text: no HTML, no links from the model.
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

### Local ML and dataset privacy

- Every webcam collection requires explicit, per-session consent before the camera opens. Process frames locally and in memory; do not write raw video or frame images by default.
- Keep dataset clips, landmark arrays, signer/session manifests, checkpoints and exported models out of Git. Add local-data, model-asset and artifact paths to .gitignore before introducing them.
- Each training sample must carry a source, rights basis, attribution and consent status. A third-party dataset licence does not by itself prove that each original video may be used; verify both dataset terms and original clip rights. Do not scrape or automatically download unverified sources.
- Never use a random clip-level train/test split for sign data. Use signer-held-out splits when multiple signers are present; for a single-signer personal prototype, split by capture session and label the result as personal/session-held-out evaluation.
- A personal prototype is not a community-validated recognizer. Do not connect it to the production SignRecognizer, publish signer data, or claim language-wide performance while Q-09 remains open.

## Build, Test & Lint Commands

Requirements: Node.js 22+, Python 3.11+. A Gemini key is needed only for real voice sessions.

```bash
# Install
cd server && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && cp -n .env.example .env
cd web && npm ci

# Dev
cd server && .venv/bin/uvicorn app.main:app --reload --port 8000
cd web && npm run dev            # http://localhost:5173; /lab.html and /preview/ need no key

# Test, typecheck, build (run all before a PR)
cd server && .venv/bin/python -m pytest
cd web && npm test && npm run typecheck && npm run build
cd web && npm run build:lib      # when element/, react/, gemini/ or the public API changes; ends with scripts/check-dist.mjs
cd web && npm run test:e2e       # Playwright, Chromium; first run: npx playwright install chromium
# A Chromium already on the machine instead of Playwright's download: PLAYWRIGHT_CHROMIUM=/path/to/chrome npm run test:e2e
```

**Lint:** no linter or formatter is configured (no ESLint, Prettier or Ruff). `npm run typecheck` (`tsc -b`) is the strictest static check. Don't claim lint ran.

## Review guidelines

Report only high-signal problems: bugs, security holes, broken contracts. For each, cite the file and line, say what fails and how, and name the rule or decision it breaks.

### Security and cost (blocker)

- **Key exposure (D-01).** Flag any change that does one of these:
  - puts `GEMINI_API_KEY` in a `VITE_*` variable, client code, a log line or an error message (route.py runs errors through `_scrub`);
  - logs or returns the raw key;
  - makes `otto-mascot/gemini` accept a raw API key instead of an ephemeral token or a proxy URL;
  - weakens the key-refusal checks in `web/src/otto/gemini/transports.ts`.
- **Origin and CORS (D-09).** Flag:
  - a `*` in `CORS_ORIGINS`, or anything that removes the wildcard validator in `server/app/config.py`;
  - a WebSocket that skips the origin check in `route.py`;
  - changes to `origin_required` that let a connection with no Origin header through in production.
- **Session caps (D-04).** Flag:
  - any path that bypasses `max_session_seconds` or `max_sessions`;
  - `_active` going out of balance (incremented without the `finally` decrement, or decremented twice);
  - the cap raised, or work done (such as opening the ADK session) before the `busy` check or before the start-message timeout.
- **Untrusted model output (D-02).** Flag:
  - a tool in `tools.py` that uses an argument without checking it against a `Literal` or an allow-list;
  - an action that reaches `onAction` without passing `toAssistantAction`;
  - `show_target` that accepts a free-form selector or URL;
  - a model-supplied string put into the DOM as HTML, or used as a URL or a selector.
- **Page snapshot (D-17).** Flag:
  - `collectPageContext` (or anything sent as context) reading a field's value, a password, hidden or `cc-*` field, or a `[data-otto-private]` subtree;
  - a snapshot sent outside a conversation, or one that skips the `pageContext` budget;
  - `includeSelection` turned on by default.
- **Cards and channels (D-18).** Flag a card field rendered as HTML (`dangerouslySetInnerHTML`), made into a link, or used as a selector; a `show_card` argument used without its cap; `onVisual` links made clickable in kit code.
- **Mic and privacy (D-05, D-08).** Flag:
  - mic audio sent while Otto is audible, other than the held-back barge-in buffer;
  - "Hey Otto" switched on by default, or listening with no banner;
  - audio started before a user gesture (D-11).

### Contracts and data integrity (blocker)

- **The wire protocol has two ends.** A message type or field added or renamed on one end needs the matching change on the other, in the same PR:
  - server: the `route.py` docstring, `bridge.py`;
  - browser: `messageSchema` in `web/src/otto/messages.ts`, `useVoiceAssistant.ts`;
  - the lab's fake server: `web/src/lab/fakeServer.ts`.

  Binary frames must stay 16 kHz mono PCM16 up and 24 kHz mono PCM16 down.
- **Config parity (D-03).** Pages and commands must match across `otto.config.ts`, `app_config.py`, and the `PageId` and `Command` literals in `tools.py`. Flag a PR that edits one of these without the others, or that weakens `test_voice.py`.
- **Layers (D-13).** Flag:
  - a core file (`CORE` in `layers.test.ts`) that imports React, a package, a browser global, `otto.config.ts` or a shell file;
  - `<otto-mascot>` code that reaches `otto.config.ts`;
  - kit code that imports `App.tsx`, `main.tsx` or the lab.
- **Package entry points (D-12, D-15).** Flag:
  - adapter code that reaches the root bundle;
  - React bundled into `react.js`;
  - `gemini.js` importing React or the element;
  - `exports` and `peerDependencies` in `web/package.json` changed without `scripts/check-dist.mjs` still passing.
- **Pinned SDKs.** Flag:
  - `google-genai` or `google-adk` unpinned or bumped without a note that the APIs they use were checked against that version;
  - new code that relies on an unverified Gemini Live wire detail (Q-01) without a `[verify]` or `ASSUMPTION` marker.

### Correctness and failure modes (high)

- **Leaks on unmount.** Look for:
  - an `AudioNode` that isn't stopped and disconnected;
  - a `requestAnimationFrame` that isn't cancelled;
  - a listener or timer that isn't removed;
  - a WebGL context that isn't released;
  - a WebSocket left open.

  `<otto-mascot>` must survive 20 mount and unmount cycles.
- **Barge-in and playback.** Barge-in must:
  - stop and disconnect the queued audio;
  - drop the rest of the turn still in flight;
  - close the mouth.

  A suspended `AudioContext` must queue chunks, not drop them. The speech bubble must not run ahead of the played audio.
- **Async in the server.** Look for:
  - a pump task that isn't cancelled and awaited in `_wait`;
  - an exception swallowed in a way that hides an `upstream` error;
  - `WebSocketDisconnect` reported as a failure;
  - blocking calls inside async handlers.
- **Accessibility (D-06, D-07).** The robot must stay `aria-hidden`, and everything Otto says or does must also appear as text in the panel. Under reduced motion the body and walking stop and the mouth still moves.
- **Vendored robot (D-10).** A change to `clay-robot.tsx` without an `Otto:` comment.
- **Docs drift.** Behaviour changes need the matching README section, the routing row in `docs/README.md` and, if a decision changed, `docs/decisions.md` (its section and its index row). Decision numbers must not collide. `server/tests/test_docs.py` checks the numbering, the index, and that labels and milestones match CONTRIBUTING.md.
- **Parallel systems (D-19).** Flag a new capability that adds its own channel to the model, its own action path past `tools.py` and `toAssistantAction`, its own task state beside `guidance/task.ts`, or its own event bus beside `createOttoEvents`.
- **Tests.** New behaviour needs a `*.test.ts` or `server/tests/` case. Flag a test that was weakened, skipped or deleted to get green.

### Do Not Flag (Ignore)

- Formatting, whitespace, quote style, import order, line length, trailing commas, semicolons. No formatter is configured, and these are not review findings.
- Naming preferences, comment wording, and "consider extracting a helper" refactors that change no behaviour.
- Typing nits that `tsc -b` already accepts, unless they hide a real bug.
- The style of vendored or imported files (`clay-robot.tsx` apart from missing `Otto:` markers, and the ECC agents in `.claude/agents/`).
- The `[verify]` markers in `web/src/otto/gemini/`. They are tracked as Q-01; don't flag each one again.
- Generated or ignored output: `dist/`, `dist-lib/`, `web/test-results/`, `package-lock.json` churn.

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
