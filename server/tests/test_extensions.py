from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest

from app.voice.extensions import (
    ExtensionManifest,
    ExtensionRegistry,
    ExtensionSkill,
    ExtensionTool,
)
from app.voice.tool_registry import ToolMetadata, ToolRegistry


def make_metadata(name: str = "ext_weather_current", **overrides) -> ToolMetadata:
    values = {
        "name": name,
        "family": "web_research",
        "description": "Return a read-only current weather summary.",
        "risk_level": "low",
        "required_permission": "voice_session",
        "timeout_seconds": 5,
        "supports_async": False,
        "verification_required": False,
        "side_effects": (),
        "model_visible_errors": False,
    }
    values.update(overrides)
    return ToolMetadata(**values)


def make_tool(name: str = "ext_weather_current", calls: list | None = None, **metadata_overrides) -> ExtensionTool:
    calls = calls if calls is not None else []

    def ext_weather_current(city: str, tool_context: object) -> dict:
        calls.append(city)
        return {"ok": True, "city": city}

    if name != "ext_weather_current":
        ext_weather_current.__name__ = name
    return ExtensionTool(make_metadata(name, **metadata_overrides), ext_weather_current)


def context(session_id: str = "session-1"):
    return SimpleNamespace(session=SimpleNamespace(id=session_id), state={})


def gateway_for(registry: ExtensionRegistry):
    registered = registry.tools()[0]
    tool_registry = ToolRegistry((registered.function,), metadata=(registered.metadata,))
    return registered, tool_registry._gateway(registered.function, registered.metadata)


def test_manifest_tool_is_namespaced_schema_checked_and_policy_gated():
    calls: list[str] = []
    tool = make_tool(calls=calls)
    registry = ExtensionRegistry((ExtensionManifest("weather", "1.0.0", (tool,)),))
    registered, gateway = gateway_for(registry)

    before_start = gateway(city="Port Louis", tool_context=context())
    assert before_start["status"] == "error"
    assert calls == []

    results = asyncio.run(registry.start_session("session-1"))
    assert results[0].success is True
    assert registry.is_active("session-1", "weather")

    result = gateway(city="Port Louis", tool_context=context())
    assert result["status"] == "success"
    assert result["data"] == {"ok": True, "city": "Port Louis"}
    assert result["policy"]["decision"] == "allow"
    assert registered.metadata.name == "ext_weather_current"
    assert registered.function.__doc__ == registered.metadata.description
    assert str(registered.function.__signature__.parameters["city"].annotation) == "str"
    assert calls == ["Port Louis"]


def test_policy_chain_denies_extension_tool_without_a_live_voice_session():
    registry = ExtensionRegistry((ExtensionManifest("weather", "1.0.0", (make_tool(),)),))
    registered, gateway = gateway_for(registry)
    asyncio.run(registry.start_session("session-1"))

    result = gateway(city="Curepipe", tool_context=SimpleNamespace(session=None, state={}))
    assert result["status"] == "error"
    assert result["policy"]["decision"] == "deny"


def test_failed_start_hook_disables_only_that_extension():
    calls: list[str] = []

    async def broken_start(session_id: str) -> None:
        raise RuntimeError("must not leak this detail")

    async def healthy_start(session_id: str) -> None:
        calls.append(session_id)

    broken = ExtensionManifest("broken", "1.0.0", (make_tool("ext_broken_lookup"),), broken_start)
    healthy = ExtensionManifest("healthy", "1.0.0", (make_tool("ext_healthy_lookup"),), healthy_start)
    registry = ExtensionRegistry((broken, healthy))

    results = asyncio.run(registry.start_session("session-2"))
    assert [result.success for result in results] == [False, True]
    assert registry.is_active("session-2", "healthy")
    assert not registry.is_active("session-2", "broken")
    assert calls == ["session-2"]


def test_end_hooks_run_in_reverse_order_and_one_failure_does_not_skip_the_next(caplog):
    ended: list[str] = []

    async def first_end(session_id: str) -> None:
        ended.append("first")
        raise RuntimeError("private")

    async def second_end(session_id: str) -> None:
        ended.append("second")

    registry = ExtensionRegistry((
        ExtensionManifest("first", "1.0.0", (make_tool("ext_first_lookup"),), on_session_end=first_end),
        ExtensionManifest("second", "1.0.0", (make_tool("ext_second_lookup"),), on_session_end=second_end),
    ))
    asyncio.run(registry.start_session("session-3"))
    results = asyncio.run(registry.stop_session("session-3"))

    assert ended == ["second", "first"]
    assert [result.success for result in results] == [True, False]
    assert "private" not in caplog.text
    assert not registry.is_active("session-3", "first")


@pytest.mark.parametrize("extension_id,version", [
    ("Not Valid", "1.0.0"),
    ("weather", "v1"),
])
def test_invalid_extension_identity_or_version_is_rejected(extension_id, version):
    with pytest.raises(ValueError):
        ExtensionRegistry((ExtensionManifest(extension_id, version, (make_tool(),)),))


@pytest.mark.parametrize("overrides", [
    {"risk_level": "high"},
    {"required_permission": "active_capture"},
    {"side_effects": ("browser_navigation",)},
    {"supports_async": True},
    {"verification_required": True},
    {"model_visible_errors": True},
    {"timeout_seconds": 30},
])
def test_extensions_reject_risky_or_unbounded_tool_metadata(overrides):
    with pytest.raises(ValueError):
        ExtensionRegistry((ExtensionManifest("weather", "1.0.0", (make_tool(**overrides),)),))


def test_extension_tools_must_use_their_namespaced_identifier():
    with pytest.raises(ValueError):
        ExtensionRegistry((ExtensionManifest("weather", "1.0.0", (make_tool("get_weather"),)),))


def test_extension_tool_must_be_synchronous_and_have_a_typed_context():
    async def ext_weather_current(city: str, tool_context: object) -> dict:
        return {"ok": True, "city": city}

    tool = ExtensionTool(make_metadata(), ext_weather_current)
    with pytest.raises(ValueError):
        ExtensionRegistry((ExtensionManifest("weather", "1.0.0", (tool,)),))

def test_extension_tool_rejects_untyped_arguments():
    def ext_weather_current(city, tool_context: object) -> dict:
        return {"ok": True, "city": city}

    tool = ExtensionTool(make_metadata(), ext_weather_current)
    with pytest.raises(ValueError):
        ExtensionRegistry((ExtensionManifest("weather", "1.0.0", (tool,)),))


def test_duplicate_extension_ids_and_tool_names_are_rejected():
    one = ExtensionManifest("weather", "1.0.0", (make_tool(),))
    two = ExtensionManifest("weather", "1.0.0", (make_tool("ext_weather_forecast"),))
    with pytest.raises(ValueError):
        ExtensionRegistry((one, two))

    duplicate_tools = ExtensionManifest("weather-extra", "1.0.0", (
        make_tool("ext_weather_extra_lookup"),
        make_tool("ext_weather_extra_lookup"),
    ))
    with pytest.raises(ValueError):
        ExtensionRegistry((duplicate_tools,))


def test_extension_session_activation_is_scoped_to_each_session():
    registry = ExtensionRegistry((ExtensionManifest("weather", "1.0.0", (make_tool(),)),))
    asyncio.run(registry.start_session("session-a"))
    assert registry.is_active("session-a", "weather")
    assert not registry.is_active("session-b", "weather")
    asyncio.run(registry.stop_session("session-a"))
    assert not registry.is_active("session-a", "weather")


def test_skills_are_available_as_bounded_stable_guidance_without_adding_tools():
    first = ExtensionManifest(
        extension_id="research",
        version="1.0.0",
        skills=(
            ExtensionSkill(
                skill_id="source-check",
                description="Check sources before summarising.",
                instructions="Prefer primary sources and distinguish evidence from inference.",
            ),
        ),
    )
    second = ExtensionManifest(
        extension_id="formatting",
        version="1.0.0",
        skills=(
            ExtensionSkill(
                skill_id="plain-language",
                description="Explain results in plain language.",
                instructions="Use short sentences and explain technical terms.",
            ),
        ),
    )
    registry = ExtensionRegistry((first, second))

    prompt = registry.skill_prompt()
    assert prompt.startswith("Installed skills (reviewed server-provided guidance;")
    assert prompt.index("research/source-check") < prompt.index("formatting/plain-language")
    assert "Prefer primary sources" in prompt
    assert "do not grant permissions" in prompt
    assert registry.tools() == ()


def test_extension_skill_ids_are_namespaced_and_validated():
    invalid = ExtensionSkill("Bad ID", "Description", "Instructions")
    with pytest.raises(ValueError):
        ExtensionRegistry((ExtensionManifest("research", "1.0.0", skills=(invalid,)),))

    empty = ExtensionSkill("empty", "Description", "   ")
    with pytest.raises(ValueError):
        ExtensionRegistry((ExtensionManifest("research", "1.0.0", skills=(empty,)),))

    duplicate = ExtensionManifest(
        "research",
        "1.0.0",
        skills=(
            ExtensionSkill("same", "One", "Instruction one."),
            ExtensionSkill("same", "Two", "Instruction two."),
        ),
    )
    with pytest.raises(ValueError):
        ExtensionRegistry((duplicate,))


def test_skill_descriptions_and_instructions_are_bounded_plain_text():
    oversized = ExtensionSkill("long", "Description", "x" * 4_001)
    with pytest.raises(ValueError):
        ExtensionRegistry((ExtensionManifest("research", "1.0.0", skills=(oversized,)),))

    control = ExtensionSkill("control", "Description", "safe" + chr(0) + "unsafe")
    with pytest.raises(ValueError):
        ExtensionRegistry((ExtensionManifest("research", "1.0.0", skills=(control,)),))


def test_skill_prompt_combined_budget_is_checked_at_registry_construction():
    too_many = ExtensionManifest(
        "research",
        "1.0.0",
        skills=tuple(
            ExtensionSkill(f"skill-{index}", "Description", "x" * 4_000)
            for index in range(1, 5)
        ),
    )
    with pytest.raises(ValueError):
        ExtensionRegistry((too_many,))


def test_manifests_must_declare_at_least_one_tool_or_skill():
    with pytest.raises(ValueError):
        ExtensionRegistry((ExtensionManifest("empty", "1.0.0"),))
