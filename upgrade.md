# Integrate AnyModelBot into Otto

Repository to inspect and reuse:

https://github.com/modelflare-ai/AnyModelBot

## Objective

Integrate the strongest reusable parts of AnyModelBot into the existing Otto architecture.

Do NOT replace Otto's existing Google ADK orchestrator.

Do NOT create a second agent, router, or autonomous decision-maker.

The architectural rule remains:

**Otto's ADK orchestrator decides. Imported subsystems provide capabilities.**

AnyModelBot should be treated as an implementation/reference source, not as a second brain.

---

# 1. First inspect the actual AnyModelBot source

Before implementing anything, inspect the current repository rather than relying on its README.

Pay particular attention to:

```text
src/core/
src/agent/
src/tools/
src/tasks/
src/delivery/
src/llm/
src/magpie/
src/channels/
```

The current repository describes these areas as containing shared message/session handling, durable outbox behavior, agent approvals and permissions, memory/context stewardship, computer-use tools, background tasks/rules, and gateway supervision.

For every candidate implementation:

1. Compare it with the equivalent Otto subsystem.
2. Determine whether AnyModelBot's implementation is stronger.
3. Reuse it directly where architecture permits.
4. Adapt it when Otto's interfaces differ.
5. Keep Otto's existing implementation if it is already superior.
6. Rewrite only when integration requires it.
7. Do not duplicate functionality unnecessarily.

Use this priority:

```text
REUSE
  ↓
ADAPT
  ↓
REWRITE
  ↓
NEW IMPLEMENTATION
```

---

# 2. Integrate AnyModelBot's desktop-native application concepts

Otto is currently struggling with desktop behavior:

- poor overlay behavior
- incorrect taskbar/dock behavior
- focus/z-order problems
- difficulty behaving like a real desktop application
- always-on-top behavior that should not be uncontrolled

Use AnyModelBot's Electron/tray/desktop approach as a reference for making Otto a proper desktop application.

AnyModelBot supports:

- desktop application mode
- tray behavior
- application lifecycle
- hide/show behavior
- startup behavior
- persistent local runtime
- local web console
- background operation

Adapt the useful desktop lifecycle concepts into Otto.

Do NOT replace the existing Otto avatar/frontend.

The Otto frontend should remain the visual identity of the assistant.

Target:

```text
                    OTTO DESKTOP APP
                          │
             ┌────────────┼────────────┐
             │            │            │
          Full UI      Compact UI     Tray
             │            │            │
             └────────────┼────────────┘
                          │
                    ADK ORCHESTRATOR
```

Otto should behave like a normal desktop application rather than an uncontrolled overlay.

---

# 3. Integrate persistent memory architecture

This is a high-priority requirement.

Otto currently has memory infrastructure, but it must reliably remember basic personal facts across:

- conversations
- voice sessions
- application restarts
- desktop sessions

Use AnyModelBot's persistent memory/context approach as an implementation source.

AnyModelBot stores bot memory locally and also uses a context steward to keep long-running conversations usable.

Compare this with Otto's existing:

```text
memory_service.py
memory_consent.py
forget.py
continuity.py
continuity_store.py
```

Do not create a second memory system.

Instead, strengthen the existing Otto MemoryService.

The final Otto memory API should support:

```python
remember(...)
recall(...)
search(...)
update(...)
forget(...)
resurface(...)
```

Memory categories should include at least:

```text
semantic/personal facts
preferences
instructions
episodic memories
conversation context
temporary session context
```

Example:

```text
USER_FACT
name = Raghav
```

After restarting Otto, the orchestrator must still be able to retrieve this fact.

Memory retrieval must be controlled by the Otto orchestrator.

Memory itself must never become an autonomous agent.

---

# 4. Integrate AnyModelBot's context stewardship

Study AnyModelBot's mechanism for keeping long conversations usable.

Otto should gain a context lifecycle capable of:

```text
conversation
     ↓
context monitoring
     ↓
summarization / handoff
     ↓
persistent continuity
     ↓
new context segment
     ↓
continue conversation
```

This must preserve:

- user identity
- active task
- important decisions
- unresolved questions
- tool results
- relevant memories
- current desktop state

Do not blindly summarize everything.

Important durable facts should go through MemoryService.

Temporary conversation state should remain session context.

---

# 5. Integrate background task behavior

AnyModelBot has a strong model for background work:

```text
chat
 ↓
background task
 ↓
task stages
 ↓
result
 ↓
return to original conversation
```

Compare this with Otto's existing:

```text
tasks.py
task_workers.py
```

Strengthen Otto rather than creating another task system.

Otto should support:

```text
create_task()
queue_task()
run_task()
pause_task()
resume_task()
cancel_task()
wait_for_input()
wait_for_approval()
complete_task()
fail_task()
verify_task()
```

A long-running task must not block the main conversation.

Example:

```text
User:
"Research this topic and give me a report."

Otto:
"Sure. I'll work on that in the background."

             ↓

conversation remains available

             ↓

background task runs

             ↓

result returns to Otto

             ↓

Otto presents result
```

---

# 6. Add "Needs Otto/User" state

Study AnyModelBot's concept of tasks waiting for the user.

Otto should have a unified state for work that requires user interaction:

```text
NEEDS_APPROVAL
NEEDS_INPUT
NEEDS_AUTHENTICATION
NEEDS_RETRY
NEEDS_CONFIRMATION
```

These should appear in the Otto UI as actionable pending items.

Example:

```text
Task
 ├── status: NEEDS_APPROVAL
 ├── reason
 ├── requested_action
 ├── risk
 ├── expires_at
 └── resume_token
```

When the user responds, the task resumes from its previous state.

---

# 7. Integrate approval and permission patterns

AnyModelBot has an important architectural principle:

**The agent can request an action, but authorization is handled separately.**

Bring this into Otto.

Combine the strongest ideas from:

```text
AnyModelBot permissions/approvals
Beacon approvals
Beacon certificates
Beacon audit
JARVIS policy_engine.py
Kaizumi safety
Otto Policy Engine
```

Final flow:

```text
ADK ORCHESTRATOR
        ↓
ACTION REQUEST
        ↓
POLICY ENGINE
        ↓
risk assessment
        ↓
permission check
        ↓
approval if required
        ↓
TOOL GATEWAY
        ↓
EXECUTE
        ↓
VERIFY
        ↓
AUDIT
```

Never let model-generated text directly authorize a sensitive action.

---

# 8. Integrate local-first persistence

Study AnyModelBot's approach to keeping:

- conversations
- memory
- settings
- task state
- API configuration
- session state

locally persisted.

Otto should remain local-first where practical.

Do not blindly introduce AnyModelBot's database architecture.

Instead, compare its persistence model against Otto's current storage layer and consolidate.

Important principle:

```text
ephemeral process state
        ≠
durable assistant state
```

A restart must not erase:

- important memories
- task state
- user preferences
- continuity state
- pending recoverable work

---

# 9. Integrate durable message/outbox behavior

Inspect AnyModelBot's durable outbox and delivery architecture.

Otto should avoid losing important responses/events when:

- the desktop UI restarts
- a background task finishes while the UI is unavailable
- a connection temporarily fails
- the assistant is restarted

Implement an Otto event/outbox mechanism where appropriate.

Example:

```text
Task completes
      ↓
event persisted
      ↓
delivery attempted
      ↓
UI unavailable
      ↓
event remains pending
      ↓
Otto starts again
      ↓
pending event delivered
```

Do not lose important task results.

---

# 10. Integrate desktop computer-use concepts

AnyModelBot includes a computer-use subsystem.

Inspect:

```text
src/tools/computer-use/
```

Compare it against Otto's planned desktop architecture.

Otto's first computer-use capability remains:

**window/tab management**

not arbitrary mouse automation.

Build:

```text
desktop.observe
desktop.windows
desktop.focus_window
desktop.move_window
desktop.resize_window
desktop.minimize_window
desktop.maximize_window
desktop.restore_window
desktop.close_window
desktop.switch_workspace
desktop.move_window_to_workspace
desktop.screenshot
desktop.verify
```

Then expand toward:

```text
desktop.mouse
desktop.keyboard
desktop.click
desktop.type
desktop.scroll
```

Only after reliable window-level control exists.

---

# 11. Mandatory observe → decide → policy → act → verify loop

Every computer action should follow:

```text
OBSERVE
   ↓
DECIDE
   ↓
POLICY CHECK
   ↓
ACT
   ↓
VERIFY
   ↓
UPDATED STATE
```

Example:

```text
User:
"Move VS Code to the left."

Otto:

desktop.observe()
        ↓
identify VS Code window
        ↓
decide destination
        ↓
policy.check()
        ↓
desktop.move_window(...)
        ↓
desktop.verify()
        ↓
updated desktop state
        ↓
"Done."
```

Never make computer use a blind sequence of coordinates.

---

# 12. Preserve one decision authority

This is critical.

The final architecture must NOT become:

```text
Otto Agent
JARVIS Agent
AnyModelBot Agent
Desktop Agent
Memory Agent
Task Agent
```

Instead:

```text
                     OTTO
                      │
               GOOGLE ADK
              ORCHESTRATOR
                      │
              ┌───────┴───────┐
              │               │
         Tool Gateway      Task Engine
              │               │
      ┌───────┼────────┐      │
      │       │        │      │
   Desktop  Browser  Research  │
      │       │        │      │
      └───────┴────────┘      │
                               │
                         Background Work
```

Memory, policy, tasks, desktop control and research are services/tools.

They do not independently decide what Otto should do.

---

# 13. Do not copy AnyModelBot's model/provider architecture blindly

AnyModelBot is designed around its own model gateway and supports many model providers through Modelflare.

Otto already has Google ADK/Gemini integration.

Do NOT replace the Otto model layer with Modelflare.

Instead, inspect whether its provider abstraction, model metadata, fallback behavior, usage tracking, or model-selection concepts can be adapted to Otto's existing model abstraction.

If useful, expose this through an Otto provider interface:

```text
ModelProvider
 ├── Gemini
 ├── OpenAI
 ├── Anthropic
 ├── local models
 └── other compatible providers
```

But the ADK orchestrator remains the decision authority.

---

# 14. Do not copy multi-bot architecture

AnyModelBot supports multiple bots/personas, each with their own model, workspace and memory.

Do not turn Otto into multiple autonomous bots.

Otto should remain one assistant identity.

The useful concept to extract is:

```text
persona
workspace
memory
permissions
```

as configurable assistant state.

---

# 15. Integrate workspace isolation

Study AnyModelBot's workspace and permission model.

Otto should be able to distinguish:

```text
Otto workspace
project workspace
user files
system files
external resources
```

Actions outside a permitted workspace should pass through Otto Policy Engine.

Potential model:

```text
READ
WRITE_WORKSPACE
WRITE_EXTERNAL
EXECUTE
SYSTEM
```

Each action receives a risk level and permission requirement.

---

# 16. Keep Otto's existing frontend

Do not replace:

```text
web/src/otto/
```

The existing:

```text
Otto.tsx
OttoStage.tsx
OttoDock.tsx
VoiceAssistant.tsx
ScreenShare.tsx
awareness/
gemini/
robot/
movement/
guidance/
consent/
```

remain the Otto experience.

AnyModelBot's UI should only be used as a reference for:

- desktop application layout
- task visibility
- approval cards
- pending work
- settings
- memory visibility
- background task state
- tray/application behavior

Do not replace Otto's visual identity with AnyModelBot's bot UI.

---

# 17. Integrate with the existing Otto architecture

The target architecture is:

```text
                         OTTO
                          │
                  GOOGLE ADK
                 ORCHESTRATOR
                          │
          ┌───────────────┼────────────────┐
          │               │                │
       MEMORY           POLICY           TASKS
          │               │                │
       Muninn        JARVIS/Beacon     Concierge
       + AnyModel     + AnyModel       + AnyModel
          │               │                │
          └───────────────┼────────────────┘
                          │
                     TOOL GATEWAY
                          │
       ┌──────────────────┼──────────────────┐
       │                  │                  │
    DESKTOP             BROWSER           RESEARCH
       │                  │                  │
 AnyModel + JARVIS    JARVIS/Kaizumi       WRN
 + IRIS + gnomelets
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                  OBSERVE → ACT → VERIFY
                          │
                    DESKTOP STATE
                          │
                     OTTO AVATAR
```

AnyModelBot should therefore strengthen:

```text
desktop runtime
memory persistence
context management
background tasks
approval workflow
workspace permissions
durable delivery
local-first state
```

without replacing existing Otto architecture.

---

# 18. Reuse map

Produce a concrete implementation map before modifying code:

| AnyModelBot area | Otto action |
|---|---|
| `src/core/` | ADAPT |
| `src/agent/` | SELECTIVELY ADAPT |
| `src/tools/computer-use/` | ADAPT |
| `src/tasks/` | ADAPT |
| `src/delivery/` | ADAPT |
| memory implementation | ADAPT |
| context steward | ADAPT |
| approvals | ADAPT |
| permissions | ADAPT |
| workspace isolation | ADAPT |
| local persistence | ADAPT |
| durable outbox | ADAPT |
| model gateway | SELECTIVELY ADAPT |
| channels | SELECTIVELY ADAPT |
| Electron shell | ADAPT CONCEPTS |
| AnyModelBot agent | IGNORE AS ORCHESTRATOR |
| AnyModelBot bot/router | IGNORE |
| Modelflare-specific infrastructure | IGNORE unless explicitly useful |
| AnyModelBot UI identity | IGNORE |

The actual source inspection may change this map. Do not follow the table blindly if the source shows a better integration boundary.

---

# 19. Implementation requirements

Before coding:

1. Inspect the current Otto tree.
2. Inspect the current AnyModelBot tree.
3. Map equivalent functionality.
4. Identify duplicated Otto implementations.
5. Identify the stronger implementation.
6. Produce a concise reuse/adapt/rewrite/ignore table.
7. Implement the highest-value integrations.
8. Remove redundant code only when safe.
9. Preserve backward compatibility.
10. Add tests for every integrated subsystem.

Do not stop after documentation.

This task is implementation work.

---

# 20. Acceptance criteria

The integration is complete only when Otto can demonstrate:

### Memory

```text
User tells Otto their name.
↓
Otto stores it.
↓
Otto restarts.
↓
User asks "What's my name?"
↓
Otto retrieves the stored fact.
```

### Desktop lifecycle

```text
Launch Otto
↓
normal application window
↓
taskbar/dock presence
↓
minimize
↓
restore
↓
focus
↓
close to tray if configured
↓
restore from tray
```

### Window management

```text
"Show me my windows."
"Focus VS Code."
"Move VS Code to the left."
"Maximize Chrome."
"Move Chrome to workspace 2."
```

Each must use:

```text
observe → decide → policy → act → verify
```

### Background task

```text
"Research X in the background."
↓
task created
↓
user continues chatting
↓
task executes
↓
task completes
↓
result returned to Otto
```

### Approval

```text
Otto requests sensitive action
↓
Policy Engine evaluates
↓
approval requested
↓
user approves
↓
action executes
↓
verification
↓
audit event
```

### Recovery

```text
background task running
↓
Otto/UI restarts
↓
task state survives
↓
Otto resumes/reports state
```

---

# 21. Testing

Run all relevant existing Otto tests.

Add focused tests for:

- persistent memory
- memory retrieval after restart
- context handoff
- background task persistence
- task resume
- approval workflow
- permission boundaries
- desktop window enumeration
- window focus
- move/resize
- minimize/maximize/restore
- workspace movement
- desktop verification
- application lifecycle
- durable event delivery

Also run AnyModelBot-inspired integration tests where appropriate.

Do not add tests that depend on external model APIs unless explicitly marked as integration tests.

---

# 22. Important constraint

Do not make this a giant rewrite.

The goal is:

**take the best working mechanisms from AnyModelBot and integrate them into Otto.**

Prefer:

```text
existing Otto interface
        +
proven AnyModelBot implementation
        =
stronger Otto subsystem
```

not:

```text
replace Otto with AnyModelBot
```

At the end, report:

1. What AnyModelBot functionality was actually reused.
2. Which files/classes were adapted.
3. Which Otto implementations were replaced.
4. Which functionality was intentionally ignored.
5. What remains to integrate.
6. Tests executed and results.
7. Any architectural conflicts discovered.

Do not create a second orchestrator.

Do not create another router.

Do not replace Google ADK as Otto's central decision authority.