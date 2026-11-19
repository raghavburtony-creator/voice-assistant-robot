import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SpeechPlayer } from './audio'

// A small AudioContext stand-in: a clock we move by hand, nodes that record what was done to them.
class FakeNode { connected = true; connect() { return this } disconnect() { this.connected = false } }
class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null
  startAt = -1; stopped = false
  onended: (() => void) | null = null
  start(at: number) { this.startAt = at }
  stop() { this.stopped = true }
}
class FakeContext {
  static made: FakeContext[] = []
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  currentTime = 0
  sampleRate = 24000
  sources: FakeSource[] = []
  resumes = 0
  destination = new FakeNode()
  constructor() { FakeContext.made.push(this) }
  createAnalyser() { return Object.assign(new FakeNode(), { fftSize: 0, frequencyBinCount: 256, smoothingTimeConstant: 0, minDecibels: 0, maxDecibels: 0, context: this, getFloatFrequencyData() {} }) }
  createBuffer(_ch: number, length: number, rate: number) { const data = new Float32Array(length); return { duration: length / rate, getChannelData: () => data } }
  createBufferSource() { const s = new FakeSource(); this.sources.push(s); return s }
  resume() { this.resumes++; if (this.state !== 'closed') this.state = 'running'; return Promise.resolve() }
  close() { this.state = 'closed'; return Promise.resolve() }
  /** Moves the clock on and ends every source whose audio is over. */
  advance(seconds: number) {
    this.currentTime += seconds
    for (const s of this.sources) if (!s.stopped && s.startAt >= 0 && s.startAt + s.buffer!.duration <= this.currentTime) { s.stopped = true; s.onended?.() }
  }
}
const chunk = (seconds: number) => new Int16Array(Math.round(seconds * 24000)).fill(1000).buffer

let target: EventTarget
beforeEach(() => {
  FakeContext.made = []
  target = new EventTarget()
  vi.stubGlobal('AudioContext', FakeContext)
  vi.stubGlobal('window', target)
})
afterEach(() => vi.unstubAllGlobals())

describe('SpeechPlayer', () => {
  it('made outside a click (suspended), queues chunks in order instead of dropping them, and asks to resume', () => {
    const player = new SpeechPlayer()
    const context = FakeContext.made[0]
    context.state = 'suspended'
    context.resumes = 0
    player.play(chunk(0.1)); player.play(chunk(0.1))
    expect(context.sources.map(s => s.startAt)).toEqual([0.06, 0.16].map(t => expect.closeTo(t, 6)))
    expect(context.resumes).toBeGreaterThan(0)
    player.close()
  })

  it('resumes on the visitor\'s next click or key press, and stops listening once closed', () => {
    const player = new SpeechPlayer()
    const context = FakeContext.made[0]
    context.state = 'suspended'
    target.dispatchEvent(new Event('keydown'))
    expect(context.state).toBe('running')
    player.close()
    context.state = 'suspended'
    const before = context.resumes
    target.dispatchEvent(new Event('pointerdown'))
    expect(context.resumes).toBe(before)
  })

  it('reports this turn\'s progress by the audio clock', () => {
    const player = new SpeechPlayer()
    const context = FakeContext.made[0]
    context.state = 'running'
    expect(player.progress()).toBeNull()
    player.play(chunk(0.5)); player.play(chunk(0.5))
    context.advance(0.06 + 0.25)
    expect(player.progress()).toEqual({ played: expect.closeTo(0.25, 6), received: expect.closeTo(1, 6) })
    context.advance(0.5)
    expect(player.progress()!.played).toBeCloseTo(0.75, 6)
    player.endTurn()
    context.advance(1)
    player.play(chunk(0.2)) // a new turn starts from zero
    expect(player.progress()).toEqual({ played: 0, received: expect.closeTo(0.2, 6) })
    player.close()
  })

  it('interrupt() stops and disconnects everything queued, and drops the rest of the turn until it ends', () => {
    const player = new SpeechPlayer()
    const context = FakeContext.made[0]
    context.state = 'running'
    let idle = 0
    player.onIdle = () => { idle++ }
    for (let i = 0; i < 5; i++) player.play(chunk(0.1))
    context.advance(0.1)
    player.interrupt()
    expect(context.sources.every(s => s.stopped && !s.connected)).toBe(true)
    expect(player.activeSources).toBe(0)
    expect(player.playing).toBe(false)
    expect(idle).toBe(1)
    // The server is still sending the interrupted turn: none of it plays.
    player.play(chunk(0.1))
    expect(context.sources).toHaveLength(5)
    // The server ends the turn ("interrupted" or "turn_complete"): the next reply plays.
    player.endTurn()
    player.play(chunk(0.1))
    expect(context.sources).toHaveLength(6)
    player.close()
  })

  it('disconnects each source as it finishes, and close() leaves nothing connected', () => {
    const player = new SpeechPlayer()
    const context = FakeContext.made[0]
    context.state = 'running'
    player.play(chunk(0.1)); player.play(chunk(0.1)); player.play(chunk(0.1))
    context.advance(0.27) // the first starts at 0.06: two of three have ended
    expect(context.sources.filter(s => s.connected)).toHaveLength(1)
    player.close()
    expect(context.sources.some(s => s.connected)).toBe(false)
    expect(context.state).toBe('closed')
    player.play(chunk(0.1))
    expect(context.sources).toHaveLength(3)
  })
})
