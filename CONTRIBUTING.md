# Contributing

How a piece of work moves from an issue to a merged pull request. The code rules are in [AGENTS.md](AGENTS.md), the decisions in [docs/decisions.md](docs/decisions.md), and the plan in [docs/roadmap.md](docs/roadmap.md).

## From issue to merged PR

1. **Define.** Open the issue with a template: **Task** (one PR's worth), **Epic** (a capability), or **Architecture question** (investigates a `Q-xx`). Fill every section. Under *Read first*, name the decisions and the [docs/README.md](docs/README.md) routing-table row. Add one `type:`, one `priority:` and one `difficulty:` label, the `area:` labels it touches, and a milestone if it is scheduled.
2. **Check dependencies.** Read *Blocked by*. If a blocking issue is open, the issue gets `status: blocked` and waits. If it depends on an open `Q-xx`, it gets `status: needs-decision` and waits for that question, and no one picks an answer in code. If you find a new conflict or an unknown while working, add a `Q-` row to `docs/decisions.md` and say so in the issue.
3. **Inspect the repository.** Load the routing-table row and the decisions it names, then the code they point to. Check that the issue still matches the code. If it doesn't, comment on the issue before you write code.
4. **Implement** in a worktree (AGENTS.md, "Mandatory Worktree Workflow"), one issue per branch. Keep to *Scope*. Mark an unavoidable guess with `ASSUMPTION:`.
5. **Test.** New behaviour gets a test (`server/tests/` or a `*.test.ts`). Run every check in AGENTS.md, "Build, Test & Lint Commands", and say in the PR which ones you couldn't run.
6. **Update docs** in the same PR: the README section for any behaviour change, the routing row for a new area, and `docs/decisions.md` for a new or changed decision (with its index row). `/otto-docs-sync` helps here.
7. **Open the PR** against `main`. Say `Closes #n` and list each *Done when* item with how it was checked. Mention any decision it changes in the title.
8. **Review and merge.** `/otto-pr-review <n>` checks a PR against AGENTS.md, "Review guidelines", and `/watch-pr` follows the Codex review. For a PR an agent opened for the owner, the agent runs `otto-code-reviewer` and squash-merges it into `main` itself when the gate in AGENTS.md, "Review and merge", holds. Anyone else's PR, and any PR that adds or changes a decision or answers a `Q-xx`, is merged by a person. Agents do not submit GitHub approvals.

An epic closes when its sub-issues are closed and its *Done when* holds. A question closes when a PR adds the answering `D-xx` or marks it `dropped`.

## Labels

Defined in [.github/labels.json](.github/labels.json), which a workflow (`.github/workflows/sync-labels.yml`) applies to the repository. Edit that file, never the labels on GitHub by hand, and keep this table in step: `server/tests/test_docs.py` checks both.

Every issue has one `type:`, one `priority:` and, unless it is an epic, one `difficulty:`. `status:` and `area:` labels are added as they apply.

| Label | Meaning |
|---|---|
| `type: epic` | A product capability made of several issues. No code of its own. |
| `type: feature` | New behaviour a visitor or a host developer can see. |
| `type: bug` | Behaviour that breaks the README or a decision. |
| `type: docs` | Docs only: README, docs/, AGENTS.md. |
| `type: chore` | Tooling, tests, CI or refactoring with no change in behaviour. |
| `type: question` | An investigation that answers a Q-xx in docs/decisions.md. |
| `priority: p0` | A security, privacy or cost rule is broken (D-01, D-04, D-09, D-17). Drop other work. |
| `priority: p1` | Blocks the current milestone. |
| `priority: p2` | Planned for the current or next milestone. |
| `priority: p3` | Worth doing; not scheduled. |
| `difficulty: starter` | One area, a few files, all named by the routing table. |
| `difficulty: intermediate` | Crosses one boundary: both ends of the protocol, or core and shell. |
| `difficulty: advanced` | Several areas, or an open question nearby. Read the decisions first. |
| `status: blocked` | Waits on another issue, named under Blocked by. |
| `status: needs-decision` | Waits on a Q-xx in docs/decisions.md. Don't pick an answer in code. |
| `area: server` | server/: route, bridge, tools, config. |
| `area: kit` | web/src/otto/: guidance, awareness, context, the panel. |
| `area: voice` | Live audio, playback, barge-in, wake word, sound. |
| `area: robot` | The robot, faces, gestures, movement. |
| `area: packaging` | `<otto-mascot>`, the adapters, the library build. |

## Milestones

A milestone is a release: a set of issues that ship together and that a visitor or a host developer would notice. Milestones are not areas or difficulty levels, and an epic may span several of them. Defined in [.github/milestones.json](.github/milestones.json).

| Milestone | What ships |
|---|---|
| 0.2 Task-aware Otto, in page | The model knows which guided task is running, where the visitor is in it, and what the app is busy with, within one page session. Nothing new is stored. |
| 0.3 Task continuity | A guided task survives a reload in the same tab, as D-20 decides. |

Unscheduled work has no milestone. Give it one when it is planned, not when it is filed.
