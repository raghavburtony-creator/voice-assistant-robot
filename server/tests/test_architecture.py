"""Architecture tests for the D-22 authority chain (TEST-01, #59).

D-22 keeps Otto's authority a chain: model -> tool registry -> policy -> tool -> sink -> browser, with the bridge as the one
place that runs the ADK agent. These tests read the source (no imports run) and fail if a service starts calling back up the
chain, builds a second agent or router, or creates an import cycle. They enforce the rule "no service recursively calls the
orchestrator"; the rule is stricter than the issue's wording because there is no orchestrator to call (D-22, D-19).
"""
from __future__ import annotations

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
VOICE = APP / "voice"

#: The only modules allowed to sit at the top of the chain. Everything else in app/voice is a service below them.
ENTRY = {"bridge", "route"}
#: Modules that may talk to the ADK/Gemini SDKs. A service has no reason to.
SDK_USERS = {"bridge", "model", "tool_registry", "tools"}
SDK_PREFIXES = ("google.adk", "google.genai")


def _modules() -> dict[str, ast.Module]:
    return {p.stem: ast.parse(p.read_text(encoding="utf-8")) for p in sorted(VOICE.glob("*.py")) if p.stem != "__init__"}


def _imports(tree: ast.Module) -> set[str]:
    """Every module a file imports, at any depth (lazy imports inside functions count).

    Relative imports are resolved against app.voice, so `from .bridge import X` is seen the same as the absolute form."""
    found: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            if node.level == 0:
                base = node.module or ""
            elif node.level == 1:
                base = "app.voice" + (f".{node.module}" if node.module else "")
            else:  # `from .. import x` leaves the package; resolve it to app so the rules still see app.main
                base = "app" + (f".{node.module}" if node.module else "")
            found.add(base)
            found.update(f"{base}.{alias.name}" for alias in node.names)
        elif isinstance(node, ast.Import):
            found.update(alias.name for alias in node.names)
        elif isinstance(node, ast.Call):
            func = node.func
            name = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None
            if name in {"import_module", "__import__"}:
                found.add("<dynamic import>")
    return found


def _voice_deps(tree: ast.Module) -> set[str]:
    return {i.split(".")[2] for i in _imports(tree) if i.startswith("app.voice.") and i.count(".") >= 2}


def test_the_voice_package_has_the_modules_these_rules_name():
    # If a module is renamed, the sets above would silently match nothing; fail loudly instead.
    assert ENTRY | SDK_USERS <= set(_modules())


def test_no_module_imports_dynamically_and_the_import_reader_resolves_relative_forms():
    assert not [n for n, t in _modules().items() if "<dynamic import>" in _imports(t)], "dynamic imports hide the graph"
    seen = _imports(ast.parse("from .bridge import Bridge\nfrom . import tools\nfrom ..main import app"))
    assert {"app.voice.bridge", "app.voice.tools", "app.main"} <= seen


def test_no_service_imports_the_entry_points_or_the_app():
    offenders = []
    for name, tree in _modules().items():
        if name in ENTRY:
            continue
        for imported in _imports(tree):
            if imported == "app.main" or imported.startswith("app.voice.bridge") or imported.startswith("app.voice.route"):
                offenders.append(f"{name} imports {imported}")
    assert offenders == [], "a service must not call back up the chain: " + "; ".join(offenders)


def test_only_the_entry_points_use_the_tool_list_or_the_registry_gateway():
    # tools.py defines the list, tool_registry.py builds it, the bridge hands it to the one agent. Nothing else may reach it.
    offenders = []
    for name, tree in _modules().items():
        if name in {"tools", "tool_registry", "bridge"}:
            continue
        if any(i.startswith("app.voice.tools") for i in _imports(tree)):
            offenders.append(f"{name} imports app.voice.tools")
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr in {"adk_tools", "_gateway"}:
                offenders.append(f"{name} touches ToolRegistry.{node.attr}")
    assert offenders == [], "; ".join(offenders)


def test_the_registry_does_not_import_the_tools_it_registers():
    # tools.py imports the registry. The registry importing tools.py back would be the recursive call this issue forbids.
    assert "tools" not in _voice_deps(_modules()["tool_registry"])
    assert "policy" in _voice_deps(_modules()["tool_registry"])  # the gateway really goes through the policy engine


def test_services_do_not_touch_the_agent_sdks():
    offenders = []
    for name, tree in _modules().items():
        if name in SDK_USERS:
            continue
        for imported in _imports(tree):
            if imported.startswith(SDK_PREFIXES):
                offenders.append(f"{name} imports {imported}")
    assert offenders == [], "; ".join(offenders)


def test_only_the_bridge_builds_or_runs_an_agent_and_nothing_hands_off_to_another():
    forbidden_calls = {"LlmAgent", "Agent", "Runner", "InMemoryRunner", "run_live", "run_async", "AgentTool"}
    forbidden_keywords = {"sub_agents"}
    offenders = []
    for path in sorted(APP.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                func = node.func
                called = func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None
                if called in forbidden_calls and path.stem != "bridge":
                    offenders.append(f"{path.name} calls {called}")
                for keyword in node.keywords:
                    if keyword.arg in forbidden_keywords:
                        offenders.append(f"{path.name} passes {keyword.arg}")
            if isinstance(node, ast.Constant) and node.value == "transfer_to_agent":
                offenders.append(f"{path.name} names transfer_to_agent")
    assert offenders == [], "; ".join(offenders)
    # The bridge builds exactly one agent (D-22: one chain, not a tree of them).
    constructed = [
        n for n in ast.walk(_modules()["bridge"])
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "LlmAgent"
    ]
    assert len(constructed) == 1


def test_no_orchestrator_or_router_module_exists():
    names = {p.stem for p in VOICE.glob("*.py")}
    assert not {n for n in names if "orchestrat" in n or n in {"router", "dispatcher", "planner"}}


def test_voice_modules_form_no_import_cycle():
    graph = {name: _voice_deps(tree) & set(_modules()) - {name} for name, tree in _modules().items()}
    # route -> bridge is a lazy import inside connect_adk and is the one deliberate edge; it cannot close a cycle because
    # no service imports route (checked above), so cycles are looked for over the whole graph, edge included.
    visiting: set[str] = set()
    done: set[str] = set()

    def visit(node: str, path: list[str]) -> None:
        if node in done:
            return
        assert node not in visiting, "import cycle: " + " -> ".join([*path, node])
        visiting.add(node)
        for dep in sorted(graph.get(node, ())):
            visit(dep, [*path, node])
        visiting.discard(node)
        done.add(node)

    for module in sorted(graph):
        visit(module, [])


def test_the_policy_engine_has_no_voice_dependencies():
    # The gate must stay a leaf: if it imported a tool or the bridge it could be made to call the thing it is checking.
    assert _voice_deps(_modules()["policy"]) == set()


def test_the_task_engine_is_a_leaf_that_cannot_block_the_voice_loop_or_start_its_own_channel():
    # TASK-01 (#49). It may use the runtime id/title checks and nothing else in the voice package, so it cannot reach the
    # tools, the policy engine or the bridge. Blocking calls would stall the loop the live session runs on, and a thread or
    # process would be work the engine could not cancel; its only way out is the `emit` callable the bridge hands it.
    tree = _modules()["tasks"]
    assert _voice_deps(tree) <= {"runtime"}
    blocking = {"time.sleep", "subprocess", "threading", "multiprocessing", "concurrent", "socket", "requests", "httpx", "fastapi", "starlette"}
    assert not [i for i in _imports(tree) if i.split(".")[0] in {b.split(".")[0] for b in blocking}]
    called = {
        f"{n.func.value.id}.{n.func.attr}" for n in ast.walk(tree)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and isinstance(n.func.value, ast.Name)
    }
    assert not {"time.sleep", "asyncio.Queue", "queue.Queue"} & called, "no blocking sleep and no queue of its own (D-19: one event path)"


def test_only_the_bridge_builds_the_task_engine_so_there_is_one_per_session_and_one_way_out():
    builders = [
        name for name, tree in _modules().items() if name != "tasks"
        for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "TaskEngine"
    ]
    assert builders == ["bridge"]


def test_extension_catalog_stays_below_the_registry_and_cannot_reach_execution_entry_points():
    tree = _modules()["extensions"]
    imports = _imports(tree)
    assert "app.voice.tool_registry" in imports
    assert "app.voice.policy" in imports
    forbidden = [
        name for name in imports
        if name.startswith(("app.voice.bridge", "app.voice.route", "app.voice.tools", "app.voice.sink"))
    ]
    assert forbidden == []
