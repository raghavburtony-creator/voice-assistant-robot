from __future__ import annotations

from app.voice.tool_registry import ToolMetadata, ToolRegistry


def metadata(*, verification_required: bool = False, side_effects: tuple[str, ...] = ()) -> ToolMetadata:
    return ToolMetadata(
        name="sample",
        family="browser",
        description="A test tool",
        risk_level="low",
        required_permission="voice_session",
        timeout_seconds=5,
        supports_async=False,
        verification_required=verification_required,
        side_effects=side_effects,
    )


def test_gateway_returns_complete_success_envelope_with_provenance_and_side_effects():
    def sample(value: int) -> dict:
        return {
            "value": value,
            "evidence": [{"kind": "page_state", "id": "home"}],
            "provenance": {"source": "host_report"},
        }

    call = ToolRegistry._gateway(sample, metadata(side_effects=("browser_navigation",)))
    result = call(value=7)

    assert result["status"] == "success"
    assert result["data"]["value"] == 7
    assert result["evidence"] == [{"kind": "page_state", "id": "home"}]
    assert result["provenance"] == {"source": "host_report"}
    assert result["verification"] == {
        "required": False, "status": "not_required", "details": None,
    }
    assert result["error"] is None
    assert result["timestamps"]["started_at"].endswith("Z")
    assert result["timestamps"]["completed_at"].endswith("Z")
    assert result["side_effects"] == ["browser_navigation"]


def test_gateway_distinguishes_execution_success_from_verification_failure():
    def sample() -> dict:
        return {
            "ok": True,
            "verification": {"status": "failed", "details": "The expected state was not observed."},
        }

    call = ToolRegistry._gateway(sample, metadata(verification_required=True))
    result = call()

    assert result["status"] == "success"
    assert result["error"] is None
    assert result["verification"] == {
        "required": True,
        "status": "failed",
        "details": "The expected state was not observed.",
    }


def test_gateway_marks_verification_pending_when_a_required_check_has_not_run():
    def sample() -> dict:
        return {"ok": True, "requested": "launch_calculator"}

    call = ToolRegistry._gateway(sample, metadata(verification_required=True))
    result = call()

    assert result["status"] == "success"
    assert result["verification"]["required"] is True
    assert result["verification"]["status"] == "pending"


def test_gateway_reports_validation_failure_without_echoing_invalid_input():
    def sample(value: int) -> dict:
        return {"value": value}

    call = ToolRegistry._gateway(sample, metadata())
    result = call(value="do-not-echo-this")

    assert result["status"] == "error"
    assert result["error"]["code"] == "invalid_arguments"
    assert "do-not-echo-this" not in str(result)
    assert result["verification"]["status"] == "not_required"


def test_gateway_separates_tool_execution_failure_from_verification_failure():
    def sample() -> dict:
        return {"ok": False, "error": "internal detail"}

    call = ToolRegistry._gateway(sample, metadata(verification_required=True))
    result = call()

    assert result["status"] == "error"
    assert result["error"]["code"] == "tool_execution_failed"
    assert result["verification"]["status"] == "not_run"
    assert "internal detail" not in str(result)


def test_gateway_converts_unhandled_tool_exception_to_safe_error_envelope(caplog):
    def sample() -> dict:
        raise RuntimeError("sensitive internal detail")

    call = ToolRegistry._gateway(sample, metadata())
    result = call()

    assert result["status"] == "error"
    assert result["error"]["code"] == "tool_execution_error"
    assert "sensitive internal detail" not in str(result)
    assert "RuntimeError" in caplog.text
    assert "sensitive internal detail" not in caplog.text


def test_registry_output_schema_requires_evidence_provenance_verification_and_side_effects():
    schema = ToolRegistry._output_schema()

    assert schema["required"] == [
        "status", "data", "evidence", "provenance", "verification",
        "error", "timestamps", "side_effects",
    ]
    assert schema["properties"]["verification"]["properties"]["status"]["enum"] == [
        "not_required", "pending", "passed", "failed", "not_run",
    ]
