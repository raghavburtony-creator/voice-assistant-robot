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
  close() { this.rec.closed = true; return Promise.resolve() }
}

const start = (settings = DEFAULT_VAD) => {
  const h = { onSpeechStart: vi.fn(), onSpeechEnd: vi.fn(), onNoSpeech: vi.fn(), onLevel: vi.fn() } satisfies VadHandlers
  return { vad: new VoiceActivityDetector({} as MediaStream, settings, h), h }
}
const run = (ms: number) => vi.advanceTimersByTime(ms)

beforeEach(() => {
  vi.useFakeTimers()
  level = 0; contexts = []
  vi.stubGlobal('AudioContext', FakeContext)
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('VoiceActivityDetector', () => {
  it('ignores a click shorter than the onset, confirms sustained speech', () => {
    const { h } = start()
    level = 0.2; run(100); level = 0; run(200)
    expect(h.onSpeechStart).not.toHaveBeenCalled()
    level = 0.2; run(300)
    expect(h.onSpeechStart).toHaveBeenCalledTimes(1)
    expect(h.onLevel).toHaveBeenCalled()
  })

  it('ends the turn after trailing silence, once', () => {
    const { h } = start()
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
    const { h } = start()
    level = 0.2; run(29_900)
    expect(h.onSpeechEnd).not.toHaveBeenCalled()
    run(200)
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
    start(); level = 0.2; run(400); level = 0; run(1200)
    expect(contexts[0].closed).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
