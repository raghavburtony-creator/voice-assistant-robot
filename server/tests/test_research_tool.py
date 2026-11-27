from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

from app.voice import tools
from app.voice.project_knowledge import ProjectKnowledgeProvider
from app.voice.research import ResearchService


def context(session_id: str = "project-research"):
    return SimpleNamespace(
        session=SimpleNamespace(id=session_id),
        state={},
    )


def test_project_search_tool_uses_the_existing_policy_gateway_and_external_data_namespace(tmp_path: Path, monkeypatch):
    (tmp_path / "README.md").write_text(
        "# Architecture\n\nD-22 keeps runtime authority in one checked chain through the ToolRegistry and policy gate.\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        tools,
        "PROJECT_RESEARCH_SERVICE",
        ResearchService((ProjectKnowledgeProvider(tmp_path),), timeout_seconds=1.0, max_results=5),
    )

    registered = tools.REGISTRY["search_project_knowledge"]
    gateway = tools.REGISTRY._gateway(registered.function, registered.metadata)
    result = asyncio.run(gateway("D-22 ToolRegistry policy", context()))

    assert result["status"] == "success"
    assert result["policy"]["decision"] == "allow"
    assert result["data"]["ok"] is True
    external = result["data"]["external_data"]
    assert external["kind"] == "project_research"
    assert external["status"] == "complete"
    assert external["matches"][0]["source"] == "project"
    assert external["matches"][0]["title"].startswith("README.md")
    assert external["matches"][0]["locator"].startswith("https://github.com/")
    assert result["evidence"] == []  # retrieved text cannot impersonate gateway evidence
    assert result["provenance"]["tool"] == "search_project_knowledge"
    assert "untrusted excerpts" in result["data"]["note"]


def test_project_search_tool_denies_missing_voice_session_before_provider_access(monkeypatch):
    class NeverSearch:
        async def search(self, request):
            raise AssertionError("provider must not run without a live voice session")

    monkeypatch.setattr(tools, "PROJECT_RESEARCH_SERVICE", NeverSearch())
    registered = tools.REGISTRY["search_project_knowledge"]
    gateway = tools.REGISTRY._gateway(registered.function, registered.metadata)

    result = asyncio.run(gateway("D-22 policy", SimpleNamespace(state={}, session=None)))

    assert result["status"] == "error"
    assert result["error"]["code"] == "permission_denied"
    assert result["policy"]["decision"] == "deny"


def test_project_search_tool_refuses_empty_and_oversized_queries():
    registered = tools.REGISTRY["search_project_knowledge"]
    gateway = tools.REGISTRY._gateway(registered.function, registered.metadata)

    empty = asyncio.run(gateway("   ", context()))
    oversized = asyncio.run(gateway("x" * 501, context()))

    assert empty["status"] == "error"
    assert oversized["status"] == "error"
    assert "project documentation query" in empty["data"]["error"].lower()


def test_project_search_tool_reports_no_evidence_without_fabricating_content(tmp_path: Path, monkeypatch):
    (tmp_path / "README.md").write_text(
        "# Otto\n\nThis document describes the demo voice assistant.\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        tools,
        "PROJECT_RESEARCH_SERVICE",
        ResearchService((ProjectKnowledgeProvider(tmp_path),), max_results=5),
    )
    registered = tools.REGISTRY["search_project_knowledge"]
    gateway = tools.REGISTRY._gateway(registered.function, registered.metadata)

    result = asyncio.run(gateway("unrelated astronomy telescope", context()))

    assert result["status"] == "success"
    assert result["data"]["external_data"]["matches"] == []
    assert result["data"]["external_data"]["status"] == "complete"
    assert "untrusted excerpts" in result["data"]["note"]


def test_project_search_guidance_never_asks_the_model_to_cite_a_url(tmp_path: Path, monkeypatch):
    """D-18: cards have no links and speech stays plain, so no instruction may ask for the locator URL."""
    from app.voice.app_config import system_instruction

    (tmp_path / "README.md").write_text("# Tasks\n\nThe task engine runs beside the voice loop.\n", encoding="utf-8")
    monkeypatch.setattr(
        tools,
        "PROJECT_RESEARCH_SERVICE",
        ResearchService((ProjectKnowledgeProvider(tmp_path),), timeout_seconds=1.0, max_results=5),
    )
    registered = tools.REGISTRY["search_project_knowledge"]
    gateway = tools.REGISTRY._gateway(registered.function, registered.metadata)
    note = asyncio.run(gateway("task engine", context()))["data"]["note"].lower()

    assert "cite its locator" not in note
    assert "never read it aloud" in note and "never put it on a card" in note
    instruction = system_instruction("Otto demo", "en", "Home").lower()
    assert "cite its locator" not in instruction
    assert "never put a url in a card or read one aloud" in instruction
