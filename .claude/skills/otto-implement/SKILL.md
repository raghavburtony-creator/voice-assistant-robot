---
name: otto-implement
description: Implement an Otto voice kit task end to end. Runs otto-implementer (with otto-voice-engineer for audio work), then otto-code-reviewer with fixes, otto-design-reviewer for UI, robot or sound changes, and otto-docs-keeper when docs must follow. Use when the user asks to build, add or implement a feature.
argument-hint: "<task description> [--commit] [--no-review]"
---

# /otto-implement

Implement `$ARGUMENTS` for the Otto voice kit. Run the whole pipeline without asking for confirmation. Make reasonable choices and report them at the end.

## Steps

1. **Scope.** Restate the task in one line. Find its row (or rows) in the routing table of `docs/README.md`. If the task is large, split it into independent sub-tasks on separate files.

2. **Implement.** Launch `otto-implementer` with the task, the routing rows and any user constraints. For mic, playback, barge-in, mouth, bubble timing, sound cues or the wake word, add `otto-voice-engineer` alongside it.

   Independent sub-tasks may run in parallel, one agent each.

3. **Review and fix.** Unless `--no-review` was passed, launch `otto-code-reviewer` with "review the current diff and fix confirmed issues (--fix)". In parallel with it:
   - if the change touches the voice panel, the robot, gestures, movement, sound or `<otto-mascot>`: `otto-design-reviewer --fix`
   - if `.tsx` files or hooks changed: `react-reviewer` (report only)
   - if `server/` changed: `python-reviewer` (report only)

   Apply the confirmed findings from the report-only reviewers yourself, then rerun the checks.

4. **Docs.** If behaviour the README describes, a config key, the protocol, the public API or a decision changed, launch `otto-docs-keeper`.

5. **Verify.** Run the checks in `CLAUDE.md` ("Build, Test & Lint Commands") yourself and report the real numbers. If `server/.venv` or `web/node_modules` is missing, say so instead of claiming a pass.

6. **Commit (only with `--commit`).** If on `main`, create `feat/<short-slug>` first. Stage the changed files by name and commit with a clear message. Never push.

## Report

- What was built: files, and the decisions or README sections they serve.
- Test, typecheck and build results, as numbers.
- Review findings: fixed, and left open.
- Assumptions and anything waiting for a hardware check.
- Doc updates.

Keep it short.
