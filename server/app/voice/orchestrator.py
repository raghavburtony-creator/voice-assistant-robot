"""The single ADK decision-maker for an Otto voice session.

The orchestrator owns model-driven planning, tool selection and response generation.
It does not grant permissions or execute side effects: tool, browser and native
checks remain separate links in the authority chain (D-02, D-22).
"""
from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any, Protocol, runtime_checkable


@runtime_checkable
class Orchestrator(Protocol):
    """Canonical interface for the component that plans and responds to the visitor."""

    def build_agent(self) -> Any:
        """Build the model agent that owns intent, planning and tool selection."""
        ...


class AdkOrchestrator:
    """Google ADK implementation of Otto's orchestration interface.

    Transport, session lifecycle and output delivery belong to the bridge. The
    orchestrator receives the registered capabilities but cannot bypass their
    server-side checks or the downstream browser/native validation.
    """

    def __init__(
        self,
        *,
        model: Any,
        instruction: str,
        tools: Sequence[Any],
        agent_factory: Callable[..., Any] | None = None,
    ) -> None:
        self._model = model
        self._instruction = instruction
        self._tools = tuple(tools)
        self._agent_factory = agent_factory

    def build_agent(self) -> Any:
        factory = self._agent_factory
        if factory is None:
            # Keep the optional ADK dependency lazy for tests and non-voice server paths.
            from google.adk.agents import LlmAgent

            factory = LlmAgent
        return factory(
            name="voice_guide",
            model=self._model,
            instruction=self._instruction,
            tools=list(self._tools),
        )
