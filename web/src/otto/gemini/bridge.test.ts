import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGeminiVoiceBridge, mapEvent, type VoiceBridgeTarget } from './bridge'
import { parseLiveMessage, parseProxyMessage, GEMINI_LIVE_ENDPOINT, type BridgeEvent } from './transports'

// --- fakes -------------------------------------------------------------------------------------------------------------
const recorders: { onFrame: (pcm: ArrayBuffer) => void; stopped: boolean }[] = []
vi.mock('../audio', async original => ({
  ...(await original<typeof import('../audio')>()),
  startRecorder: vi.fn(async (onFrame: (pcm: ArrayBuffer) => void) => {
    const r = { onFrame, stopped: false }
    recorders.push(r)
    return { stop: () => { r.stopped = true }, setMuted: () => {} }
  }),
}))

class FakeNode { connected = true; connect() { return this } disconnect() { this.connected = false } }
class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null
  stopped = false
  onended: (() => void) | null = null
  start() {}
  stop() { this.stopped = true }
}
class FakeContext {
  static made: FakeContext[] = []
  state = 'running'; currentTime = 0; destination = new FakeNode(); sources: FakeSource[] = []
  constructor() { FakeContext.made.push(this) }
  createAnalyser() { return Object.assign(new FakeNode(), { fftSize: 32, frequencyBinCount: 16, getFloatFrequencyData() {} }) }
  createBuffer(_c: number, length: number, rate: number) { const d = new Float32Array(length); return { duration: length / rate, getChannelData: () => d } }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s }
  resume() { return Promise.resolve() }
  close() { this.state = 'closed'; return Promise.resolve() }
}
class FakeSocket {
  static made: FakeSocket[] = []
  readyState = 0; binaryType = 'blob'; sent: unknown[] = []; closed = false
  onopen: (() => void) | null = null
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  url: string
  constructor(url: string) { this.url = url; FakeSocket.made.push(this) }
  send(d: unknown) { this.sent.push(d) }
  close() { this.closed = true; this.readyState = 3 }
  open() { this.readyState = 1; this.onopen?.() }
  receive(data: unknown) { this.onmessage?.({ data }) }
}
const pcm = (n = 2400) => new Int16Array(n).fill(1000).buffer
const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)))

function fakeOtto() {
  const calls: unknown[][] = []
  const disconnect = vi.fn()
  const rec = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]) }
  const otto: VoiceBridgeTarget = {
    connectAudioNode: node => { calls.push(['connectAudioNode', node]); return disconnect },
    speakText: (...a) => { calls.push(['speakText', ...a]); return Promise.resolve(true) },
    interrupt: rec('interrupt'), playGesture: rec('playGesture'), setFace: rec('setFace'), setState: rec('setState'),
    playSound: (...a) => { calls.push(['playSound', ...a]); return true },
  }
  return { otto, calls, disconnect, names: () => calls.map(c => c[0]) }
}

beforeEach(() => {
  FakeContext.made = []; FakeSocket.made = []; recorders.length = 0
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('window', new EventTarget())
})
afterEach(() => vi.unstubAllGlobals())

// --- mapping -----------------------------------------------------------------------------------------------------------
describe('mapEvent', () => {
  const m = (e: BridgeEvent, audible = false) => mapEvent(e, audible)
  it('maps every lifecycle event', () => {
    expect(m({ type: 'ready' })).toEqual([{ do: 'gesture', name: 'welcomeWave' }, { do: 'face', face: 'happy' }, { do: 'state', state: 'listening' }])
    expect(m({ type: 'interrupted' })).toEqual([{ do: 'interrupt' }, { do: 'stopAudio' }, { do: 'state', state: 'listening' }])
    expect(m({ type: 'userSpeech' }, true)).toEqual([]) // late transcript while he talks: not a barge-in
    expect(m({ type: 'userSpeech' }, false)).toEqual([{ do: 'state', state: 'listening' }])
    expect(m({ type: 'thinking' })).toEqual([{ do: 'state', state: 'thinking' }, { do: 'gesture', name: 'thinkingHand' }])
    expect(m({ type: 'audio', pcm: pcm() })).toEqual([{ do: 'state', state: 'talking' }])
    expect(m({ type: 'turnComplete' })).toEqual([{ do: 'state', state: 'listening' }])
    expect(m({ type: 'error', message: 'x' })).toEqual([{ do: 'face', face: 'alert' }, { do: 'sound', cue: 'chirpNegative' }])
    expect(m({ type: 'closed', reason: 'x' })).toEqual([{ do: 'gesture', name: 'goodbyeWave' }, { do: 'face', face: 'resting' }, { do: 'state', state: 'idle' }])
    expect(m({ type: 'text', text: 'hi' })).toEqual([])
  })
})

// --- parsers -----------------------------------------------------------------------------------------------------------
describe('parseProxyMessage', () => {
  it('parses this repo\'s messages and binary audio, drops what does not fit', () => {
    const audio = pcm()
    expect(parseProxyMessage(audio)).toEqual([{ type: 'audio', pcm: audio }])
    expect(parseProxyMessage('{"type":"ready","limitSeconds":600}')).toEqual([{ type: 'ready' }])
    expect(parseProxyMessage('{"type":"transcript","role":"assistant","text":"Hi"}')).toEqual([{ type: 'text', text: 'Hi' }])
    expect(parseProxyMessage('{"type":"transcript","role":"user","text":"yo"}')).toEqual([{ type: 'userSpeech' }])
    expect(parseProxyMessage('{"type":"interrupted"}')).toEqual([{ type: 'interrupted' }])
    expect(parseProxyMessage('{"type":"turn_complete"}')).toEqual([{ type: 'turnComplete' }])
    expect(parseProxyMessage('{"type":"error","code":"busy","message":"Busy"}')).toEqual([{ type: 'error', message: 'Busy' }])
    expect(parseProxyMessage('{"type":"ended","reason":"limit"}')).toEqual([{ type: 'closed', reason: 'limit' }])
    for (const bad of ['{nope', '[]', 'null', '{"type":"transcript","role":"robot","text":"x"}', '{"type":"transcript","role":"user","text":5}',
      '{"type":"error"}', '{"type":"mystery"}', '{"type":"action","action":"navigate","page":"x"}', new ArrayBuffer(0), 42])
      expect(parseProxyMessage(bad)).toEqual([])
  })
})

describe('parseLiveMessage ([verify] shapes)', () => {
  it('maps setupComplete, audio parts, transcriptions, interrupted, turnComplete, toolCall', () => {
    const audio = pcm(10)
    expect(parseLiveMessage({ setupComplete: {} })).toEqual([{ type: 'ready' }])
    const events = parseLiveMessage({ serverContent: {
      modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: b64(audio) } }, { inlineData: { mimeType: 'audio/pcm;rate=16000', data: 'AAAA' } }, { text: 'x' }] },
      outputTranscription: { text: 'Hello' },
    } })
    expect(events.map(e => e.type)).toEqual(['audio', 'text'])
    expect(new Uint8Array((events[0] as { pcm: ArrayBuffer }).pcm)).toEqual(new Uint8Array(audio))
    expect(parseLiveMessage({ serverContent: { inputTranscription: { text: 'hey' } } })).toEqual([{ type: 'userSpeech' }])
    expect(parseLiveMessage({ serverContent: { interrupted: true } })).toEqual([{ type: 'interrupted' }])
    expect(parseLiveMessage({ serverContent: { turnComplete: true } })).toEqual([{ type: 'turnComplete' }])
    expect(parseLiveMessage({ toolCall: { functionCalls: [] } })).toEqual([{ type: 'thinking' }])
    for (const bad of [null, 'x', [], { serverContent: 'x' }, { serverContent: { modelTurn: { parts: 'x' } } }, { serverContent: { interrupted: 'yes' } }])
      expect(parseLiveMessage(bad)).toEqual([])
  })
})

// --- the bridge --------------------------------------------------------------------------------------------------------
describe('createGeminiVoiceBridge', () => {
  it('refuses a raw API key', () => {
    const { otto } = fakeOtto()
    expect(() => createGeminiVoiceBridge(otto, { transport: { type: 'live', token: 'AIzaSyA1234567890abcdefghijklmnop' } })).toThrow(/ephemeral token/)
    expect(() => createGeminiVoiceBridge(otto, { transport: { type: 'live', token: 't', apiKey: 'k' } as never })).toThrow(/ephemeral token/)
    expect(() => createGeminiVoiceBridge(otto, { apiKey: 'k' } as never)).toThrow(/ephemeral token/)
    expect(() => createGeminiVoiceBridge(otto, { transport: { type: 'proxy', url: 'wss://x/?key=AIzaSyA1234567890abcdefghijklmnop' } })).toThrow(/ephemeral token/)
    expect(FakeSocket.made).toHaveLength(0)
  })

  it('proxy: starts the session, plays audio through one tap, streams text, and maps the lifecycle', async () => {
    const { otto, calls, names } = fakeOtto()
    const states: string[] = []
    const bridge = createGeminiVoiceBridge(otto, { transport: { type: 'proxy', url: 'ws://localhost/ws' }, language: 'de', onState: s => states.push(s) })
    const done = bridge.connect()
    const ws = FakeSocket.made[0]
    expect(ws.binaryType).toBe('arraybuffer')
    ws.open()
    expect(JSON.parse(ws.sent[0] as string)).toEqual({ type: 'start', language: 'de' })
    ws.receive('{"type":"ready"}')
    await done
    expect(bridge.state).toBe('open')
    expect(calls).toContainEqual(['playGesture', 'welcomeWave'])
    ws.receive(pcm())
    ws.receive('{"type":"transcript","role":"assistant","text":"Hello "}')
    ws.receive('{"type":"transcript","role":"assistant","text":"there"}')
    ws.receive('garbage')
    expect(names().filter(n => n === 'connectAudioNode')).toHaveLength(1)
    expect(FakeContext.made).toHaveLength(1)
    expect(FakeContext.made[0].sources).toHaveLength(1)
    expect(calls).toContainEqual(['setState', 'talking'])
    // The bubble gets the spoken channel, a piece at a time (channels.ts).
    expect(calls.filter(c => c[0] === 'speakText').map(c => c[1])).toEqual(['Hello', 'Hello there'])
    ws.receive('{"type":"turn_complete"}')
    expect(calls.at(-1)).toEqual(['setState', 'listening'])
    bridge.sendText('  where is it? ')
    expect(JSON.parse(ws.sent.at(-1) as string)).toEqual({ type: 'text', text: 'where is it?' })
    expect(calls.slice(-2)).toEqual([['setState', 'thinking'], ['playGesture', 'thinkingHand']])
    ws.receive('{"type":"error","code":"upstream","message":"Oops"}')
    expect(calls.slice(-2)).toEqual([['setFace', 'alert'], ['playSound', 'chirpNegative']])
    ws.receive('{"type":"ended","reason":"limit"}')
    expect(calls.slice(-3)).toEqual([['playGesture', 'goodbyeWave'], ['setFace', 'resting'], ['setState', 'idle']])
    expect(states).toEqual(['connecting', 'open', 'closed'])
  })

  it('barge-in stops queued audio and interrupts Otto', async () => {
    const { otto, calls } = fakeOtto()
    const bridge = createGeminiVoiceBridge(otto, { transport: { type: 'proxy', url: 'ws://localhost/ws' } })
    void bridge.connect()
    const ws = FakeSocket.made[0]
    ws.open(); ws.receive('{"type":"ready"}')
    ws.receive(pcm()); ws.receive(pcm())
    const sources = FakeContext.made[0].sources
    expect(sources).toHaveLength(2)
    ws.receive('{"type":"interrupted"}')
    expect(sources.every(s => s.stopped && !s.connected)).toBe(true)
    expect(calls).toContainEqual(['interrupt'])
    expect(calls.at(-1)).toEqual(['setState', 'listening'])
    // The next turn plays again.
    ws.receive(pcm())
    expect(FakeContext.made[0].sources.at(-1)!.stopped).toBe(false)
    bridge.close()
  })

  it('a late user transcript while Otto is audible does not cut him off', async () => {
    const { otto, calls } = fakeOtto()
    const bridge = createGeminiVoiceBridge(otto, { transport: { type: 'proxy', url: 'ws://localhost/ws' } })
    void bridge.connect()
    const ws = FakeSocket.made[0]
    ws.open(); ws.receive('{"type":"ready"}')
    ws.receive(pcm())
    const playing = FakeContext.made[0].sources[0]
    const before = calls.length
    ws.receive('{"type":"transcript","role":"user","text":"what I said earlier"}')
    expect(playing.stopped).toBe(false)
    expect(calls.slice(before)).toEqual([])
    // Once he is quiet, user speech means listening.
    playing.stopped = true; playing.onended?.()
    ws.receive('{"type":"transcript","role":"user","text":"next question"}')
    expect(calls.at(-1)).toEqual(['setState', 'listening'])
    expect(calls.filter(c => c[0] === 'interrupt')).toHaveLength(0)
    bridge.close()
  })

  it('the proxy url must be wss:, or ws: to localhost', () => {
    const { otto } = fakeOtto()
    for (const url of ['ws://example.com/ws', 'http://localhost/ws', '/ws/voice', 'not a url'])
      expect(() => createGeminiVoiceBridge(otto, { transport: { type: 'proxy', url } }).connect()).toThrow(/wss:/)
    for (const url of ['wss://example.com/ws', 'ws://localhost:8000/ws', 'ws://127.0.0.1/ws', 'ws://[::1]:8000/ws'])
      expect(() => { void createGeminiVoiceBridge(otto, { transport: { type: 'proxy', url } }).connect() }).not.toThrow()
    expect(FakeSocket.made).toHaveLength(4)
  })

  it('close() releases socket, audio, recorder and the tap, once', async () => {
    const { otto, calls, disconnect } = fakeOtto()
    const bridge = createGeminiVoiceBridge(otto, { transport: { type: 'proxy', url: 'ws://localhost/ws' }, microphone: true })
    const done = bridge.connect().catch(e => e)
    const ws = FakeSocket.made[0]
    ws.open(); ws.receive('{"type":"ready"}')
    await done
    await vi.waitFor(() => expect(recorders).toHaveLength(1))
    recorders[0].onFrame(pcm(800))
    expect(ws.sent.at(-1)).toBeInstanceOf(ArrayBuffer)
    ws.receive(pcm())
    const before = ws.sent.length
    recorders[0].onFrame(pcm(800)) // D-05: held back while Otto is audible
    expect(ws.sent).toHaveLength(before)
    bridge.close()
    bridge.close()
    expect(JSON.parse(ws.sent.at(-1) as string)).toEqual({ type: 'stop' })
    expect(ws.closed).toBe(true)
    expect(ws.onmessage).toBeNull()
    expect(FakeContext.made[0].state).toBe('closed')
    expect(recorders[0].stopped).toBe(true)
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(calls.filter(c => c[0] === 'playGesture' && c[1] === 'goodbyeWave')).toHaveLength(1)
    expect(bridge.state).toBe('closed')
  })

  it('a recorder that resolves after close() is stopped at once', async () => {
    const { otto } = fakeOtto()
    const bridge = createGeminiVoiceBridge(otto, { transport: { type: 'proxy', url: 'ws://localhost/ws' } })
    void bridge.connect().catch(() => {})
    const mic = bridge.startMic()
    bridge.close()
    await mic
    expect(recorders[0].stopped).toBe(true)
  })

  it('live: connects with the token, sends setup, maps a sample session, encodes mic audio', async () => {
    const { otto, calls } = fakeOtto()
    const bridge = createGeminiVoiceBridge(otto, { transport: { type: 'live', token: 'auth_tokens/abc' } })
    const done = bridge.connect()
    const ws = FakeSocket.made[0]
    expect(ws.url).toBe(`${GEMINI_LIVE_ENDPOINT}?access_token=auth_tokens%2Fabc`)
    ws.open()
    expect(JSON.parse(ws.sent[0] as string).setup.model).toMatch(/^models\//)
    ws.receive(new TextEncoder().encode('{"setupComplete":{}}').buffer)
    await done
    ws.receive(JSON.stringify({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: b64(pcm()) } }] }, outputTranscription: { text: 'Hi' } } }))
    expect(FakeContext.made[0].sources).toHaveLength(1)
    expect(calls).toContainEqual(['speakText', 'Hi', expect.anything()])
    ws.receive(JSON.stringify({ serverContent: { interrupted: true } }))
    expect(calls).toContainEqual(['interrupt'])
    ws.receive(JSON.stringify({ serverContent: { turnComplete: true } }))
    expect(calls.at(-1)).toEqual(['setState', 'listening'])
    bridge.sendText('hello')
    expect(JSON.parse(ws.sent.at(-1) as string)).toEqual({ clientContent: { turns: [{ role: 'user', parts: [{ text: 'hello' }] }], turnComplete: true } })
    await bridge.startMic()
    recorders[0].onFrame(new Int16Array([1, 2]).buffer)
    expect(JSON.parse(ws.sent.at(-1) as string).realtimeInput.audio).toEqual({ data: b64(new Int16Array([1, 2]).buffer), mimeType: 'audio/pcm;rate=16000' })
    bridge.close()
  })

  it('two channels: the bubble never shows code or URLs; they come to onVisual', async () => {
    const { otto, calls } = fakeOtto()
    const visual: unknown[] = []
    const bridge = createGeminiVoiceBridge(otto, { onVisual: parts => visual.push(...parts) })
    await bridge.connect()
    const say = (text: string) => bridge.feed({ serverContent: { outputTranscription: { text } } })
    say('Run this: ```sh\nnpm ci\n``` and see https://example.com/docs ')
    say('for more.')
    bridge.feed({ serverContent: { turnComplete: true } })
    const bubble = calls.filter(c => c[0] === 'speakText').map(c => c[1] as string)
    expect(bubble.at(-1)).toBe('Run this: and see for more.')
    for (const line of bubble) expect(line).not.toMatch(/npm ci|https?:|```/)
    expect(visual).toEqual([{ kind: 'code', lang: 'sh', text: 'npm ci' }, { kind: 'link', url: 'https://example.com/docs' }])
    bridge.close()
  })

  it('live: a systemInstruction goes in the setup message', () => {
    const { otto } = fakeOtto()
    const bridge = createGeminiVoiceBridge(otto, { transport: { type: 'live', token: 'auth_tokens/abc', systemInstruction: 'Be Otto.' } })
    void bridge.connect().catch(() => {})
    FakeSocket.made[0].open()
    expect(JSON.parse(FakeSocket.made[0].sent[0] as string).setup.systemInstruction).toEqual({ parts: [{ text: 'Be Otto.' }] })
    bridge.close()
  })

  it('a connection that closes before ready rejects connect()', async () => {
    const { otto } = fakeOtto()
    const bridge = createGeminiVoiceBridge(otto, { transport: { type: 'proxy', url: 'ws://localhost/ws' } })
    const done = bridge.connect()
    FakeSocket.made[0].onclose?.()
    await expect(done).rejects.toThrow(/closed/)
    expect(bridge.state).toBe('closed')
  })

  it('transport-less: feed() drives Otto from @google/genai messages', async () => {
    const { otto, calls, disconnect } = fakeOtto()
    const bridge = createGeminiVoiceBridge(otto)
    await bridge.connect()
    bridge.feed({ serverContent: { modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: b64(pcm()) } }] } } })
    expect(calls).toContainEqual(['setState', 'talking'])
    await expect(bridge.startMic()).rejects.toThrow(/transport/)
    bridge.close()
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(FakeSocket.made).toHaveLength(0)
  })
})
