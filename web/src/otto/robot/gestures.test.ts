import { describe, expect, it } from 'vitest'
import {
  createGestureChannel, createGestureController, GESTURE_NAMES, GESTURES, isGestureName,
  type GestureCommand, type GestureEvent, type GestureFrame, type GestureName,
} from './gestures'

const STEP = 1 / 60
const values = (f: GestureFrame) => [...Object.values(f.head), ...Object.values(f.handL), ...Object.values(f.handR), ...Object.values(f.face)]
/** Runs the controller for `seconds` at 60 fps and calls `each` with every frame. */
function run(c: ReturnType<typeof createGestureController>, seconds: number, each?: (f: GestureFrame) => void) {
  let f = c.update(0)
  for (let t = 0; t < seconds; t += STEP) { f = c.update(STEP); each?.(f) }
  return f
}

describe('gesture definitions', () => {
  it('has the six lifecycle gestures and the two idle ones', () => {
    expect([...GESTURE_NAMES].sort()).toEqual(['celebrate', 'goodbyeWave', 'headShake', 'lookAround', 'nod', 'stretch', 'thinkingHand', 'welcomeWave'])
    expect(isGestureName('nod')).toBe(true)
    expect(isGestureName('dance')).toBe(false)
  })

  it.each(GESTURE_NAMES.filter(n => n !== 'thinkingHand'))('%s plays, stays finite and smooth, and returns exactly to rest', name => {
    const c = createGestureController()
    expect(c.play(name, { force: true })).toBe(true)
    let prev = values(c.update(0)), maxJump = 0
    run(c, GESTURES[name].duration + 0.3, f => {
      const v = values(f)
      expect(v.every(Number.isFinite)).toBe(true)
      maxJump = Math.max(maxJump, ...v.map((x, i) => Math.abs(x - prev[i])))
      prev = v
    })
    // The fastest gestures move their arms about 2 rad in ~0.3 s: never more than 0.3 rad between two frames.
    expect(maxJump).toBeLessThan(0.3)
    const rest = c.update(STEP)
    expect(Math.max(...values(rest).map(Math.abs))).toBeLessThan(1e-9)
    expect([rest.look, rest.baseL, rest.baseR]).toEqual([1, 1, 1])
    expect(c.busy()).toBe(false)
  })

  it('holds thinkingHand until released, then fades back to rest', () => {
    const c = createGestureController()
    c.hold('thinkingHand')
    const held = run(c, 2)
    expect(held.handR.swing).toBeGreaterThan(2)
    expect(held.active).toEqual(['thinkingHand'])
    c.hold(null)
    const rest = run(c, 1)
    expect(Math.max(...values(rest).map(Math.abs))).toBeLessThan(1e-9)
    expect(c.busy()).toBe(false)
  })
})

describe('blending and arbitration', () => {
  it('idle gestures never cut into another gesture, and anything cuts into them', () => {
    const c = createGestureController()
    expect(c.play('nod')).toBe(true)
    expect(c.play('lookAround')).toBe(false)
    run(c, 1)
    expect(c.play('lookAround')).toBe(true)
    expect(c.play('nod')).toBe(true)
  })

  it('crossfades a wave into a goodbye without the arm overshooting either', () => {
    const c = createGestureController()
    c.play('welcomeWave', { force: true }); run(c, 1)
    c.play('goodbyeWave', { force: true })
    let maxRaise = 0
    run(c, 1, f => { maxRaise = Math.max(maxRaise, f.handR.raise) })
    expect(maxRaise).toBeLessThanOrEqual(1.72 + 0.38 + 0.01) // goodbye's own peak, not the sum of the two
  })

  it('a one-shot only takes over the channels it moves (nod keeps the thinking tilt)', () => {
    const c = createGestureController()
    c.hold('thinkingHand'); run(c, 1.5)
    c.play('nod', { force: true })
    run(c, 0.7, f => { expect(f.head.rz).toBeCloseTo(0.16, 3); expect(f.handR.swing).toBeGreaterThan(2) })
  })

  it('lower priority cannot interrupt, equal or higher can, force always can', () => {
    const c = createGestureController()
    c.play('celebrate', { force: true }); run(c, 0.3)
    expect(c.play('nod')).toBe(false)
    expect(c.play('nod', { force: true })).toBe(true)
    const d = createGestureController()
    d.play('nod', { force: true }); run(d, 0.2)
    expect(d.play('headShake')).toBe(true)
  })

  it('does not restart the same gesture within the cooldown', () => {
    const c = createGestureController({ cooldown: 0.4 })
    expect(c.play('nod')).toBe(true); run(c, 0.1)
    expect(c.play('nod')).toBe(false)
    run(c, 0.4)
    expect(c.play('nod')).toBe(true)
  })

  it('stop() fades everything out rather than snapping', () => {
    const c = createGestureController()
    c.play('celebrate', { force: true }); c.hold('thinkingHand')
    let prev = values(run(c, 0.8)), maxJump = 0
    c.stop()
    run(c, 0.6, f => { const v = values(f); maxJump = Math.max(maxJump, ...v.map((x, i) => Math.abs(x - prev[i]))); prev = v })
    expect(maxJump).toBeLessThan(0.3)
    expect(Math.max(...prev.map(Math.abs))).toBeLessThan(1e-9)
  })

  it('reduces tracking and the base arm motion only while a gesture plays', () => {
    const c = createGestureController()
    c.play('headShake', { force: true })
    const mid = run(c, 0.5)
    expect(mid.look).toBeLessThan(0.2)
    expect(mid.baseL).toBe(1) // headShake does not touch the arms
    c.play('celebrate', { force: true })
    expect(run(c, 0.6).baseL).toBeLessThan(0.05)
  })
})

describe('accessibility and settings', () => {
  it('reduced motion skips one-shots, even forced, and shows held gestures gently', () => {
    const c = createGestureController({ reducedMotion: true, reducedIntensity: 0.5 })
    expect(c.play('celebrate', { force: true })).toBe(false)
    c.hold('thinkingHand')
    const gentle = run(c, 2).handR.swing
    const full = createGestureController(); full.hold('thinkingHand')
    expect(gentle).toBeCloseTo(run(full, 2).handR.swing * 0.5, 2)
  })

  it('turning reduced motion on mid-gesture fades the one-shot out', () => {
    const c = createGestureController()
    c.play('welcomeWave', { force: true }); run(c, 0.6)
    c.setReducedMotion(true)
    expect(Math.abs(run(c, 0.5).handR.raise)).toBeLessThan(1e-9)
  })

  it('intensity 0 (GESTURE_SETTINGS.enabled false) refuses gestures', () => {
    expect(createGestureController({ intensity: 0 }).play('nod', { force: true })).toBe(false)
  })
})

describe('events', () => {
  const recorder = () => {
    const events: GestureEvent[] = []
    return { events, c: createGestureController({ onEvent: e => events.push(e) }) }
  }
  const short = (e: GestureEvent) => `${e.type} ${e.name}${e.type === 'end' ? ` ${e.reason}` : ''}`

  it('reports a one-shot starting and finishing', () => {
    const { events, c } = recorder()
    c.play('nod', { force: true }); run(c, 1)
    expect(events.map(short)).toEqual(['start nod', 'end nod finished'])
  })

  it('reports interruptions, stops and releases with their reason', () => {
    const { events, c } = recorder()
    c.hold('thinkingHand')
    c.play('welcomeWave', { force: true }); run(c, 0.2)
    c.play('celebrate', { force: true }); run(c, 0.2)
    c.stop()
    c.hold('thinkingHand'); c.hold(null)
    expect(events.map(short)).toEqual([
      'start thinkingHand', 'start welcomeWave', 'end welcomeWave interrupted', 'start celebrate',
      'end thinkingHand stopped', 'end celebrate stopped', 'start thinkingHand', 'end thinkingHand released',
    ])
  })

  it('reports nothing for a refused gesture', () => {
    const { events, c } = recorder()
    c.play('celebrate', { force: true }); c.play('nod')
    expect(events.map(short)).toEqual(['start celebrate'])
  })
})

describe('channel', () => {
  it('replays the latest hold and a fresh play to a robot that subscribes late', () => {
    const ch = createGestureChannel()
    ch.hold('thinkingHand'); ch.play('welcomeWave')
    const got: GestureCommand[] = []
    ch.subscribe(cmd => got.push(cmd))
    expect(got.map(c => c.type === 'stop' ? 'stop' : `${c.type} ${c.name}`)).toEqual(['hold thinkingHand', 'play welcomeWave'])
    ch.play('nod')
    expect(got).toHaveLength(3)
  })

  it('stop with nobody listening clears what was waiting', () => {
    const ch = createGestureChannel()
    ch.play('celebrate'); ch.stop()
    const got: GestureCommand[] = []
    ch.subscribe(cmd => got.push(cmd))
    expect(got).toEqual([])
  })

  it('carries gesture events back out to every observer until they unsubscribe', () => {
    const ch = createGestureChannel()
    const seen: GestureName[] = []
    const off = ch.onEvent(e => seen.push(e.name))
    ch.emit({ type: 'start', name: 'nod', held: false })
    off()
    ch.emit({ type: 'start', name: 'celebrate', held: false })
    expect(seen).toEqual(['nod'])
  })
})

describe('timing', () => {
  it('keeps real time on a slow device (4 fps) but never skips more than 250 ms at once', () => {
    const c = createGestureController()
    c.play('welcomeWave', { force: true })
    for (let i = 0; i < 9; i++) c.update(0.25) // 2.25 s at 4 fps: past the 2 s wave
    expect(c.busy()).toBe(false)
    const d = createGestureController()
    d.play('welcomeWave', { force: true })
    d.update(5) // a tab that was hidden for 5 s comes back: one 250 ms step, not the end
    expect(d.busy()).toBe(true)
  })
})
