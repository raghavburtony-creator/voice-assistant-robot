# Otto — JARVIS Integration & Desktop Workflow

## Objective

Upgrade the existing Otto implementation by reusing as much proven functionality as possible from the JARVIS ADK repository instead of rebuilding equivalent systems from scratch.

Reference implementation:

`eduardo02138/JARVIS---Assistente-Pessoal-de-IA-`

The current Otto ADK orchestrator remains the **single authoritative brain**.

Do NOT turn JARVIS into another agent/orchestrator inside Otto.

Use JARVIS as a source of reusable infrastructure, tools, execution patterns, plugin architecture, MCP integration, computer-use patterns, policy patterns, and runtime ideas.

Before implementing anything, inspect both repositories and identify what can be directly reused, what must be adapted to Otto's architecture, and what should remain Otto-native.

---

# 1. Desktop shell is currently a major problem

The current Otto desktop experience needs to be redesigned.

Current problems:

- Otto behaves like an overlay rather than a proper desktop application.
- The UI overlaps other desktop applications badly.
- The floating/tap button sits above Otto and interferes with the desktop experience.
- Otto does not behave correctly as a normal desktop application/window.
- Otto does not integrate naturally with the desktop task bar/dock.
- The user should be able to move between Otto and normal desktop applications naturally.
- The current interaction model feels like a floating assistant imposed on the desktop instead of a native desktop companion.

## Desired behavior

Otto should behave as a **real desktop companion application**.

The desktop shell should support:

- normal application window behavior
- minimize
- maximize
- restore
- close
- task-bar/dock presence
- focus handling
- window activation
- proper z-order
- workspace/window awareness
- predictable positioning
- no accidental permanent topmost behavior
- no uncontrolled overlap with other applications
- optional compact/floating assistant mode
- optional full application mode

The user should be able to treat Otto like a normal desktop application.

The assistant/avatar can remain visually distinctive, but the underlying application behavior should respect the desktop window manager.

---

# 2. Make the desktop shell the first computer-use capability

The first computer-use capability should NOT be arbitrary mouse automation.

The first capability should be:

**WINDOW MANAGEMENT**

Otto must understand the desktop layout and be able to operate on windows.

Examples:

- list currently open windows
- identify active window
- identify application
- identify window title
- focus a window
- minimize a window
- maximize a window
- restore a window
- move a window
- resize a window
- close a window
- switch between windows
- switch workspaces
- determine where a window currently exists
- move a window to another workspace
- position a window relative to another window

Example user intents:

> "Move Firefox to the left."

> "Put VS Code beside the browser."

> "Move this window to workspace 2."

> "Bring Discord forward."

> "Maximize this."

> "Put Otto next to my terminal."

The implementation should use the desktop/window-manager APIs where possible rather than relying primarily on blind coordinate clicking.

---

# 3. Desktop understanding

Otto needs a desktop state model.

Create/adapt a desktop perception layer that can answer:

```text
What applications are open?
What windows are open?
Which window is focused?
Where is each window?
What workspace is active?
Which monitors exist?
Where is Otto?
What changed since the previous observation?
```

Represent the desktop as structured state rather than making the LLM infer everything from screenshots.

Example conceptual state:

```text
Desktop
 ├── monitors
 ├── workspaces
 ├── applications
 │    └── windows
 │         ├── id
 │         ├── title
 │         ├── application
 │         ├── position
 │         ├── size
 │         ├── workspace
 │         ├── focused
 │         └── state
 └── Otto
```

The orchestrator should receive this information as context/tools rather than having to manually reason from raw pixels every time.

---

# 4. Use the JARVIS computer-use implementation

Inspect and reuse the JARVIS implementation around:

```text
agentes/computer_use/
agentes/computer_use/agente.py
agentes/computer_use/playwright_computer.py

tools/
input_tools.py
screen_tools.py
task_tools.py
system_tools.py
web_tools.py
```

Do not blindly copy the entire JARVIS agent.

Extract the reusable computer-use mechanisms and adapt them into Otto's existing Tool Gateway.

Otto should have tools along the lines of:

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
desktop.mouse
desktop.keyboard
desktop.screenshot
desktop.verify
```

The exact API should be determined after inspecting the existing Otto and JARVIS implementations.

---

# 5. Observe → Act → Verify must become mandatory

Do not build a computer-use system that simply performs an action and assumes success.

Every desktop action should follow:

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
UPDATED DESKTOP STATE
```

For example:

```text
User:
"Move VS Code to the left side."

Otto:
observe desktop

find VS Code window

calculate desired position

policy check

move window

observe desktop again

verify VS Code is actually at the desired location

report success/failure
```

If the action failed, Otto should retry or explain the failure rather than claiming success.

Use JARVIS + IRIS + Kaizumi patterns where useful.

---

# 6. Mouse and hand control

The current hand-control implementation is not good enough.

Do not treat hand control as the primary computer-use mechanism.

It should become an additional input modality on top of the desktop control system.

The important objective is reliable desktop interaction.

Hand control should eventually support:

- cursor movement
- click
- drag
- window selection
- window movement
- resize
- gesture-based interaction

But reliability comes first.

The user should be able to physically control desktop objects, not merely trigger predefined animations.

If the current hand tracking implementation cannot reliably map gestures to desktop coordinates, replace/adapt it rather than preserving it for compatibility.

---

# 7. gnomelets should be studied as a reference

Inspect:

`https://github.com/raghavburtony-creator/gnomelets`

The existing Claude pet implementation apparently provides a significantly better desktop navigation/interaction experience than Otto.

Do not simply copy its UI.

Study how it handles:

- desktop positioning
- window interaction
- navigation
- desktop awareness
- application interaction
- task-bar/dock behavior
- interaction coordinates
- focus
- movement
- event handling
- persistence of desktop state

Then identify the mechanisms that should be incorporated into Otto.

The goal is:

```text
gnomelets strengths
        +
JARVIS computer-use strengths
        +
IRIS observe/act/verify
        +
Kaizumi execution/safety
        +
existing Otto avatar
        +
existing Otto ADK orchestrator
        =
Otto desktop control
```

Do not duplicate the gnomelets project as a second assistant.

---

# 8. Persistent memory is currently insufficient

Otto currently does not provide the level of persistent personal memory expected from a personal assistant.

Example:

```text
User:
"My name is Raghav."

Later:
"What is my name?"

Otto:
"Raghav."
```

This must persist across:

- conversations
- application restarts
- voice sessions
- desktop sessions

Memory should not simply be a conversation buffer.

Implement persistent memory using the strongest reusable implementation available from the inspected reference repositories, especially:

```text
Muninn
JARVIS memory patterns
current Otto memory infrastructure
```

The final system should distinguish at minimum between:

```text
episodic memory
semantic/personal facts
preferences
important user instructions
conversation/session context
temporary context
```

Example:

```text
USER_FACT
name = Raghav

PREFERENCE
preferred_editor = VS Code

PREFERENCE
preferred_browser = Firefox

INSTRUCTION
always ask before performing high-risk desktop actions
```

Memory should have:

```text
remember()
recall()
update()
forget()
search()
resurface()
```

and persistent storage.

---

# 9. Memory must be orchestrator-controlled

Do not create a second autonomous memory agent.

The architecture should be:

```text
                 OTTO ORCHESTRATOR
                        │
                  memory tools
                        │
                MemoryService
                        │
              persistent storage
```

The orchestrator decides when memory is relevant.

The MemoryService handles storage/retrieval.

The memory subsystem should never become a competing decision-maker.

---

# 10. JARVIS plugin architecture should become Otto's extension model

Inspect and reuse the JARVIS:

```text
adk_skill_loader.py
plugin_manager.py
plugin_sdk.py
mcp_client_manager.py
jarvis_mcp_server.py
plugins/
skills/
```

Otto should eventually support capabilities being added as:

```text
skill
plugin
tool
MCP server
MCP client
```

without modifying the core orchestrator every time.

Conceptually:

```text
                 OTTO ORCHESTRATOR
                        │
                   Tool Gateway
                        │
          ┌─────────────┼─────────────┐
          │             │             │
       Built-in       Plugin          MCP
        tools          tools         tools
```

The orchestrator remains the only decision authority.

---

# 11. Policy engine

Reuse the strongest policy ideas from:

```text
JARVIS policy_engine.py
Beacon approvals.py
Beacon certificate.py
Kaizumi safety.py
```

Every potentially sensitive action should pass through policy.

Conceptually:

```text
LLM decides:
"I should move/delete/send/change X"

        ↓

Policy Engine

        ↓

risk evaluation

        ↓

ALLOW / ASK / DENY

        ↓

execute

        ↓

verify

        ↓

audit
```

The LLM deciding to perform an action is not itself authorization.

---

# 12. Desktop actions should become real Otto tools

Do not create a separate "desktop agent."

Everything should be exposed through the existing Otto Tool Gateway.

For example:

```text
desktop.observe
desktop.get_windows
desktop.focus
desktop.move_window
desktop.resize_window
desktop.minimize
desktop.maximize
desktop.restore
desktop.close
desktop.workspace
desktop.click
desktop.drag
desktop.type
desktop.hotkey
desktop.screenshot
desktop.verify
```

The orchestrator selects these tools.

---

# 13. Preserve the existing Otto avatar

Do not replace the current avatar system unnecessarily.

Preserve:

```text
web/src/otto/
    Otto.tsx
    OttoDock.tsx
    OttoStage.tsx
    VoiceAssistant.tsx
    ScreenShare.tsx
    awareness/
    gemini/
    robot/
    movement/
    guidance/
    consent/
```

Improve the relationship between the avatar and the desktop shell.

The avatar should become the **embodied interface to the desktop assistant**, not a separate overlay that fights the desktop.

---

# 14. Target architecture

The resulting system should approximately become:

```text
                         OTTO
                          │
                  ONE ADK ORCHESTRATOR
                          │
          ┌───────────────┼────────────────┐
          │               │                │
       MEMORY           POLICY           TASKS
          │               │                │
       Muninn          JARVIS/Beacon     Concierge
          │               │                │
          └───────────────┼────────────────┘
                          │
                     TOOL GATEWAY
                          │
       ┌──────────────────┼──────────────────┐
       │                  │                  │
    DESKTOP             BROWSER           RESEARCH
       │                  │                  │
 JARVIS + IRIS       JARVIS/Kaizumi       WRN
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                  OBSERVE → ACT → VERIFY
                          │
                    DESKTOP STATE
                          │
                    OTTO AVATAR
```

---

# 15. Implementation strategy

Do NOT perform a superficial port.

For each JARVIS subsystem:

1. inspect the actual implementation
2. inspect the corresponding Otto implementation
3. identify duplicate functionality
4. select the stronger implementation
5. adapt it to Otto's interfaces
6. remove redundant Otto code
7. preserve Otto's ADK orchestrator
8. add tests
9. integrate with the existing desktop shell
10. verify the complete workflow

Prefer:

```text
reuse > adapt > rewrite > new implementation
```

Only write new infrastructure when neither Otto nor the reference repositories provide a suitable implementation.

Do not add another orchestrator.

Do not add another router.

Do not create JARVIS as a sub-agent.

JARVIS is a capability/infrastructure source, not another brain.

---

# 16. First milestone

The first milestone should be a **working desktop companion**, not another backend abstraction.

Definition of done:

### Desktop

- Otto behaves as a proper desktop application.
- Otto integrates correctly with the desktop task bar/dock.
- No uncontrolled always-on-top overlay.
- Otto can minimize/restore/focus normally.
- Compact assistant mode works.
- Full application mode works.

### Window management

Otto can:

- enumerate windows
- identify focused window
- focus a window
- move a window
- resize a window
- minimize
- maximize
- restore
- close
- switch workspace
- move window between workspaces where supported

### Computer use

Otto performs:

```text
observe → act → verify
```

for desktop actions.

### Memory

After restarting Otto:

```text
User:
"My name is Raghav."

restart Otto

User:
"What is my name?"

Otto:
"Raghav."
```

### Voice

The user can say:

> "Move VS Code to the left."

Otto should:

```text
understand intent
→ inspect desktop
→ locate VS Code
→ calculate action
→ policy check
→ move window
→ verify
→ respond
```

### Architecture

There remains exactly **one decision authority**:

```text
Google ADK Otto Orchestrator
```

Everything else is a service, tool, executor, memory system, policy engine, perception system, or task engine.

---

# Important

Do not stop after implementing the architecture.

Actually exercise the workflows against the Linux desktop.

The desktop interaction quality is currently more important than adding another abstract layer.

If the existing gnomelets implementation provides a better practical solution for desktop navigation than the current Otto implementation, prefer adapting that working mechanism over preserving Otto's weaker implementation.

The objective is not to make Otto's code look architecturally elegant.

The objective is to make Otto **actually work as a capable desktop personal assistant**.