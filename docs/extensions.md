# Server extensions

## Current boundary

The first EXT-01 slice provides a static, server-side manifest registry. It is deliberately narrower than a general plugin runtime:

- An extension has a lowercase kebab-case id, a `MAJOR.MINOR.PATCH` version and 1–20 declared tools.
- Every tool name is namespaced as `ext_<extension_id>_<tool_name>`.
- Tool functions must be synchronous, typed and named. They must end with a `tool_context` parameter.
- Tool metadata must declare a recognised family, `low` risk, the existing `voice_session` permission, a 1–10 second timeout, no verification requirement and no side effects.
- Optional `on_session_start(session_id: str)` and `on_session_end(session_id: str)` hooks must be async. Each hook is bounded to two seconds. Failure is isolated to that extension and session.
- The extension registry is below the existing `ToolRegistry`; calls still receive schema validation and the existing server policy decision. The model cannot install, enable or load extensions.

Extension code is trusted server code. The registry validates its declared boundary; it is **not** a Python sandbox and cannot make malicious in-process code safe. Review and pin dependencies in the deployment process before adding a manifest.

The `timeout_seconds` field is descriptive metadata for the registry, not an interrupt mechanism for synchronous Python. Tool functions in this slice must therefore be pure, fast and non-blocking; they must not perform synchronous network calls, disk I/O or wait on external processes. The two-second timeout applies to async lifecycle hooks only.

## Declaring an extension

Add a reviewed function in a server-owned module:

```python
def ext_catalog_lookup(query: str, tool_context: object) -> dict:
    # Return bounded, read-only data. Do not enqueue browser/native actions.
    return {"ok": True, "matches": []}
```

Declare it in `server/app/voice/extensions.py`:

```python
from app.voice.tool_registry import ToolMetadata

catalog = ExtensionManifest(
    extension_id="catalog",
    version="1.0.0",
    tools=(
        ExtensionTool(
            metadata=ToolMetadata(
                name="ext_catalog_lookup",
                family="web_research",
                description="Look up catalog entries without changing data.",
                risk_level="low",
                required_permission="voice_session",
                timeout_seconds=5,
                supports_async=False,
                verification_required=False,
                side_effects=(),
            ),
            function=ext_catalog_lookup,
        ),
    ),
)
EXTENSION_MANIFESTS = (catalog,)
EXTENSION_REGISTRY = ExtensionRegistry(EXTENSION_MANIFESTS)
```

The exact metadata and function must agree, and the registry rejects duplicate ids/names, unknown permissions/families, high-risk or side-effecting tools, untyped arguments and async tool functions. The surrounding application composes these entries with built-ins into one `ToolRegistry`; there is no extension-specific router or execution path.

## Lifecycle

The existing voice route starts the registry's hooks after the server session is created and stops successfully started extensions as the session closes. Start hooks run in manifest order; end hooks run in reverse order. A failed or timed-out start leaves only that extension inactive for that session. A failed end hook is logged by extension id and exception class, then shutdown continues for the other extensions. Session ids and hook results are not sent to the model or persisted.

Keep hooks short and session-scoped. Do not start unbounded background work, access camera/screen frames, write persistent visitor data, or create another event bus. Any durable storage, capture access or side effect needs a separate reviewed contract and must preserve D-17, D-19, D-21 and D-22.

## Not included yet

This slice does not implement remote MCP clients/servers or transport, package installation, arbitrary filesystem discovery, dynamic imports, Python sandboxing, a general skill loader, extension marketplace, user-managed installation UI, writable/action tools, asynchronous workers or extension-owned event buses. A future slice must define trust, transport authentication, schema/version negotiation, tool permission mapping, resource bounds, package provenance/update policy, secret handling and failure/cancellation behaviour before any remote extension can be enabled.
