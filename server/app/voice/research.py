"""Provider-neutral retrieval, ranking and provenance for Otto research.

This is a bounded service contract, not an agent or action router (D-19, D-22).
Adapters retrieve source-backed evidence; this module validates, ranks and labels it.
Retrieved text remains untrusted data and is never executed or persisted here.
"""
from __future__ import annotations

import asyncio
import math
import re
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Literal, Protocol, Sequence
from urllib.parse import urlsplit

SourceKind = Literal["web", "local_file", "project", "connected_service", "memory"]
ProviderState = Literal["ok", "empty", "timeout", "failed", "invalid"]
Applicability = Literal["direct", "related", "unknown"]
SOURCE_KINDS = frozenset({"web", "local_file", "project", "connected_service", "memory"})
MAX_QUERY_CHARS = 500
MAX_RESULTS = 20
MAX_PROVIDERS = 12
MAX_PROVIDER_RESULTS = 40
MAX_PROVIDER_ID_CHARS = 64
MAX_SOURCE_ID_CHARS = 240
MAX_TITLE_CHARS = 240
MAX_LOCATOR_CHARS = 2048
MAX_EXCERPT_CHARS = 4000
DEFAULT_PROVIDER_TIMEOUT_SECONDS = 5.0
_TOKEN = re.compile(r"[\w]{2,}", re.UNICODE)
_IDENTIFIER = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._:-]*$")


@dataclass(frozen=True)
class ResearchRequest:
    """Bounded query; an empty source tuple selects every registered adapter."""
    query: str
    limit: int = 10
    sources: tuple[SourceKind, ...] = ()


@dataclass(frozen=True)
class Evidence:
    """A source-backed item with stable provenance supplied by its adapter."""
    provider_id: str
    source: SourceKind
    source_id: str
    title: str
    locator: str
    excerpt: str
    retrieved_at: int | None = None
    published_at: int | None = None
    # Adapter-supplied metadata only; this is not a probability that the claim is true.
    confidence: float | None = None


@dataclass(frozen=True)
class RankedEvidence:
    evidence: Evidence
    relevance: float
    applicability: Applicability
    provider_confidence: float | None = None


@dataclass(frozen=True)
class ProviderStatus:
    provider_id: str
    source: SourceKind
    status: ProviderState
    accepted: int = 0
    rejected: int = 0


@dataclass(frozen=True)
class ResearchResult:
    query: str
    evidence: tuple[RankedEvidence, ...]
    providers: tuple[ProviderStatus, ...]
    status: Literal["complete", "partial", "unavailable"]


class ResearchProvider(Protocol):
    provider_id: str
    source_kind: SourceKind

    async def retrieve(self, query: str, limit: int) -> Sequence[Evidence]:
        """Return source-backed evidence, not a model-generated answer."""


class ResearchService:
    """Concurrent provider pipeline with bounded inputs and isolated failures."""

    def __init__(
        self,
        providers: Sequence[ResearchProvider] = (),
        *,
        timeout_seconds: float = DEFAULT_PROVIDER_TIMEOUT_SECONDS,
        max_results: int = MAX_RESULTS,
    ) -> None:
        if len(providers) > MAX_PROVIDERS:
            raise ValueError(f"At most {MAX_PROVIDERS} research providers may be registered")
        if isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, (int, float)) or not math.isfinite(timeout_seconds) or not 0 < timeout_seconds <= 30:
            raise ValueError("Provider timeout must be a finite number between 0 and 30 seconds")
        if isinstance(max_results, bool) or not isinstance(max_results, int) or not 1 <= max_results <= MAX_RESULTS:
            raise ValueError(f"Result limit must be between 1 and {MAX_RESULTS}")

        registered: dict[str, ResearchProvider] = {}
        for provider in providers:
            provider_id = getattr(provider, "provider_id", None)
            source = getattr(provider, "source_kind", None)
            if not isinstance(provider_id, str) or len(provider_id) > MAX_PROVIDER_ID_CHARS or not _IDENTIFIER.fullmatch(provider_id):
                raise ValueError("Each provider needs a short, stable identifier")
            if not isinstance(source, str) or source not in SOURCE_KINDS or not callable(getattr(provider, "retrieve", None)):
                raise ValueError(f"Provider {provider_id!r} has an unsupported source or no retrieve method")
            if provider_id in registered:
                raise ValueError(f"Duplicate research provider: {provider_id}")
            registered[provider_id] = provider

        self._providers = tuple(registered.values())
        self.timeout_seconds = float(timeout_seconds)
        self.max_results = max_results

    async def search(self, request: ResearchRequest) -> ResearchResult:
        query, limit, sources = self._validate_request(request)
        selected = tuple(p for p in self._providers if not sources or p.source_kind in sources)
        if not selected:
            return ResearchResult(query, (), (), "unavailable")

        batches = await asyncio.gather(*(self._retrieve(p, query, limit) for p in selected))
        query_terms = set(_TOKEN.findall(query.casefold()))
        ranked: list[RankedEvidence] = []
        statuses: list[ProviderStatus] = []
        seen: set[tuple[str, str]] = set()

        for provider, (items, status, rejected) in zip(selected, batches):
            accepted = 0
            for item in items:
                clean = self._validate_evidence(item, provider, int(datetime.now(timezone.utc).timestamp()))
                if clean is None:
                    rejected += 1
                    continue
                key = (clean.source, self._dedupe_locator(clean))
                if key in seen:
                    continue
                seen.add(key)
                score = self._relevance(query_terms, clean)
                applicability: Applicability = "direct" if score >= 0.6 else "related" if score >= 0.2 else "unknown"
                ranked.append(RankedEvidence(clean, score, applicability, clean.confidence))
                accepted += 1
            statuses.append(ProviderStatus(provider.provider_id, provider.source_kind, status, accepted, rejected))

        ranked.sort(key=lambda item: (
            -item.relevance,
            -(item.evidence.published_at or 0),
            item.evidence.provider_id,
            item.evidence.source_id,
        ))
        limited = tuple(ranked[:min(limit, self.max_results)])
        failed = any(item.status in {"timeout", "failed", "invalid"} or item.rejected for item in statuses)
        if failed and (limited or any(item.accepted for item in statuses)):
            state = "partial"
        elif failed:
            state = "unavailable"
        else:
            state = "complete"
        return ResearchResult(query, limited, tuple(statuses), state)

    async def _retrieve(
        self, provider: ResearchProvider, query: str, limit: int
    ) -> tuple[Sequence[Evidence], ProviderState, int]:
        try:
            result = await asyncio.wait_for(
                provider.retrieve(query, min(limit, MAX_PROVIDER_RESULTS)),
                timeout=self.timeout_seconds,
            )
        except asyncio.TimeoutError:
            return (), "timeout", 0
        except Exception:
            # Never expose provider exception text; it may contain secrets or private paths.
            return (), "failed", 0
        if not isinstance(result, Sequence) or isinstance(result, (str, bytes, bytearray)):
            return (), "invalid", 1
        if len(result) > MAX_PROVIDER_RESULTS:
            return tuple(result[:MAX_PROVIDER_RESULTS]), "invalid", len(result) - MAX_PROVIDER_RESULTS
        return result, "ok" if result else "empty", 0

    @staticmethod
    def _validate_request(request: ResearchRequest) -> tuple[str, int, tuple[str, ...]]:
        if not isinstance(request, ResearchRequest) or not isinstance(request.query, str):
            raise ValueError("A research request with a text query is required")
        query = " ".join(request.query.split())
        if not query or len(query) > MAX_QUERY_CHARS:
            raise ValueError(f"Research query must contain 1 to {MAX_QUERY_CHARS} characters")
        if isinstance(request.limit, bool) or not isinstance(request.limit, int) or not 1 <= request.limit <= MAX_RESULTS:
            raise ValueError(f"Research result limit must be between 1 and {MAX_RESULTS}")
        if not isinstance(request.sources, tuple) or any(not isinstance(s, str) or s not in SOURCE_KINDS for s in request.sources):
            raise ValueError("Research sources must be a tuple of supported source kinds")
        return query, request.limit, request.sources

    @staticmethod
    def _validate_evidence(item: object, provider: ResearchProvider, now: int) -> Evidence | None:
        if not isinstance(item, Evidence) or item.provider_id != provider.provider_id or item.source != provider.source_kind:
            return None
        fields = (
            (item.source_id, MAX_SOURCE_ID_CHARS),
            (item.title, MAX_TITLE_CHARS),
            (item.locator, MAX_LOCATOR_CHARS),
            (item.excerpt, MAX_EXCERPT_CHARS),
        )
        if any(not isinstance(value, str) or not value.strip() or len(value) > cap for value, cap in fields):
            return None
        if any(ord(char) < 0x20 for value in (item.source_id, item.locator) for char in value):
            return None
        if any(ord(char) < 0x20 and char not in "\n\r\t" for value in (item.title, item.excerpt) for char in value):
            return None
        if item.source == "web":
            try:
                parsed = urlsplit(item.locator)
                if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
                    return None
            except ValueError:
                return None
        retrieved = item.retrieved_at if item.retrieved_at is not None else now
        if isinstance(retrieved, bool) or not isinstance(retrieved, int) or not 0 <= retrieved <= now + 300:
            return None
        if item.published_at is not None and (isinstance(item.published_at, bool) or not isinstance(item.published_at, int) or item.published_at < 0):
            return None
        if item.confidence is not None and (
            isinstance(item.confidence, bool) or not isinstance(item.confidence, (int, float))
            or not math.isfinite(item.confidence) or not 0 <= item.confidence <= 1
        ):
            return None
        return replace(item, retrieved_at=retrieved, confidence=float(item.confidence) if item.confidence is not None else None)

    @staticmethod
    def _dedupe_locator(item: Evidence) -> str:
        if item.source == "web":
            parsed = urlsplit(item.locator)
            path = parsed.path.rstrip("/") or "/"
            return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}{path}?{parsed.query}"
        return item.locator.strip().casefold()

    @staticmethod
    def _relevance(query_terms: set[str], item: Evidence) -> float:
        if not query_terms:
            return 0.0
        evidence_terms = set(_TOKEN.findall(f"{item.title} {item.excerpt}".casefold()))
        return round(len(query_terms & evidence_terms) / len(query_terms), 4)
