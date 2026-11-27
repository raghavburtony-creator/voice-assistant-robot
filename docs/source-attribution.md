# Architecture source attribution and licence register

This register separates **code actually present in Otto** from **architectural references named in roadmap issues**. A pattern mentioned in an issue is not evidence that its source code was copied, that its repository identity is settled, or that its licence permits reuse.

## Implemented code and assets

| Source | Otto location / use | Disposition | Licence and provenance status |
|---|---|---|---|
| NASA Earth Jukebox (2026 NASA Space Apps Challenge) | The voice guide, panel and robot wiring; named in the root README's “Where it came from” section | Adapted as the starting project; jukebox-only player, sound map, datasets, weather and Planetary Computer tools are explicitly excluded | The current repository documentation does not identify a source commit or reproduce a licence grant for the adapted material. Confirm the upstream challenge repository, exact source revision and applicable terms before redistributing any disputed source material. |
| FinAssist voice assistant | Earlier source of the voice guide, as stated in the root README | Historical port/adaptation into the NASA Earth Jukebox project, then into Otto | The README does not identify a canonical upstream URL, source revision or licence. No independent licence conclusion is made here. |
| Originkit Clay Robot | `web/src/components/originkit/ui/clay-robot.tsx` | Vendored component, then adapted for Otto. D-10 and CLAUDE.md require every Otto change to carry an `Otto:` marker. The component's own header describes its visual starting point as a still supplied by the user and says the character was recoloured and reshaped. | The repository does not include an Originkit licence grant in this file. Preserve the vendored attribution and verify the upstream package's licence/terms before republishing the component independently. |
| Everything Claude Code (ECC) 2.2.3, Affaan Mustafa | Seven reviewer/architect agent files under `.claude/agents/` | Imported with project-specific notes; not part of Otto's runtime | MIT. The exact notice and list of imported files are included in `.claude/THIRD_PARTY_LICENSES/ecc.txt`. Preserve the copyright and permission notice. |

The root README is the source for the NASA Earth Jukebox and FinAssist history. The Originkit component and CLAUDE.md describe the vendoring/change-marker rule. The ECC notice is the source for the imported-agent inventory and MIT terms. This table records what the repository currently establishes; it does not replace upstream licence review.

## Architectural references from roadmap issues

The following projects are cited by issue descriptions as sources of *approaches*. They are not recorded as copied source code. The issue descriptions do not pin canonical repository URLs, commits or licence files for every name; therefore this register deliberately does not guess those details.

| Reference named by issue | Otto issue / proposed pattern | Current disposition in Otto | Reuse and licence gate |
|---|---|---|---|
| Worker Rights Navigator | #44–#45 tool registry/gateway; #53 retrieval and evidence provenance; #54 privacy/redaction | Architectural reference for registry, retrieval and privacy boundaries. The current docs and issue descriptions do not identify a copied source file. | Pin the exact upstream repository and commit; inspect its licence and all transitive assets before copying or adapting code. |
| JARVIS ADK | #44 orchestration/routing patterns; #55 skills, plugins and MCP | Reference for extension and capability-loading patterns only. Runtime authority remains governed by Otto's decisions, especially D-22. | “JARVIS” is not a unique repository identifier. Confirm the exact project, revision and licence before reuse. |
| Muninn | #46 memory/context engine | Reference for extraction, claims, graph and resurfacing concepts; no imported implementation is recorded. | Confirm which Muninn project/revision is intended and inspect its licence, data model and retention behaviour before reuse. |
| Beacon | #47–#48 risk, approvals, consent evidence and verification | Reference for approval/audit concepts; no imported implementation is recorded. | Pin exact source and licence; separately review whether its authorization model fits Otto's visitor-controlled consent decisions. |
| Kaizumi | #47 and #52 safety, executor, resilience and loop-guard patterns | Reference for safety/execution concepts; no imported implementation is recorded. | Pin exact source and licence before reuse. |
| Concierge | #49 asynchronous task lifecycle and workers | Reference for background task lifecycle concepts; no imported implementation is recorded. | Pin exact source and licence before reuse. |
| OpenRealtime | #49 foreground/background execution lanes | Reference for separating realtime interaction from background work; no imported implementation is recorded. | Pin exact source and licence before reuse. |
| IRIS | #52 observe–act–verify computer-use loop | Reference for post-action observation and verification; no imported implementation is recorded. | Pin exact source and licence before reuse. |

**Required process for future reuse:** record the canonical upstream URL, immutable commit/tag, the exact files or concepts taken, whether they were copied/adapted/rewritten/reference-only, the licence and required notices, and any incompatible dependencies. Keep required notices with the imported material. If the licence or provenance cannot be established, use the idea as a design reference and write an independent implementation; do not copy code.

## Sign-language ML references (reference-only)

The SIG-03 personal BSL training workspace was written independently. These repositories informed architecture and implementation planning; no source files or model weights were copied into Otto.

| Reference | Pinned revision inspected | Use in Otto | Licence / boundary |
|---|---|---|---|
| [GestureSign](https://github.com/shashank11yadav/GestureSign) | `7ba88e7d3de08ea0a1464db5b05cd2d43f5c2a68` | Reference for browser-local landmark extraction, temporal convolution + Transformer classification, ONNX inference and feature parity testing | Repository code is MIT. Its model/data are ASL-specific; no ASL weights or ASL labels are used as BSL training data. No code is copied. |
| [BSL Experiment](https://github.com/chrisns/bsl-experiment) | `ac0aee044e24949382436d798c4cd04f4925fb9d` | BSL-specific research reference for isolated-sign recognition, landmark features and ONNX deployment | Repository code is MIT and the project is archived. Its published model combines multiple sign-language data sources and its own documentation warns about testing and dataset-licence limitations; no weights or training code are copied. |
| [Oxford BSLDict](https://www.robots.ox.ac.uk/~vgg/research/bsldict/) | Dataset documentation inspected; no media included or fetched | Potential optional source for future BSL examples | Dataset documentation states CC BY 4.0 while noting original video copyright remains with the respective owners. Verify rights for each specific video/clip and preserve attribution before use. |
| [UCL BSL SignBank](https://bslsignbank.ucl.ac.uk/) | Public FAQ inspected; no media included or fetched | Vocabulary/linguistic reference only | The FAQ restricts scraping and bulk downloads without permission. Do not automate collection from the site. |
| [BOBSL](https://www.robots.ox.ac.uk/~vgg/data/bobsl/) | Access/terms page inspected; no media included or fetched | Not used | Access terms exclude independent researchers and commercial organisations; do not download or train from it without an applicable written agreement. |

This register describes research references, not permission to use third-party datasets. The default SIG-03 collection route is owner-recorded data with explicit consent.

## Dependency and runtime boundaries

- External architecture references do not grant runtime authority. Otto's current authority remains the chain in [architecture.md](architecture.md#who-decides-at-runtime) and D-22: model proposal, server checks, browser checks, visitor approval/native validation where applicable, execution, and Otto's local guidance rules.
- Provider adapters own transport and provider-specific protocol details. Pure rules and schemas should not import FastAPI, browser globals, UI components or provider clients.
- Tool implementations remain checked server functions. The browser independently validates received action messages. A registry may describe and validate a call, but must not replace either check or grant consent.
- Task execution must report progress/completion through the existing session/event path; it must not add a parallel conversation, action path or event bus.
- Memory and research services may return bounded, provenance-bearing data to their caller. They must not autonomously issue user-facing actions. Persistence, sensitivity, retention and deletion rules must be explicit before visitor data is stored.
- Extensions may contribute schema-described capabilities, but every invocation must pass through Otto's existing checks. An extension cannot install a second router or bypass visitor approval.

These are dependency constraints, not a claim that the planned services have already shipped. See the issue links and status in [roadmap.md](roadmap.md), and the current decisions in [decisions.md](decisions.md).
