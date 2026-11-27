---
name: otto-handoff
description: Hand an Otto voice kit issue to a ChatGPT web chat and bring the answer back safely. Without --return it writes one paste-ready brief (the issue, its decisions, the rules, the code, the reply format). With --return it applies ChatGPT's diff on the issue's feature branch, runs every check and the code review. Use when the owner wants to implement an issue in ChatGPT.
argument-hint: "<issue number> [--return]"
---

# /otto-handoff

A ChatGPT web chat can't see the repo, can't read CLAUDE.md and can't run tests. This skill gives it everything one issue needs, and makes sure what comes back is checked like any other change (CLAUDE.md, "Working with ChatGPT"). Don't ask for confirmation.

## Out: `/otto-handoff <n>`

1. **Read the issue** (`issue_read` `get`, or `gh issue view <n>`) and its parent Epic, if any.
   - If it carries `status: needs-decision`, or depends on an open `Q-xx`, stop and say so. Don't hand off work the owner hasn't decided (D-19).
   - If it carries `status: blocked`, name the blocker and stop.
2. **Make or enter the feature branch** for the issue (CLAUDE.md, "Branch and Workspace Workflow"), so the return trip has somewhere to land. Record the base commit (`git rev-parse HEAD`).
3. **Collect the context.** Collect only what the task needs; ChatGPT does worse with a wall of text.
   - The task's row in the `docs/README.md` routing table, and the full text of each `D-xx` / `Q-xx` it names, copied from `docs/decisions.md`.
   - From CLAUDE.md: "Rules for code", plus only the "Review guidelines" bullets that touch the files involved.
   - From `server/CLAUDE.md` or `web/CLAUDE.md`: the module-map rows and recipe for the area.
   - The code:
     - each file the issue will change, in full if it's under about 300 lines;
     - otherwise use jCodeMunch: the file outline (`get_file_outline`), the source of each symbol to change (`get_symbol_source`), and the callers of those symbols (`find_references`);
     - the test file next to each changed file, or its nearest neighbour as a pattern to copy.
   - The exact checks to run (CLAUDE.md, "Build, Test & Lint Commands"), limited to the areas touched.
4. **Write the brief** to the scratchpad as `handoff-<n>.md`, in this order:

   ````
   # Task: <issue title> (#<n>)
   You are implementing one issue in the Otto voice kit. You cannot run code; I will run the checks and send you the failures.
   ## The issue            (Why, Scope, Out of scope, Done when: verbatim)
   ## Decisions that bind  (verbatim D-/Q- text)
   ## Rules                (the selected rules, verbatim)
   ## Code                 (each file or symbol under a ```<lang> path``` fence, with base commit <sha>)
   ## How to reply
   1. One unified diff (`diff --git a/… b/…`) against commit <sha>, covering code AND tests. No prose inside the diff.
   2. Tests for every new behaviour, in the existing test files' style.
   3. Mark any guess with `// ASSUMPTION:` or `# ASSUMPTION:`, and list each guess after the diff.
   4. Don't invent config keys, message types, tools or library APIs that aren't in the code above. If you need one, stop and ask.
   5. Then fill in this PR description: <the contents of .github/pull_request_template.md>.
   ````

5. **Keep it pasteable.** Count the brief's size. If it's over about 60 KB, cut code to outlines plus the symbols being changed, and say what was cut. Suggest the owner keep CLAUDE.md, `docs/architecture.md` and `docs/decisions.md` as ChatGPT *project files*, so the brief can drop the long rules and decision text.
6. **Report** the file's absolute path, its size, the branch and the base commit.

## Back: `/otto-handoff <n> --return`

The owner pastes ChatGPT's reply (or a path to it) with the command.

1. **Check the branch.** Be on the issue's feature branch, with a clean tree (or only this issue's work). Never apply on `main`.
2. **Extract the diff and apply it.** Use `git apply --3way`. If it doesn't apply (ChatGPT often gets hunk offsets wrong), make the same changes by hand with Edit, file by file. Never paste over a whole file you haven't read.
3. **Check for invented things.** Look for config keys, message types, tools and APIs that exist nowhere in the repo. Report each one; don't quietly accept it. Collect every `ASSUMPTION:`.
4. **Run the checks** for the areas touched, and report the real numbers.
5. **Run `/otto-code-review --fix`** on the diff. For UI, robot or sound changes, also run `/otto-design-review`.
6. **If something still fails,** write a short follow-up for ChatGPT to `handoff-<n>-round<k>.md`: the failing output and the reviewer findings, plus the files as they stand now. Give the path, so the owner can paste it back. Stop after 3 rounds and recommend finishing in Claude instead.
7. **Commit** on the feature branch only when the checks and the review pass, following CLAUDE.md's commit identity rule. Push and open a PR only when the owner asks. The PR body uses ChatGPT's filled-in template, corrected to the real check results.

## Report

The brief's path (out). Or (return): what was applied, the invented names found, the assumptions, the check results, the review verdict, and the next step.
