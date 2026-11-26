"""Architecture contract for Otto's single model-driven orchestrator."""
from __future__ import annotations

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
    constructors = [
        path.name
        for path in VOICE_DIR.glob("*.py")
        if "LlmAgent(" in path.read_text(encoding="utf-8")
    ]
    assert constructors == ["orchestrator.py"]
