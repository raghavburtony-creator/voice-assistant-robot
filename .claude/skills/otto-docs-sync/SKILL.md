---
name: otto-docs-sync
description: Bring the Otto voice kit's docs in line with a change (README sections, docs/README.md routing table, docs/decisions.md, AGENTS.md) with otto-docs-keeper, and check every link and cited path.
argument-hint: "[what changed]"
---

# /otto-docs-sync

Sync the docs with `$ARGUMENTS` (default: the uncommitted diff and the commits on this branch not on `main`).

1. Collect the change: `git diff main...HEAD`, `git diff HEAD`, and untracked files.
2. Launch `otto-docs-keeper` with that change and the user's note.
3. Report the files it changed, any decision or question it added, and its check results (links, cited paths, routing headings, decision numbers).
