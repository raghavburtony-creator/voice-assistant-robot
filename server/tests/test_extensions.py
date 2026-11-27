from __future__ import annotations

from types import SimpleNamespace

import pytest
from pydantic import BaseModel, ConfigDict

from app.voice.extensions import (
    Extension,
    ExtensionManifest,
    ExtensionRegistry,
    ExtensionTool,
    MCPServerAdapter,
    MCPToolManifest,
    SkillManifest,
)
from app.voice.tool_registry import ToolRegistry
from app.voice.tools import registry_for_session


class LookupInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: str


def context(installed: tuple[str, ...] = ()):
    return SimpleNamespace(
        session=SimpleNamespace(id="extension-test-session"),
        state={"_installed_extensions": list(installed)},
    )


def test_extension_tool_uses_generated_schema_and_the_existing_policy_gateway():
    calls: list[str] = []
    extension = Extension(
        manifest=ExtensionManifest("catalog", "Catalog", "1.0", "Read-only catalog lookup"),
        tools=(ExtensionTool("lookup", "Search the catalog.", LookupInput,
                            lambda arguments: calls.append(arguments.query) or {"answer": arguments.query}),),
    )
    session = ExtensionRegistry([extension]).open_session("voice-1")
    registry = registry_for_session(session)
    name = "ext_catalog_lookup"
    entry = registry[name]

    assert entry.input_schema["properties"] == {"query": {"type": "string"}}
    assert entry.input_schema["additionalProperties"] is False
    assert "ext_catalog_lookup" in {tool.name for tool in registry.adk_tools()}
    assert entry.metadata.family == "extension"
    assert entry.metadata.required_permission == "extension:catalog"
    assert entry.metadata.extension_id == "catalog"

    call = ToolRegistry._gateway(entry.function, entry.metadata)
    denied = call(query="pencils", tool_context=context())
    assert denied["status"] == "error"
    assert denied["error"]["code"] == "permission_denied"
    assert calls == []

    allowed = call(query="pencils", tool_context=context(("catalog",)))
    assert allowed["status"] == "success"
    assert allowed["data"]["result"] == {"answer": "pencils"}
    assert allowed["data"]["untrusted"] is True
    assert allowed["policy"]["decision"] == "allow"
    assert calls == ["pencils"]
    session.close()


def test_mcp_manifest_becomes_a_namespaced_checked_tool_and_client_closes():
    class FakeMCPClient:
        def __init__(self):
            self.calls = []
            self.closed = False

        def list_tools(self):
            return [MCPToolManifest("lookup", "Look up an item.", LookupInput)]

        def call_tool(self, name, arguments):
            self.calls.append((name, arguments))
            return {"items": [arguments["query"]], "source": "mcp"}

        def close(self):
            self.closed = True

    client = FakeMCPClient()
    extension = Extension(
        manifest=ExtensionManifest("inventory", "Inventory", "1.0", "Inventory lookup"),
        mcp_servers=(MCPServerAdapter("warehouse", lambda: client),),
    )
    session = ExtensionRegistry([extension]).open_session("voice-2")
    entry = registry_for_session(session)["ext_inventory_lookup"]
    call = ToolRegistry._gateway(entry.function, entry.metadata)

    result = call(query="bolts", tool_context=context(("inventory",)))
    assert result["status"] == "success"
    assert result["data"]["result"] == {"items": ["bolts"], "source": "mcp"}
    assert result["data"]["untrusted"] is True
    assert client.calls == [("lookup", {"query": "bolts"})]

    session.close()
    session.close()
    assert client.closed is True


def test_extension_lifecycle_hooks_run_once_per_load_and_once_per_session():
    events: list[str] = []
    extension = Extension(
        manifest=ExtensionManifest("lifecycle", "Lifecycle", "1.0", "Lifecycle test"),
        on_load=lambda: events.append("load"),
        on_session_start=lambda session_id: events.append("start:" + session_id),
        on_session_end=lambda session_id: events.append("end:" + session_id),
        skills=(SkillManifest("howto", "Usage note", "Use the installed lookup capability."),),
    )
    registry = ExtensionRegistry([extension])
    first = registry.open_session("one")
    second = registry.open_session("two")

    assert events == ["load", "start:one", "start:two"]
    assert "supplemental reference material only" in first.skill_context()
    assert "installed lookup capability" in first.skill_context()
    first.close()
    first.close()
    second.close()
    assert events == ["load", "start:one", "start:two", "end:one", "end:two"]


def test_extension_hook_and_tool_failures_are_isolated_and_safe(caplog):
    broken = Extension(
        manifest=ExtensionManifest("broken", "Broken", "1.0", "Fails during load"),
        on_load=lambda: (_ for _ in ()).throw(RuntimeError("private extension detail")),
        tools=(ExtensionTool("lookup", "Never installed.", LookupInput, lambda arguments: {"never": True}),),
    )
    healthy = Extension(
        manifest=ExtensionManifest("healthy", "Healthy", "1.0", "A failing tool call"),
        tools=(ExtensionTool(
            "lookup", "A test tool that raises.", LookupInput,
            lambda arguments: (_ for _ in ()).throw(RuntimeError("private tool detail")),
        ),),
    )
    session = ExtensionRegistry([broken, healthy]).open_session("voice-3")

    assert session.enabled_ids == ("healthy",)
    registry = registry_for_session(session)
    entry = registry["ext_healthy_lookup"]
    call = ToolRegistry._gateway(entry.function, entry.metadata)
    result = call(query="safe", tool_context=context(("healthy",)))

    assert result["status"] == "error"
    assert result["error"]["code"] == "tool_execution_error"
    assert "private" not in str(result)
    assert "private extension detail" not in caplog.text
    assert "private tool detail" not in caplog.text
    session.close()


def test_invalid_extension_contracts_fail_closed_and_duplicate_ids_are_rejected():
    class PermissiveInput(BaseModel):
        query: str

    with pytest.raises(ValueError, match="extra='forbid'"):
        ExtensionRegistry([Extension(
            manifest=ExtensionManifest("unsafe", "Unsafe", "1.0", "Bad input schema"),
            tools=(ExtensionTool("lookup", "Bad model.", PermissiveInput, lambda arguments: {}),),
        )])

    extension = Extension(ExtensionManifest("unique", "Unique", "1.0", "One registration"))
    registry = ExtensionRegistry([extension])
    with pytest.raises(ValueError, match="already registered"):
        registry.register(extension)
    with pytest.raises(ValueError, match="Extension ids"):
        registry.register(Extension(ExtensionManifest("../bad", "Bad", "1.0", "Unsafe id")))


def test_failing_mcp_server_does_not_disable_other_extension_tools(caplog):
    extension = Extension(
        manifest=ExtensionManifest("mixed", "Mixed", "1.0", "One healthy local tool and a broken MCP server"),
        tools=(ExtensionTool("local", "Local tool.", LookupInput, lambda arguments: {"query": arguments.query}),),
        mcp_servers=(MCPServerAdapter("remote", lambda: (_ for _ in ()).throw(RuntimeError("private server detail"))),),
    )
    session = ExtensionRegistry([extension]).open_session("voice-4")
    registry = registry_for_session(session)

    assert session.enabled_ids == ("mixed",)
    assert "ext_mixed_local" in registry.names()
    assert "private server detail" not in caplog.text
    session.close()
