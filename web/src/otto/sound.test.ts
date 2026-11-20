import { describe, expect, it, vi } from 'vitest'
import { CUE_NOTES, SOUND_CUES, SoundController } from './sound'

/** A stand-in for Web Audio that records what the controller builds. */
class FakeParam {
  value = 0
  calls: [string, number, number][] = []
  setValueAtTime(v: number, t: number) { this.calls.push(['set', v, t]); this.value = v }
  exponentialRampToValueAtTime(v: number, t: number) { this.calls.push(['exp', v, t]) }
  linearRampToValueAtTime(v: number, t: number) { this.calls.push(['lin', v, t]) }
  setTargetAtTime(v: number, t: number) { this.calls.push(['target', v, t]); this.value = v }
}
class FakeNode {
  connections = 0
  disconnected = false
  connect() { this.connections++ }
  disconnect() { this.disconnected = true }
}
class FakeOsc extends FakeNode {
  type = 'sine'
  frequency = new FakeParam()
  started = -1
  stopped = -1
  onended: (() => void) | null = null
  start(t: number) { this.started = t }
  stop(t: number) { this.stopped = t }
}
class FakeGain extends FakeNode { gain = new FakeParam() }
class FakeContext {
  static made = 0
  state: 'running' | 'suspended' | 'closed' = 'running'
  currentTime = 1
  destination = new FakeNode()
  oscillators: FakeOsc[] = []
  gains: FakeGain[] = []
  resumes = 0
  constructor() { FakeContext.made++ }
  createOscillator() { const o = new FakeOsc(); this.oscillators.push(o); return o }
  createGain() { const g = new FakeGain(); this.gains.push(g); return g }
  createDynamicsCompressor() { return Object.assign(new FakeNode(), { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() }) }
  resume() { this.resumes++; this.state = 'running'; return Promise.resolve() }
  close() { this.state = 'closed'; return Promise.resolve() }
}
class FakeTarget {
  listeners = new Map<string, () => void>()
  addEventListener(type: string, fn: () => void) { this.listeners.set(type, fn) }
  removeEventListener(type: string) { this.listeners.delete(type) }
  fire(type: string) { this.listeners.get(type)?.() }
}
const make = (opts: { activated?: boolean; enabled?: boolean; volume?: number } = {}) => {
  const contexts: FakeContext[] = []
  const target = new FakeTarget()
  const sound = new SoundController({
    activated: opts.activated ?? true, enabled: opts.enabled, volume: opts.volume, activationTarget: target,
    createContext: () => { const c = new FakeContext(); contexts.push(c); return c as unknown as AudioContext },
  })
  return { sound, contexts, target }
}

describe('SoundController', () => {
  it('has the six cues, each a short phrase', () => {
    expect([...SOUND_CUES]).toEqual(['chirpConnect', 'chirpAcknowledge', 'chirpThinking', 'chirpNegative', 'chirpCelebration', 'chirpGoodbye'])
    for (const cue of SOUND_CUES) {
      const end = Math.max(...CUE_NOTES[cue].map(n => n.at + n.dur))
      expect(end).toBeLessThan(0.6)
    }
  })

  it('makes no AudioContext before the first click or key press, and drops cues until then', () => {
    const { sound, contexts, target } = make({ activated: false })
    expect(sound.play('chirpConnect')).toBe(false)
    expect(contexts).toHaveLength(0)
    target.fire('pointerdown')
    expect(target.listeners.size).toBe(0) // listeners removed once activated
    expect(contexts).toHaveLength(1)      // made inside the visitor's gesture
    expect(sound.play('chirpConnect')).toBe(true)
  })

  it('reuses one context for every cue', () => {
    const { sound, contexts } = make()
    for (const cue of SOUND_CUES) sound.play(cue)
    for (const cue of SOUND_CUES) sound.play(cue)
    expect(contexts).toHaveLength(1)
  })

  it('ramps every note in and out from near silence (no clicks), and stops each oscillator', () => {
    const { sound, contexts } = make()
    sound.play('chirpCelebration')
    const ctx = contexts[0]
    const noteGains = ctx.gains.slice(1) // the first gain is the master
    expect(noteGains).toHaveLength(CUE_NOTES.chirpCelebration.length)
    for (const g of noteGains) {
      const [first, , last] = g.gain.calls
      expect(first[0]).toBe('set')
      expect(first[1]).toBeLessThan(0.001)
      expect(last[0]).toBe('exp')
      expect(last[1]).toBeLessThan(0.001)
    }
    for (const o of ctx.oscillators) expect(o.stopped).toBeGreaterThan(o.started)
  })

  it('disconnects every node once its note has ended', () => {
    const { sound, contexts } = make()
    sound.play('chirpGoodbye')
    const ctx = contexts[0]
    ctx.oscillators.forEach(o => o.onended?.())
    expect(ctx.oscillators.every(o => o.disconnected)).toBe(true)
    expect(ctx.gains.slice(1).every(g => g.disconnected)).toBe(true)
  })

  it('scales the master level by the volume, and glides to a new volume', () => {
    const { sound, contexts } = make({ volume: 0.5 })
    sound.play('chirpAcknowledge')
    const master = contexts[0].gains[0]
    expect(master.gain.value).toBeCloseTo(0.5 * 0.35)
    sound.setVolume(1)
    expect(master.gain.calls.at(-1)?.[0]).toBe('target')
    expect(master.gain.value).toBeCloseTo(0.35)
  })

  it('plays nothing (and makes no context) when sound is off or the volume is 0', () => {
    for (const opts of [{ enabled: false }, { volume: 0 }]) {
      const { sound, contexts } = make(opts)
      expect(sound.play('chirpConnect')).toBe(false)
      expect(contexts).toHaveLength(0)
    }
  })

  it('resumes a suspended context, then plays', async () => {
    const { sound, contexts } = make()
    sound.play('chirpAcknowledge')
    const ctx = contexts[0]
    ctx.state = 'suspended'
    const before = ctx.oscillators.length
    expect(sound.play('chirpConnect')).toBe(true)
    await Promise.resolve(); await Promise.resolve()
    expect(ctx.resumes).toBe(1)
    expect(ctx.oscillators.length).toBe(before + CUE_NOTES.chirpConnect.length)
  })

  it('dispose closes the context, removes listeners and refuses later cues', () => {
    const { sound, contexts, target } = make({ activated: false })
    target.fire('keydown')
    sound.play('chirpConnect')
    sound.dispose()
    expect(contexts[0].state).toBe('closed')
    expect(target.listeners.size).toBe(0)
    expect(sound.play('chirpConnect')).toBe(false)
    expect(sound.started).toBe(false)
  })

  it('an unactivated controller that is disposed never made a context and leaves no listeners', () => {
    const { sound, contexts, target } = make({ activated: false })
    sound.dispose()
    expect(contexts).toHaveLength(0)
    expect(target.listeners.size).toBe(0)
  })
})

describe('SoundController cue envelopes', () => {
  it.each([...SOUND_CUES])('%s: every note starts from ~0, ramps up, and is back at ~0 before it stops', cue => {
    const { sound, contexts } = make()
    sound.play(cue)
    const ctx = contexts[0]
    const noteGains = ctx.gains.slice(1)
    expect(noteGains).toHaveLength(CUE_NOTES[cue].length)
    noteGains.forEach((g, i) => {
      const osc = ctx.oscillators[i]
      const calls = g.gain.calls
      // Starts with an instant set to ~0 at the note's start: nothing audible before the ramp.
      expect(calls[0][0]).toBe('set')
      expect(calls[0][1]).toBeLessThan(0.001)
      expect(calls[0][2]).toBe(osc.started)
      // The first non-zero level is reached by a ramp, never by a set.
      const up = calls.find(c => c[1] > 0.001)!
      expect(up[0]).toBe('exp')
      expect(up[1]).toBeLessThanOrEqual(1)
      // Ramp times only move forward, the last one is ~0, and it lands before the oscillator stops.
      const times = calls.map(c => c[2])
      expect([...times].sort((a, b) => a - b)).toEqual(times)
      const last = calls[calls.length - 1]
      expect(last[0]).toBe('exp')
      expect(last[1]).toBeLessThan(0.001)
      expect(last[2]).toBeLessThanOrEqual(osc.stopped)
      expect(osc.started).toBeGreaterThan(ctx.currentTime) // scheduled ahead, never in the past
    })
  })

  it('the master level is never a jump to a loud level before any cue: it starts at volume x headroom', () => {
    const { sound, contexts } = make({ volume: 1 })
    sound.play('chirpAcknowledge')
    expect(contexts[0].gains[0].gain.value).toBeCloseTo(0.35)
  })
})

describe('SoundController autoplay and failure paths', () => {
  it.each(['pointerdown', 'keydown', 'touchstart'])('a %s makes the context; before it, cues are dropped', type => {
    const { sound, contexts, target } = make({ activated: false })
    expect(sound.play('chirpConnect')).toBe(false)
    expect(sound.play('chirpGoodbye')).toBe(false)
    expect(sound.started).toBe(false)
    target.fire(type)
    expect(contexts).toHaveLength(1)
    expect(sound.started).toBe(true)
  })

  it('a gesture while sound is off or muted makes no context', () => {
    for (const opts of [{ enabled: false }, { volume: 0 }]) {
      const { sound, contexts, target } = make({ activated: false, ...opts })
      target.fire('pointerdown')
      expect(contexts).toHaveLength(0)
      expect(sound.play('chirpConnect')).toBe(false)
    }
  })

  it('turning sound off after the context exists stops further cues', () => {
    const { sound, contexts } = make()
    sound.play('chirpAcknowledge')
    const n = contexts[0].oscillators.length
    sound.setEnabled(false)
    expect(sound.play('chirpAcknowledge')).toBe(false)
    expect(contexts[0].oscillators.length).toBe(n)
    sound.setVolume(0)
    sound.setEnabled(true)
    expect(sound.play('chirpAcknowledge')).toBe(false)
  })

  it('a suspended context is resumed, and a resume that rejects does not throw', async () => {
    const { sound, contexts } = make()
    sound.play('chirpAcknowledge')
    const ctx = contexts[0]
    ctx.state = 'suspended'
    ctx.resume = () => { ctx.resumes++; return Promise.reject(new Error('blocked')) }
    const before = ctx.oscillators.length
    expect(() => sound.play('chirpConnect')).not.toThrow()
    await Promise.resolve(); await Promise.resolve()
    expect(ctx.resumes).toBe(1)
    expect(ctx.oscillators.length).toBe(before) // nothing scheduled on a context that would not wake
  })

  it('a cue still waiting for a resume after the controller is disposed is not played', async () => {
    const { sound, contexts } = make()
    sound.play('chirpAcknowledge')
    const ctx = contexts[0]
    ctx.state = 'suspended'
    const before = ctx.oscillators.length
    sound.play('chirpConnect')
    sound.dispose()
    await Promise.resolve(); await Promise.resolve()
    expect(ctx.oscillators.length).toBe(before)
  })

  it('a cue that waited longer than the stale limit for a resume is dropped', async () => {
    vi.useFakeTimers()
    try {
      const { sound, contexts } = make()
      sound.play('chirpAcknowledge')
      const ctx = contexts[0]
      ctx.state = 'suspended'
      let wake!: () => void
      ctx.resume = () => new Promise<void>(r => { wake = () => { ctx.state = 'running'; r() } })
      const before = ctx.oscillators.length
      sound.play('chirpConnect')
      vi.advanceTimersByTime(500)
      wake()
      await Promise.resolve(); await Promise.resolve()
      expect(ctx.oscillators.length).toBe(before)
    } finally { vi.useRealTimers() }
  })

  it('no Web Audio (the context constructor throws): cues are dropped, nothing throws', () => {
    const sound = new SoundController({ activated: true, activationTarget: null, createContext: () => { throw new Error('no audio') } })
    expect(sound.play('chirpConnect')).toBe(false)
    expect(sound.started).toBe(false)
  })

  it('dispose closes the context once, even if closing rejects, and is safe to repeat', async () => {
    const { sound, contexts } = make()
    sound.play('chirpConnect')
    const close = vi.fn(() => Promise.reject(new Error('already closed')))
    contexts[0].close = close
    expect(() => { sound.dispose(); sound.dispose() }).not.toThrow()
    await Promise.resolve()
    expect(close).toHaveBeenCalledTimes(1)
  })
})
