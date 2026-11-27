---
name: otto-code-review
description: Review local Otto voice kit changes (or given paths) for bugs and rule violations with otto-code-reviewer, with optional security, performance and accessibility passes. Pass --fix to apply confirmed fixes.
argument-hint: "[paths...] [--fix] [--deep]"
---

# /otto-code-review

Review `$ARGUMENTS` (default: the uncommitted diff plus untracked files). Don't ask for confirmation.

1. Find the target: the named paths, or `git diff HEAD`, `git diff --cached` and the untracked files.
2. Launch `otto-code-reviewer` on it. Pass `--fix` through if the user gave it.
3. With `--deep`, also run these in parallel (all in `.claude/agents/`):
   - if `web/` changed: `typescript-reviewer`, plus `react-reviewer` when `.tsx` files or hooks changed
   - if `server/` changed: `python-reviewer` (Python and FastAPI)
   - `security-reviewer`: the key and CORS (D-01, D-09), tool argument checks (D-02), WebSocket input handling
   - `performance-optimizer`: per-frame and per-chunk allocation, audio node and WebGL disposal, bundle size of `dist-lib/`
   - `a11y-architect`: only if UI files changed
4. Merge the results. Remove duplicates and rank by severity.
5. If fixes were applied, run the checks in `CLAUDE.md` and report the results.

**Output:** a ranked list of findings, each with `file:line`, the defect, its failure scenario and the rule or decision. Then what was fixed and what is left. End with "No blocking issues" when that's true.
