"""Read-only, allow-listed project documentation provider for RESEARCH-01.

The provider never accepts a caller-supplied path. It reads only reviewed Markdown
files from this repository and returns bounded excerpts with stable source locators.
"""
from __future__ import annotations

import asyncio
import re
from pathlib import Path, PurePosixPath
from typing import Sequence
from urllib.parse import quote

from app.voice.research import Evidence, MAX_PROVIDER_RESULTS, SourceKind

PROVIDER_ID = "otto-project-docs"
SOURCE_KIND: SourceKind = "project"
REPOSITORY_URL = "https://github.com/raghavburtony-creator/voice-assistant-robot"
PROJECT_ROOT = Path(__file__).resolve().parents[3]
PROJECT_DOCUMENTS = (
    "README.md",
    "docs/architecture.md",
    "docs/decisions.md",
    "docs/roadmap.md",
)
MAX_DOCUMENT_BYTES = 256 * 1024
MAX_CANDIDATE_CHARS = 1_600
MAX_QUERY_CHARS = 500
_TOKEN = re.compile(r"[a-z0-9]{2,}", re.IGNORECASE)
_HEADING = re.compile(r"^#{1,6}\s+(.+?)\s*#*\s*$")


class ProjectKnowledgeProvider:
    """Search a fixed set of public project docs; never searches arbitrary local files."""

    provider_id = PROVIDER_ID
    source_kind = SOURCE_KIND

    def __init__(self, root: Path | str = PROJECT_ROOT) -> None:
        self.root = Path(root).resolve()

    async def retrieve(self, query: str, limit: int) -> Sequence[Evidence]:
        if not isinstance(query, str) or not query.strip() or len(query) > MAX_QUERY_CHARS:
            return ()
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 1:
            return ()
        return await asyncio.to_thread(self._retrieve, query, limit)

    def _retrieve(self, query: str, limit: int) -> tuple[Evidence, ...]:
        query_terms = set(_TOKEN.findall(query.casefold()))
        if not query_terms:
            return ()

        candidates: list[tuple[float, str, int, Evidence]] = []
        for relative_path in PROJECT_DOCUMENTS:
            content = self._read_allowlisted(relative_path)
            if content is None:
                continue
            for index, heading, text in self._sections(content):
                clean = " ".join(text.split())[:MAX_CANDIDATE_CHARS]
                if not clean:
                    continue
                terms = set(_TOKEN.findall(f"{heading} {clean}".casefold()))
                overlap = len(query_terms & terms)
                if not overlap:
                    continue
                title = f"{relative_path} — {heading}"[:240]
                locator = f"{REPOSITORY_URL}/blob/main/{quote(relative_path, safe='/')}"
                evidence = Evidence(
                    provider_id=self.provider_id,
                    source=self.source_kind,
                    source_id=f"{relative_path}#section-{index}",
                    title=title,
                    locator=locator,
                    excerpt=clean,
                )
                candidates.append((overlap / len(query_terms), relative_path, index, evidence))

        # This is a coarse retrieval pass only; ResearchService performs the final
        # deterministic reranking, deduplication and applicability assessment.
        candidates.sort(key=lambda item: (-item[0], item[1], item[2]))
        candidate_limit = min(MAX_PROVIDER_RESULTS, max(limit, limit * 4))
        return tuple(item[3] for item in candidates[:candidate_limit])

    def _read_allowlisted(self, relative_path: str) -> str | None:
        # Callers cannot influence relative_path: it comes only from PROJECT_DOCUMENTS.
        if relative_path not in PROJECT_DOCUMENTS:
            return None
        try:
            root = self.root.resolve(strict=True)
            candidate = (root / PurePosixPath(relative_path)).resolve(strict=True)
            candidate.relative_to(root)
            if not candidate.is_file() or candidate.stat().st_size > MAX_DOCUMENT_BYTES:
                return None
            return candidate.read_text(encoding="utf-8")
        except (OSError, UnicodeError, ValueError):
            # Missing docs, symlinks outside the project root and non-text files fail closed.
            return None

    @staticmethod
    def _sections(content: str):
        """Yield (section number, heading, paragraph) while skipping fenced code blocks."""
        heading = "Project documentation"
        paragraph: list[str] = []
        section = 0
        in_fence = False

        def flush():
            nonlocal section, paragraph
            if paragraph:
                section += 1
                text = " ".join(line.strip() for line in paragraph if line.strip())
                paragraph = []
                if text:
                    return section, heading, text
            return None

        for line in content.splitlines():
            stripped = line.strip()
            if stripped.startswith("```") or stripped.startswith("~~~"):
                in_fence = not in_fence
                continue
            if in_fence:
                continue
            match = _HEADING.match(stripped)
            if match:
                item = flush()
                if item is not None:
                    yield item
                heading = match.group(1)[:160]
                continue
            if not stripped:
                item = flush()
                if item is not None:
                    yield item
                continue
            paragraph.append(stripped)

        item = flush()
        if item is not None:
            yield item
