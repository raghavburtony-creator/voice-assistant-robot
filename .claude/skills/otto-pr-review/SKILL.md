---
name: otto-pr-review
description: Review a GitHub pull request on the Otto voice kit with otto-pr-reviewer and return a verdict. Pass --comment to post the review on GitHub.
argument-hint: "<pr-number> [--comment]"
---

# /otto-pr-review

Review pull request `$ARGUMENTS`.

1. If no PR number was given, run `gh pr list` and review the most recent open PR; say which one.
2. Launch `otto-pr-reviewer` with the number. Pass `--comment` through only if the user gave it.
3. If the PR touches the voice panel, the robot, gestures, movement, sound or `<otto-mascot>`, also launch `otto-design-reviewer` on the PR's files in parallel, and merge its findings into the verdict.

**Output:** the verdict, blocking issues, non-blocking notes, and docs to update. Say whether the review was posted.
