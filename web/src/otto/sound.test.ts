import { describe, expect, it } from 'vitest'
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
