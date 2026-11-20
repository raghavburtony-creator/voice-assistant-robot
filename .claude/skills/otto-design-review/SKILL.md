---
name: otto-design-review
description: Review Otto's UI, robot, motion and sound (a diff, a file, or a screen such as the lab or the preview) with otto-design-reviewer, plus otto-voice-engineer when sound changed. Pass --fix to apply fixes.
argument-hint: "[target] [--fix]"
---

# /otto-design-review

Review `$ARGUMENTS` (default: the uncommitted diff). Don't ask for confirmation.

1. Find the target: named files or a screen (`/`, `/lab.html`, `/preview/`), or the diff.
2. Launch `otto-design-reviewer` on it. Pass `--fix` through if given.
3. If the target touches `audio.ts`, `mouth.ts`, `sound.ts`, `useGestureSounds.ts`, `wakeWord.ts`, `useWakeWord.ts` or `BARGE_IN`, launch `otto-voice-engineer` in parallel to review the audio side (report only, unless `--fix`).
4. Merge the findings, ranked by user impact. If fixes were applied, run `cd web && npm test && npm run typecheck`.
