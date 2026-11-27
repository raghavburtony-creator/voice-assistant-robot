<!--
Fill in every section. Delete these comments. The workflow is in CONTRIBUTING.md; the rules are in CLAUDE.md.
Title: the issue's title, e.g. "ENV-02: announce environmental attention to screen readers". Mention any decision the PR changes.
-->

Closes #<n>

## Summary

<!-- What changed and why, in two or three sentences. Behaviour, not a file list. -->

## Done when

<!-- Copy each "Done when" item from the issue and say how it was checked: a test name, a command, or something a reviewer can see. -->

- [ ] <item> — <how it was checked>

## Checks

<!-- The real output, not "passed". Run only the commands for the areas changed; name the ones you skipped. -->

| Check | Result |
|---|---|
| `cd server && .venv/bin/python -m pytest` | <n passed, m failed> |
| `cd web && npm test` | <n passed> |
| `cd web && npm run typecheck` | <clean / errors> |
| `cd web && npm run build` | <ok / failed> |
| `cd web && npm run build:lib` (element/, react/, gemini/ or the public API changed) | <ok / not needed> |
| `cd web && npm run test:e2e` | <n passed / not run: why> |

**Not run, and why:** <none, or each check and its reason>

## Decisions and questions

<!-- The D-xx this PR relies on. A new or changed decision, or an answer to a Q-xx, means a person merges this PR (D-19). -->

- Relies on: D-…
- Adds or changes: none / D-… (owner merges)
- Assumptions (`ASSUMPTION:` markers): none / <list>

## Docs

- [ ] README section updated, or no behaviour change
- [ ] `docs/README.md` routing row added or updated, or no new area
- [ ] `docs/decisions.md` (section and index row), or no decision changed
