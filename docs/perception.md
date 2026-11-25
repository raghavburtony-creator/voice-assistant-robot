# Otto Perception Gateway

Issue #51 introduces a provider-independent perception boundary for Otto's live sessions.

## Flow

```
camera / screen / page context
            |
            v
    PerceptionGateway
    - consent
    - validation
    - rate limits
    - normalization
    - transient in-memory latest observation
            |
            +----> ADK live multimodal input (frames)
            |
            +----> get_perception_context tool (metadata)
```

The gateway is not an agent and does not make decisions. The ADK orchestrator remains the only decision authority.

## Privacy boundary

Camera and screen frames require explicit capture consent. Revoking consent removes the corresponding in-memory observation immediately. Frames are never written to disk by this gateway.

The `get_perception_context` tool returns metadata only. Live frame bytes are delivered through the existing multimodal session and are not copied into tool responses.

## Supported sources

- `camera` — user-approved camera frames
- `screen` — user-approved screen frames
- `browser` — page context published by the host application
- `document` / `image` — reserved provider-independent observation types for later document/image adapters

Adding a provider must not add another router or agent. Providers produce observations; Otto decides what to do with them.
