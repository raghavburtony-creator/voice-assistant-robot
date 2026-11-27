from __future__ import annotations

import asyncio
from pathlib import Path

from app.voice.project_knowledge import (
    PROJECT_DOCUMENTS,
    ProjectKnowledgeProvider,
)


def test_project_provider_searches_only_the_reviewed_document_allow_list(tmp_path: Path):
    (tmp_path / "README.md").write_text(
        "# Otto voice kit\n\nThe ToolRegistry validates tool calls and records policy decisions.\n",
        encoding="utf-8",
    )
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "architecture.md").write_text(
        "# Architecture\n\nD-22 keeps ToolRegistry authority in a checked chain with a policy gate.\n",
        encoding="utf-8",
    )
    (tmp_path / "private.txt").write_text(
        "ToolRegistry password=not-for-retrieval\n",
        encoding="utf-8",
    )

    results = asyncio.run(ProjectKnowledgeProvider(tmp_path).retrieve("ToolRegistry policy", 5))

    assert results
    assert all(item.source == "project" for item in results)
    assert all(item.provider_id == "otto-project-docs" for item in results)
    assert any(item.source_id.startswith("README.md#section-") for item in results)
    assert any(item.source_id.startswith("docs/architecture.md#section-") for item in results)
    assert all("private.txt" not in item.source_id for item in results)
    assert all("not-for-retrieval" not in item.excerpt for item in results)


def test_project_provider_returns_stable_public_locators_not_absolute_paths(tmp_path: Path):
    (tmp_path / "README.md").write_text(
        "# Research\n\nEvidence is retrieved from project documentation with provenance.\n",
        encoding="utf-8",
    )
    results = asyncio.run(ProjectKnowledgeProvider(tmp_path).retrieve("evidence provenance", 5))

    assert results
    assert results[0].locator.startswith(
        "https://github.com/raghavburtony-creator/voice-assistant-robot/blob/main/"
    )
    assert str(tmp_path) not in results[0].locator
    assert results[0].retrieved_at is None  # ResearchService supplies the trusted retrieval time.


def test_project_provider_skips_symlinks_that_escape_the_repository(tmp_path: Path):
    outside = tmp_path.parent / "outside-project-doc.md"
    outside.write_text("# Secrets\n\nA private project secret.\n", encoding="utf-8")
    (tmp_path / "docs").mkdir()
    (tmp_path / "README.md").symlink_to(outside)

    results = asyncio.run(ProjectKnowledgeProvider(tmp_path).retrieve("private secret", 5))

    assert results == ()


def test_project_provider_skips_oversized_and_non_utf8_documents(tmp_path: Path):
    (tmp_path / "README.md").write_bytes(b"# " + b"x" * (256 * 1024 + 1))
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "architecture.md").write_bytes(b"\xff\xfe\x00")

    results = asyncio.run(ProjectKnowledgeProvider(tmp_path).retrieve("architecture project", 5))

    assert results == ()


def test_project_provider_rejects_unbounded_queries_and_invalid_limits(tmp_path: Path):
    (tmp_path / "README.md").write_text(
        "# Otto\n\nProject knowledge and documentation.\n",
        encoding="utf-8",
    )
    provider = ProjectKnowledgeProvider(tmp_path)

    assert asyncio.run(provider.retrieve("x" * 501, 5)) == ()
    assert asyncio.run(provider.retrieve("Otto", 0)) == ()
    assert asyncio.run(provider.retrieve("Otto", True)) == ()
    assert asyncio.run(provider.retrieve("   ", 5)) == ()


def test_provider_reads_only_known_project_paths():
    assert "README.md" in PROJECT_DOCUMENTS
    assert "docs/architecture.md" in PROJECT_DOCUMENTS
    assert "private.txt" not in PROJECT_DOCUMENTS
