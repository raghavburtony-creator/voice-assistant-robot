import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_VAD, VoiceActivityDetector, type VadHandlers } from './vad'

// A fake AudioContext whose analyser reads whatever `level` is: a constant signal of that RMS.
let level = 0
let contexts: { closed: boolean; nodes: { disconnected: boolean }[] }[] = []
class FakeNode { disconnected = false; connect() { return this } disconnect() { this.disconnected = true } }
class FakeContext {
  rec = { closed: false, nodes: [] as FakeNode[] }
  constructor() { contexts.push(this.rec) }
  createMediaStreamSource() { const n = new FakeNode(); this.rec.nodes.push(n); return n }
  createAnalyser() {
    const n = Object.assign(new FakeNode(), { fftSize: 0, getFloatTimeDomainData(b: Float32Array) { b.fill(level) } })
    this.rec.nodes.push(n)
    return n
  }
  resume() { return Promise.resolve() }
  close() { this.rec.closed = true; return Promise.resolve() }
}

const start = (settings = DEFAULT_VAD) => {
  const h = { onSpeechStart: vi.fn(), onSpeechEnd: vi.fn(), onNoSpeech: vi.fn(), onLevel: vi.fn() } satisfies VadHandlers
  return { vad: new VoiceActivityDetector({} as MediaStream, settings, h), h }
}
const run = (ms: number) => vi.advanceTimersByTime(ms)
/** The visitor presses Start, then speaks: the first calibrationMs only teach the detector the room (a constant level from
 *  the very first tick is indistinguishable from a fan, so it is learned as one). */
const settle = () => run(500)

beforeEach(() => {
  vi.useFakeTimers()
  level = 0; contexts = []
  vi.stubGlobal('AudioContext', FakeContext)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('VoiceActivityDetector', () => {
  it('ignores a click shorter than the onset, confirms sustained speech', () => {
    const { h } = start(); settle()
    level = 0.2; run(100); level = 0; run(200)
    expect(h.onSpeechStart).not.toHaveBeenCalled()
    level = 0.2; run(300)
    expect(h.onSpeechStart).toHaveBeenCalledTimes(1)
    expect(h.onLevel).toHaveBeenCalled()
  })

  it('ends the turn after trailing silence, once', () => {
    const { h } = start(); settle()
    level = 0.2; run(400); level = 0
    run(900)
    expect(h.onSpeechEnd).not.toHaveBeenCalled()
    run(200)
    expect(h.onSpeechEnd).toHaveBeenCalledExactlyOnceWith('silence')
    run(5000)
    expect(h.onSpeechEnd).toHaveBeenCalledTimes(1)
    expect(h.onNoSpeech).not.toHaveBeenCalled()
  })

  it('a pause shorter than the silence timeout does not end the turn', () => {
    const { h } = start()
    level = 0.2; run(400); level = 0; run(600); level = 0.2; run(400); level = 0; run(600)
    expect(h.onSpeechEnd).not.toHaveBeenCalled()
  })

  it('cancels when nobody speaks within the no-speech timeout', () => {
    const { h } = start()
    run(5900)
    expect(h.onNoSpeech).not.toHaveBeenCalled()
    run(200)
    expect(h.onNoSpeech).toHaveBeenCalledTimes(1)
    expect(h.onSpeechStart).not.toHaveBeenCalled()
  })

  it('cuts a turn that never goes quiet at the maximum duration', () => {
    const { h } = start(); settle()
    level = 0.2; run(29_300)
    expect(h.onSpeechEnd).not.toHaveBeenCalled()
    run(300)
    expect(h.onSpeechEnd).toHaveBeenCalledExactlyOnceWith('max')
  })

  it('while muted, nothing counts and the no-speech clock stands still', () => {
    let muted = true
    const h = { onSpeechStart: vi.fn(), onSpeechEnd: vi.fn(), onNoSpeech: vi.fn(), muted: () => muted } satisfies VadHandlers
    new VoiceActivityDetector({} as MediaStream, DEFAULT_VAD, h)
    level = 0.2; run(10_000)
    expect(h.onSpeechStart).not.toHaveBeenCalled()
    expect(h.onNoSpeech).not.toHaveBeenCalled()
    muted = false; level = 0; run(5900)
    expect(h.onNoSpeech).not.toHaveBeenCalled()
    run(200)
    expect(h.onNoSpeech).toHaveBeenCalledTimes(1)
  })

  it('a shared context is used as is and left open for its owner', () => {
    const shared = new FakeContext()
    new VoiceActivityDetector({} as MediaStream, DEFAULT_VAD, { onSpeechEnd: vi.fn(), onNoSpeech: vi.fn() }, shared as unknown as AudioContext).dispose()
    expect(contexts).toHaveLength(1)
    expect(shared.rec.closed).toBe(false)
    expect(shared.rec.nodes.every(n => n.disconnected)).toBe(true)
  })

  it('dispose() stops the tick timer, disconnects nodes and closes the context; twice is safe', () => {
    const { vad, h } = start()
    vad.dispose(); vad.dispose()
    level = 0.2; run(2000)
    expect(h.onLevel).not.toHaveBeenCalled()
    expect(contexts[0].closed).toBe(true)
    expect(contexts[0].nodes.every(n => n.disconnected)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('releases everything when it ends by itself', () => {
    start(); settle(); level = 0.2; run(400); level = 0; run(1200)
    expect(contexts[0].closed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })

  describe('against a steady background noise (a laptop fan)', () => {
    it('a fan that was on before the visitor spoke never opens a turn', () => {
      const { h } = start()
      level = 0.05; run(5800)
      expect(h.onSpeechStart).not.toHaveBeenCalled()
      run(400)
      expect(h.onNoSpeech).toHaveBeenCalledTimes(1)
    })

    it('speech over the fan is a turn, and the fan does not keep it open', () => {
      const { h } = start()
      level = 0.05; run(1000)
      level = 0.25; run(400)
      expect(h.onSpeechStart).toHaveBeenCalledTimes(1)
      level = 0.05; run(900)
      expect(h.onSpeechEnd).not.toHaveBeenCalled()
      run(300)
      expect(h.onSpeechEnd).toHaveBeenCalledExactlyOnceWith('silence')
    })

    it('a fan that starts after the turn began is absorbed and the turn still ends well before the ceiling', () => {
      const { h } = start(); settle()
      level = 0.2; run(400)
      expect(h.onSpeechStart).toHaveBeenCalledTimes(1)
      level = 0.06; run(20_000)
      expect(h.onSpeechEnd).toHaveBeenCalledExactlyOnceWith('silence')
    })

    it('quiet speech in a silent room still counts (the floor never raises the minimum)', () => {
      const { h } = start(); settle()
      level = 0.03; run(300)
      expect(h.onSpeechStart).toHaveBeenCalledTimes(1)
    })

    it('a detector started with the previous floor needs no calibration', () => {
      const h = { onSpeechStart: vi.fn(), onSpeechEnd: vi.fn(), onNoSpeech: vi.fn() } satisfies VadHandlers
      new VoiceActivityDetector({} as MediaStream, DEFAULT_VAD, h, undefined, 0.05)
      level = 0.05; run(2000)
      expect(h.onSpeechStart).not.toHaveBeenCalled()
      level = 0.25; run(300)
      expect(h.onSpeechStart).toHaveBeenCalledTimes(1)
    })

    it('reports speech start and end as diagnostics: levels and reasons only', () => {
      const events: unknown[] = []
      const h = { onSpeechEnd: vi.fn(), onNoSpeech: vi.fn(), onDiagnostic: (e: unknown) => events.push(e) } satisfies VadHandlers
      new VoiceActivityDetector({} as MediaStream, DEFAULT_VAD, h)
      run(500); level = 0.2; run(400); level = 0; run(1200)
      expect(events.map(e => (e as { type: string }).type)).toEqual(['speech_start', 'speech_end'])
      expect(JSON.stringify(events)).not.toMatch(/pcm|audio|buffer/i)
    })
  })
})
