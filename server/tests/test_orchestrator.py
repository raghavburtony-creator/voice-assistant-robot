"""Architecture contract for Otto's single model-driven orchestrator."""
from __future__ import annotations

import ast
from pathlib import Path

from app.voice.orchestrator import AdkOrchestrator, Orchestrator

VOICE_DIR = Path(__file__).resolve().parents[1] / "app" / "voice"


def test_adk_orchestrator_implements_the_canonical_interface():
    marker = object()
    captured = {}

    def factory(**kwargs):
        captured.update(kwargs)
        return marker

    tool = object()
    orchestrator = AdkOrchestrator(
        model="test-model",
        instruction="test instruction",
        tools=[tool],
        agent_factory=factory,
    )

    assert isinstance(orchestrator, Orchestrator)
    assert orchestrator.build_agent() is marker
    assert captured == {
        "name": "voice_guide",
        "model": "test-model",
        "instruction": "test instruction",
        "tools": [tool],
    }


def test_bridge_delegates_agent_construction_to_the_orchestrator():
    bridge = (VOICE_DIR / "bridge.py").read_text(encoding="utf-8")
    assert "AdkOrchestrator(" in bridge
    assert "LlmAgent(" not in bridge


def test_feature_tools_do_not_construct_or_route_the_orchestrator():
    tools = (VOICE_DIR / "tools.py").read_text(encoding="utf-8")
    assert "LlmAgent(" not in tools
    assert "Runner(" not in tools
    assert "AdkOrchestrator(" not in tools


def test_only_the_orchestrator_module_constructs_the_adk_agent():
    # The implementation deliberately aliases LlmAgent to a factory before
    # invoking it, so scan imports and call sites rather than matching the
    # literal text "LlmAgent(".
    importing_modules = []
    for path in VOICE_DIR.glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module == "google.adk.agents":
                if any(alias.name == "LlmAgent" for alias in node.names):
                    importing_modules.append(path.name)
    assert importing_modules == ["orchestrator.py"]

    orchestrator = ast.parse(
        (VOICE_DIR / "orchestrator.py").read_text(encoding="utf-8")
    )
    aliases_factory = any(
        isinstance(node, ast.Assign)
        and isinstance(node.value, ast.Name)
        and node.value.id == "LlmAgent"
        and any(isinstance(target, ast.Name) and target.id == "factory" for target in node.targets)
        for node in ast.walk(orchestrator)
    )
    invokes_factory = any(
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "factory"
        for node in ast.walk(orchestrator)
    )
    assert aliases_factory
    assert invokes_factory
