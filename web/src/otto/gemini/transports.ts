// The two ways the bridge reaches a live voice model, behind one small interface, and the parsers that turn what each
// one sends into BridgeEvents. Everything that comes in is checked before use; a shape that does not fit is dropped.
//
//   proxy (recommended): a backend WebSocket speaking this repo's protocol (server/app/voice/route.py). The key stays
//                        on the server (D-01).
//   live:                a Gemini Live ephemeral token minted by the host's backend; the browser talks to Gemini Live's
//                        BidiGenerateContent WebSocket directly. Never a raw API key.

/** What a transport reports. `userSpeech`: the visitor is talking; `thinking`: the model is working (a tool call). */
export type BridgeEvent =
  | { type: 'ready' }
  | { type: 'audio'; pcm: ArrayBuffer }
  | { type: 'text'; text: string }
  | { type: 'userSpeech' }
  | { type: 'thinking' }
  | { type: 'interrupted' }
  | { type: 'turnComplete' }
  | { type: 'error'; message: string }
  | { type: 'closed'; reason: string }

export type Transport = {
  sendAudio(pcm: ArrayBuffer): void
  sendText(text: string): void
  /** The visitor stopped talking: tell the model the audio stream is over so it answers. */
  endTurn(): void
  close(): void
}

export type ProxyTransportOptions = { type: 'proxy'; url: string }
export type LiveTransportOptions = { type: 'live'; token: string; model?: string }
export type TransportOptions = ProxyTransportOptions | LiveTransportOptions

/** Session details sent when the connection opens (proxy only: a live token carries its own config). */
export type StartDetails = { language?: string; page?: string }

// [verify] The Live API WebSocket endpoint for ephemeral tokens (v1alpha, "Constrained"), token in `access_token`.
export const GEMINI_LIVE_ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained'
// [verify] A native-audio Live model id; pass `model` to override.
export const GEMINI_LIVE_DEFAULT_MODEL = 'gemini-2.5-flash-native-audio-preview-09-2025'

const RAW_KEY = /AIza[0-9A-Za-z_-]{20,}/
const KEY_ERROR = 'Otto\'s Gemini bridge refuses a raw Gemini API key in the browser (D-01). Mint a short-lived ephemeral '
  + 'token on your server and pass { type: "live", token }, or use { type: "proxy", url } to a backend that holds the key.'

/** Throws when the options carry what looks like a raw API key. */
export function assertNoApiKey(options: unknown): void {
  if (!options || typeof options !== 'object') return
  const o = options as Record<string, unknown>
  if ('apiKey' in o || 'key' in o) throw new Error(KEY_ERROR)
  for (const value of Object.values(o)) if (typeof value === 'string' && RAW_KEY.test(value)) throw new Error(KEY_ERROR)
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** This repo's protocol (server/app/voice/route.py). Binary frames are 24 kHz PCM16. */
export function parseProxyMessage(data: unknown): BridgeEvent[] {
  if (data instanceof ArrayBuffer) return data.byteLength ? [{ type: 'audio', pcm: data }] : []
  if (typeof data !== 'string') return []
  let m: unknown
  try { m = JSON.parse(data) } catch { return [] }
  if (!isObject(m)) return []
  switch (m.type) {
    case 'ready': return [{ type: 'ready' }]
    case 'transcript':
      if (typeof m.text !== 'string') return []
      if (m.role === 'assistant') return m.text ? [{ type: 'text', text: m.text }] : []
      return m.role === 'user' ? [{ type: 'userSpeech' }] : []
    case 'interrupted': return [{ type: 'interrupted' }]
    case 'turn_complete': return [{ type: 'turnComplete' }]
    case 'error': return typeof m.message === 'string' ? [{ type: 'error', message: m.message }] : []
    case 'ended': return typeof m.reason === 'string' ? [{ type: 'closed', reason: m.reason }] : []
    // 'action' (navigate/command) belongs to the host app's own allow-list (messages.ts), not to the mascot.
    default: return []
  }
}

function base64ToBuffer(b64: string): ArrayBuffer | null {
  try {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out.buffer
  } catch { return null }
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/**
 * One Gemini Live server message (a parsed JSON object, or the payload @google/genai's `onmessage` hands you).
 * [verify] Field names: setupComplete, serverContent.{modelTurn.parts[].inlineData{mimeType,data}, outputTranscription.text,
 * inputTranscription.text, interrupted, turnComplete}, toolCall, goAway.
 */
export function parseLiveMessage(m: unknown): BridgeEvent[] {
  if (!isObject(m)) return []
  const events: BridgeEvent[] = []
  if ('setupComplete' in m) events.push({ type: 'ready' })
  if (isObject(m.toolCall)) events.push({ type: 'thinking' })
  const sc = m.serverContent
  if (isObject(sc)) {
    if (sc.interrupted === true) events.push({ type: 'interrupted' })
    if (isObject(sc.inputTranscription) && typeof sc.inputTranscription.text === 'string' && sc.inputTranscription.text)
      events.push({ type: 'userSpeech' })
    const parts = isObject(sc.modelTurn) && Array.isArray(sc.modelTurn.parts) ? sc.modelTurn.parts : []
    for (const part of parts) {
      const d = isObject(part) && isObject(part.inlineData) ? part.inlineData : null
      // [verify] Output audio is "audio/pcm;rate=24000"; any other rate or type is dropped, not resampled.
      if (!d || typeof d.data !== 'string' || typeof d.mimeType !== 'string' || !/^audio\/pcm(;\s*rate=24000)?$/.test(d.mimeType)) continue
      const pcm = base64ToBuffer(d.data)
      if (pcm && pcm.byteLength) events.push({ type: 'audio', pcm })
    }
    if (isObject(sc.outputTranscription) && typeof sc.outputTranscription.text === 'string' && sc.outputTranscription.text)
      events.push({ type: 'text', text: sc.outputTranscription.text })
    if (sc.turnComplete === true) events.push({ type: 'turnComplete' })
  }
  if (isObject(m.goAway)) events.push({ type: 'closed', reason: 'goAway' })
  return events
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Mic audio must not go out in cleartext: wss: only, except ws: to this machine. */
export function assertSecureProxyUrl(raw: string): void {
  let url: URL
  try { url = new URL(raw) } catch { throw new Error(`The proxy url must be an absolute wss:// url (got "${raw}").`) }
  if (url.protocol === 'wss:' || (url.protocol === 'ws:' && LOCAL_HOSTS.has(url.hostname))) return
  throw new Error(`The proxy url must use wss:// (ws:// is allowed only for localhost); got "${url.protocol}//${url.host}".`)
}

type Socket = Pick<WebSocket, 'send' | 'close' | 'readyState'> & {
  binaryType: BinaryType
  onopen: ((e: Event) => void) | null
  onmessage: ((e: MessageEvent) => void) | null
  onerror: ((e: Event) => void) | null
  onclose: ((e: CloseEvent) => void) | null
}

/** Opens the transport. `onEvent` gets every checked event, `ready` included; failures arrive as `error` and `closed`. */
export function openTransport(options: TransportOptions, start: StartDetails, onEvent: (e: BridgeEvent) => void): Transport {
  assertNoApiKey(options)
  const live = options.type === 'live'
  if (live && !options.token) throw new Error('Gemini Live needs an ephemeral token from your server.')
  if (!live && !options.url) throw new Error('The proxy transport needs a WebSocket url.')
  if (!live) assertSecureProxyUrl(options.url)
  const url = live ? `${GEMINI_LIVE_ENDPOINT}?access_token=${encodeURIComponent(options.token)}` : options.url
  const ws = new WebSocket(url) as unknown as Socket
  ws.binaryType = 'arraybuffer'
  let closed = false
  const send = (data: string | ArrayBuffer) => { if (!closed && ws.readyState === 1) ws.send(data) }

  ws.onopen = () => {
    if (live) {
      // [verify] The setup message; with an ephemeral token whose config is locked, only `model` may be honoured.
      send(JSON.stringify({ setup: {
        model: `models/${options.model ?? GEMINI_LIVE_DEFAULT_MODEL}`,
        generationConfig: { responseModalities: ['AUDIO'] },
        outputAudioTranscription: {},
        inputAudioTranscription: {},
      } }))
    } else send(JSON.stringify({ type: 'start', language: start.language ?? 'en', ...(start.page ? { page: start.page } : {}) }))
  }
  ws.onmessage = event => {
    let events: BridgeEvent[]
    if (live) {
      // [verify] Live may send JSON in binary frames; both are decoded as JSON text.
      const text = typeof event.data === 'string' ? event.data
        : event.data instanceof ArrayBuffer ? new TextDecoder().decode(event.data) : null
      let value: unknown = null
      if (text !== null) try { value = JSON.parse(text) } catch { value = null }
      events = parseLiveMessage(value)
    } else events = parseProxyMessage(event.data)
    for (const e of events) onEvent(e)
  }
  ws.onerror = () => onEvent({ type: 'error', message: 'The voice connection failed.' })
  ws.onclose = () => { if (!closed) { closed = true; onEvent({ type: 'closed', reason: 'socket' }) } }

  return {
    sendAudio(pcm) {
      // [verify] realtimeInput.audio with "audio/pcm;rate=16000" (older docs: realtimeInput.mediaChunks).
      if (live) send(JSON.stringify({ realtimeInput: { audio: { data: bufferToBase64(pcm), mimeType: 'audio/pcm;rate=16000' } } }))
      else send(pcm)
    },
    sendText(text) {
      // [verify] clientContent with one user turn and turnComplete.
      if (live) send(JSON.stringify({ clientContent: { turns: [{ role: 'user', parts: [{ text }] }], turnComplete: true } }))
      else send(JSON.stringify({ type: 'text', text }))
    },
    endTurn() {
      // [verify] realtimeInput.audioStreamEnd; the proxy's mic_off makes the server send it (bridge.py audio_end).
      if (live) send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
      else send(JSON.stringify({ type: 'mic_off' }))
    },
    close() {
      if (closed) return
      if (!live) send(JSON.stringify({ type: 'stop' }))
      closed = true
      ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null
      ws.close()
    },
  }
}
