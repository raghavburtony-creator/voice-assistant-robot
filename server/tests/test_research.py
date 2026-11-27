"""Provider-neutral research pipeline: provenance, validation and failure isolation (#53)."""
from __future__ import annotations

import asyncio

import pytest

from app.voice.research import Evidence, ResearchRequest, ResearchService, SOURCE_KINDS


class Provider:
    def __init__(self, provider_id="web-main", source_kind="web", items=(), error=None, delay=0):
        self.provider_id = provider_id
        self.source_kind = source_kind
        self.items = items
        self.error = error
        self.delay = delay
        self.requested_limit = None

    async def retrieve(self, query, limit):
        self.requested_limit = limit
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error:
            raise RuntimeError(self.error)
        return self.items


def evidence(provider="web-main", source="web", *, source_id="doc-1", title="Otto research",
             locator="https://example.test/otto", excerpt="Otto evidence and research",
             retrieved_at=None, published_at=100, confidence=None):
    return Evidence(provider, source, source_id, title, locator, excerpt, retrieved_at, published_at, confidence)


def run(coro):
    return asyncio.run(coro)


def test_retrieves_ranks_deduplicates_and_attaches_provenance():
    first = Provider(items=(
        evidence(source_id="less", title="General notes", locator="https://example.test/general", excerpt="Other topic"),
        evidence(source_id="best", title="Otto research", locator="https://example.test/otto/", excerpt="Otto research evidence"),
    ))
    second = Provider("web-backup", "web", items=(
        evidence("web-backup", source_id="duplicate", locator="https://EXAMPLE.test/otto", excerpt="Otto research"),
        evidence("web-backup", source_id="other", title="Otto", locator="https://example.test/other", excerpt="Otto evidence"),
    ))
    result = run(ResearchService((first, second)).search(ResearchRequest("  Otto   research ", limit=5)))
    assert result.query == "Otto research"
    assert result.status == "complete"
    assert [item.evidence.source_id for item in result.evidence] == ["best", "other", "less"]
    assert result.evidence[0].evidence.provider_id == "web-main"
    assert result.evidence[0].evidence.retrieved_at is not None
    assert result.evidence[0].applicability == "direct"
    assert result.evidence[-1].applicability == "unknown"
    assert result.providers[1].rejected == 0


def test_all_source_kinds_share_the_same_provider_contract():
    providers = tuple(
        Provider(f"provider-{kind}", kind, (evidence(
            f"provider-{kind}", kind, source_id=kind,
            locator="https://example.test/source" if kind == "web" else f"ref:{kind}",
        ),))
        for kind in SOURCE_KINDS
    )
    result = run(ResearchService(providers).search(ResearchRequest("Otto", limit=10)))
    assert {item.evidence.source for item in result.evidence} == set(SOURCE_KINDS)


def test_source_filter_only_calls_matching_adapters():
    web = Provider()
    memory = Provider("memory-main", "memory", (evidence("memory-main", "memory", locator="memory:42"),))
    result = run(ResearchService((web, memory)).search(ResearchRequest("Otto", sources=("memory",))))
    assert len(result.evidence) == 1
    assert result.evidence[0].evidence.source == "memory"
    assert web.requested_limit is None
    assert memory.requested_limit == 10


def test_provider_failure_is_isolated_and_exception_text_is_not_exposed():
    broken = Provider(error="api_key=super-secret-value")
    healthy = Provider("web-good", "web", (evidence("web-good"),))
    result = run(ResearchService((broken, healthy)).search(ResearchRequest("Otto")))
    assert result.status == "partial"
    assert [status.status for status in result.providers] == ["failed", "ok"]
    assert "super-secret" not in repr(result)
    assert len(result.evidence) == 1


def test_provider_timeout_is_isolated():
    slow = Provider(delay=0.05)
    fast = Provider("web-fast", "web", (evidence("web-fast"),))
    result = run(ResearchService((slow, fast), timeout_seconds=0.01).search(ResearchRequest("Otto")))
    assert result.status == "partial"
    assert [status.status for status in result.providers] == ["timeout", "ok"]
    assert len(result.evidence) == 1


def test_invalid_provider_output_does_not_crash_other_providers():
    invalid = Provider(items=None)
    healthy = Provider("web-good", "web", (evidence("web-good"),))
    result = run(ResearchService((invalid, healthy)).search(ResearchRequest("Otto")))
    assert result.status == "partial"
    assert result.providers[0].status == "invalid"
    assert len(result.evidence) == 1


@pytest.mark.parametrize("bad", [
    None, "not evidence", evidence(provider="other"), evidence(source="memory"),
    evidence(title=""), evidence(excerpt=""), evidence(locator="javascript:alert(1)"),
    evidence(locator="https://user:pass@example.test/"), evidence(retrieved_at=True),
    evidence(confidence=float("nan")), evidence(confidence=1.1),
])
def test_malformed_or_misattributed_evidence_is_dropped(bad):
    provider = Provider(items=(bad,))
    result = run(ResearchService((provider,)).search(ResearchRequest("Otto")))
    assert result.evidence == ()
    assert result.providers[0].accepted == 0
    assert result.providers[0].rejected == 1
    assert result.status == "unavailable"


def test_request_and_service_limits_are_validated():
    with pytest.raises(ValueError):
        ResearchService((Provider("duplicate"), Provider("duplicate")))
    with pytest.raises(ValueError):
        ResearchService((Provider(),), timeout_seconds=float("nan"))
    with pytest.raises(ValueError):
        run(ResearchService().search(ResearchRequest("   ")))
    with pytest.raises(ValueError):
        run(ResearchService().search(ResearchRequest("ok", limit=21)))
    with pytest.raises(ValueError):
        run(ResearchService().search(ResearchRequest("ok", sources=("unknown",))))


def test_empty_registry_reports_unavailable_instead_of_fabricating_evidence():
    result = run(ResearchService().search(ResearchRequest("Otto")))
    assert result.status == "unavailable"
    assert result.evidence == ()
    assert result.providers == ()



def test_oversized_provider_confidence_is_rejected_without_discarding_healthy_results():
    malformed = Provider(items=(evidence(confidence=10**1000),))
    healthy = Provider("web-good", "web", (evidence("web-good"),))

    result = run(ResearchService((malformed, healthy)).search(ResearchRequest("Otto")))

    assert result.status == "partial"
    assert result.providers[0].accepted == 0
    assert result.providers[0].rejected == 1
    assert result.providers[1].accepted == 1
    assert [item.evidence.provider_id for item in result.evidence] == ["web-good"]

def test_provider_confidence_is_preserved_as_unverified_metadata():
    provider = Provider(items=(evidence(confidence=0.75),))
    result = run(ResearchService((provider,)).search(ResearchRequest("Otto")))
    assert result.evidence[0].provider_confidence == 0.75
    assert result.evidence[0].evidence.confidence == 0.75
