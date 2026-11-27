---
name: otto-orchestrate
description: Orchestrate an Otto voice kit task with small parallel sub-agents and a review loop. Plans the task, splits it into independent units, runs otto-worker agents in parallel, checks their work with tests and the project reviewers, and sends findings back to the same workers until the review passes (at most 3 rounds). Use for multi-part features; for a one-file change, just do it.
argument-hint: "<task> [--rounds N] [--commit]"
---

# /otto-orchestrate

Deliver `$ARGUMENTS` with the best result for the least work. You are the orchestrator: you plan, start workers, judge and decide. You write code yourself only to merge two units' work or to make a one-line fix. Don't ask the user for confirmation; report choices at the end.

This runs in the main session because a sub-agent can't start other sub-agents.

## 0. Is orchestration worth it?

If the task touches one or two files and needs no specialist, do it yourself (or use `/otto-implement`), run the checks and stop. Orchestration pays off when there are three or more independent pieces, or when the work needs specialists.

## 1. Plan (no agents yet)

1. Read `CLAUDE.md`, `docs/decisions.md` and the task's rows in the routing table of `docs/README.md`.
2. Split the task into **units**. Each unit has:
   - a name and a one-line goal;
   - the **files it owns**. No two units running at the same time may own the same file;
   - its **acceptance checks**: the test file or command that proves it, and what must be true;
   - its **dependencies**: the units it needs first, if any;
   - its **worker and model**, from the table below.
3. Keep units small: one concern, roughly 1 to 4 files. Prefer fewer, cleaner units to many tiny ones; each agent costs a cold start.
4. Write the plan in your reply as a short table, so the user can see it, then go on.

| The unit is | Agent | Model |
|---|---|---|
| mechanical: config entries, re-exports, renames, a test for existing code | `otto-worker` | `haiku` |
| ordinary feature or fix in a few files | `otto-worker` | `sonnet` (its default) |
| tricky logic, concurrency, the audio pipeline, a cross-cutting refactor | `otto-worker` | `opus` |
| mic, playback, barge-in, mouth, cues, wake word | `otto-voice-engineer` | inherit |

Pass the model with the Agent tool's `model` parameter.

## 2. Build: start the workers

Start every unit whose dependencies are done **in one message, in parallel**. Give each worker a brief that holds everything it needs, so it doesn't explore:

```
UNIT: <name>
GOAL: <one or two sentences: what must be true when it's done>
YOU OWN: <files>; edit nothing else
READ FIRST: <the 1–3 other files it must understand, and the CLAUDE.md rules or D- entries that apply>
CONTEXT: <what the other units are doing, only where it touches this unit; interfaces they'll provide>
CHECKS: <exact commands>, e.g. cd web && npx vitest run src/otto/<file>.test.ts && npm run typecheck
DONE MEANS: <the acceptance checks>
```

Keep each worker's agent ID: later rounds go back to the **same** worker with SendMessage, which keeps its context and costs far less than a new agent.

When a worker reports `NEEDS FROM OTHERS`, route that need to the unit that owns the file, or make the one-line change yourself.

## 3. Judge: cheap checks first, then reviewers

After a batch of workers returns:

1. **Checks (deterministic, cheap).** Run them yourself, not through an agent:
   - `cd web && npm test && npm run typecheck`, plus `npm run build:lib` if `web/src/otto/element/` or the public exports changed;
   - `cd server && .venv/bin/python -m pytest`, if `server/` changed and the venv exists.

   A failing check is a finding. Map it to the unit that owns the failing file.
2. **Reviewers (only once the checks pass).** Run them in parallel, report-only, on the diff of this task only:
   - always `otto-code-reviewer`;
   - `otto-design-reviewer` if the voice panel, robot, gestures, movement, sound or `<otto-mascot>` changed;
   - in the final round only: `security-reviewer` if `server/`, tools or the protocol changed, and `react-reviewer` or `fastapi-reviewer` for the side that changed.

   Ask each reviewer to end with one line, `VERDICT: PASS` or `VERDICT: FAIL`, and to tag every blocking finding with the file it is in.
3. **Your own pass.** Do the units fit together: names, interfaces, the protocol on both ends, both configs? Does the whole task meet its goal, and not just each unit?

## 4. Loop until it's good

- **PASS:** every check passes, every reviewer says `VERDICT: PASS`, and your own pass finds nothing. Go to step 5.
- **Otherwise:** group the blocking findings by owning unit, and send each to its worker with SendMessage: the findings, the failing output, and "fix these only". Run independent fixes in parallel. Then go back to step 3, re-reviewing **only the files that changed** in this round.
- Throw out findings you can't substantiate, and nits; never send a worker a finding you haven't checked.
- **Stop early, and report, when:**
  - the round limit is reached (`--rounds`, default 3);
  - a round fixes nothing, or the same finding comes back twice (no progress). Fix it yourself if it is small, or report it;
  - a worker reports `blocked` on something only the user can decide.

## 5. Finish

1. If any doc must follow (README behaviour, a config key, the protocol, the public API, a decision), start `otto-docs-keeper` once, on the final diff.
2. Run the full checks one last time and record the real numbers.
3. With `--commit`: if on `main`, create `feat/<short-slug>`; stage the changed files by name; commit. Never push.

## Report

- The plan table, with each unit's final status and the model it ran on.
- Rounds used, and what each round fixed.
- Check results, as numbers.
- Findings left open, and why.
- Assumptions the workers made.

Keep it short. Don't paste diffs.
