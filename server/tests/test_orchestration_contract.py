"""Contract tests for the existing ADK runtime and D-22 authority chain."""
from __future__ import annotations

import ast
from pathlib import Path

VOICE_DIR = Path(__file__).resolve().parents[1] / "app" / "voice"


def test_voice_bridge_owns_adk_agent_setup_inside_the_existing_session():
    bridge = ast.parse(
        (VOICE_DIR / "bridge.py").read_text(encoding="utf-8")
    )
    connect = next(
        node for node in bridge.body
        if isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef))
        and node.name == "connect_adk"
    )
    imports_agent = any(
        isinstance(node, ast.ImportFrom)
        and node.module == "google.adk.agents"
        and any(alias.name == "LlmAgent" for alias in node.names)
        for node in ast.walk(connect)
    )
    constructs_agent = any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "LlmAgent"
        for node in ast.walk(connect)
    )
    passes_registered_tools = any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "LlmAgent"
        and any(
            keyword.arg == "tools"
            and isinstance(keyword.value, ast.Call)
            and isinstance(keyword.value.func, ast.Name)
            and keyword.value.func.id == "list"
            and keyword.value.args
            and isinstance(keyword.value.args[0], ast.Name)
            and keyword.value.args[0].id == "TOOLS"
            for keyword in node.keywords
        )
        for node in ast.walk(connect)
    )
    assert imports_agent
    assert constructs_agent
    assert passes_registered_tools
    assert not (VOICE_DIR / "orchestrator.py").exists()


def test_feature_tools_do_not_create_agents_runners_or_a_parallel_router():
    tools = (VOICE_DIR / "tools.py").read_text(encoding="utf-8")
    assert "LlmAgent(" not in tools
    assert "Runner(" not in tools
    assert "AdkOrchestrator" not in tools
