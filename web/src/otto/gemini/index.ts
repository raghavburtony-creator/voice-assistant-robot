// otto-mascot/gemini: an optional adapter that wires a live voice session into Otto. Import it only if you use it; the
// mascot itself does not load it. No Gemini API key ever goes to the browser (D-01).
//
// Through your own backend (recommended), speaking this repo's protocol (server/app/voice/route.py):
//
//   import { createGeminiVoiceBridge } from 'otto-mascot/gemini'
//   const bridge = createGeminiVoiceBridge(document.querySelector('otto-mascot')!, {
//     transport: { type: 'proxy', url: 'wss://example.com/ws/voice' }, microphone: true,
//   })
//   talkButton.onclick = () => bridge.connect()   // from a click: audio and the mic need a gesture
//   hangUp.onclick = () => bridge.close()
//
// Straight to Gemini Live, with an ephemeral token your server mints per session:
//
//   const { token } = await fetch('/api/gemini-token').then(r => r.json())
//   const bridge = createGeminiVoiceBridge(otto, { transport: { type: 'live', token }, microphone: true })
//   await bridge.connect()
//
// Minting the token server-side ([verify] against your pinned google-genai):
//   client.auth_tokens.create(config={"uses": 1, "http_options": {"api_version": "v1alpha"}})  ->  token.name
//
// Two channels: the bubble gets only what reads well aloud; code blocks and links come to `onVisual` for your panel.
// Your own session's system prompt: buildOttoSystemPrompt({ appName, description, page: collectPageContext() }).
//
// Already using @google/genai's ai.live.connect? Leave out `transport` and pass each message on:
//   const bridge = createGeminiVoiceBridge(otto); await bridge.connect()
//   ai.live.connect({ ..., callbacks: { onmessage: m => bridge.feed(m), onclose: () => bridge.close() } })

export { createGeminiVoiceBridge, mapEvent } from './bridge'
export type { BridgeState, GeminiVoiceBridge, GeminiVoiceBridgeOptions, OttoAction, VoiceBridgeTarget } from './bridge'
export { createChannelSplitter, splitChannels, toSpoken } from './channels'
export type { ChannelChunk, ChannelSplitter, VisualPart } from './channels'
export { buildOttoSystemPrompt } from './prompt'
export type { OttoPromptContext } from './prompt'
export { GEMINI_LIVE_DEFAULT_MODEL, GEMINI_LIVE_ENDPOINT, parseLiveMessage, parseProxyMessage } from './transports'
export type { BridgeEvent, LiveTransportOptions, ProxyTransportOptions, TransportOptions } from './transports'
