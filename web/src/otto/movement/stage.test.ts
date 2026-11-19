import { describe, expect, it } from 'vitest'
import { createStage, type Rect, type StageEvent } from './stage'

// A 1200 x 800 page; the robot is 240 x 216 with a 144 px footprint.
const PAGE: Rect = { left: 0, top: 0, right: 1200, bottom: 800 }
const ROBOT = { width: 240, height: 216, footprint: 144 }
// The robot's centre can stand from 8 + 120 = 128 to 1200 - 8 - 120 = 1072.
const LO = 128, HI = 1072
const PANEL: Rect = { left: 756, top: 300, right: 1176, bottom: 776 } // a 420 px panel, bottom right

function make(options: Parameters<typeof createStage>[0] = {}) {
  const events: StageEvent[] = []
  const stage = createStage({ speed: 300, ...options, onEvent: e => events.push(e) })
  stage.setBounds(PAGE, ROBOT)
  return { stage, events }
}
/** Runs at 60 fps for up to `seconds`; returns the frames' x and heading. */
function run(stage: ReturnType<typeof createStage>, seconds: number) {
  const xs: number[] = [], headings: number[] = [], phases: string[] = []
  for (let t = 0; t < seconds; t += 1 / 60) {
    stage.update(1 / 60)
    xs.push(stage.frame.x); headings.push(stage.frame.heading); phases.push(stage.frame.phase)
  }
  return { xs, headings, phases }
}

describe('stage placement', () => {
  it('starts at home (the right end) without walking there', () => {
    const { stage, events } = make()
    expect(stage.frame.x).toBe(HI)
    expect(stage.busy()).toBe(false)
    expect(events).toEqual([])
  })

  it('moveToX maps 0..1 across the free stage, inside the margins', async () => {
    const { stage } = make({ reducedMotion: true })
    await stage.moveToX(0); expect(stage.frame.x).toBe(LO)
    await stage.moveToX(0.5); expect(stage.frame.x).toBe((LO + HI) / 2)
    await stage.moveToX(7); expect(stage.frame.x).toBe(HI)
  })

  it('an open panel pushes home aside to the nearest free spot, and closing it brings him back', () => {
    const { stage } = make({ gap: 16 })
    stage.setObstacles([PANEL])
    expect(stage.goal).toBe(PANEL.left - 72 - 16)
    run(stage, 6)
    expect(stage.frame.x).toBeCloseTo(PANEL.left - 88, 3)
    stage.setObstacles([])
    run(stage, 6)
    expect(stage.frame.x).toBe(HI)
  })

  it('obstacles above the robot band are ignored', () => {
    const { stage } = make()
    stage.setObstacles([{ left: 0, top: 0, right: 1200, bottom: 400 }])
    expect(stage.goal).toBe(HI)
  })

  it('with no room at all (a phone with the sheet open) he hides, and shows again when there is room', () => {
    const { stage, events } = make()
    stage.setObstacles([{ left: 0, top: 500, right: 1200, bottom: 800 }])
    expect(stage.frame.hidden).toBe(true)
    stage.setObstacles([])
    expect(stage.frame.hidden).toBe(false)
    expect(events.filter(e => e.type === 'hidden')).toEqual([{ type: 'hidden', hidden: true }, { type: 'hidden', hidden: false }])
  })

  it('goes to an element above the stage by standing under it, and beside one on the stage', async () => {
    const above = { left: 300, top: 100, right: 400, bottom: 140 }
    const { stage } = make({ reducedMotion: true, measure: () => above })
    await stage.moveToElement('#above')
    expect(stage.frame.x).toBe(350)
    const onStage = { left: 500, top: 700, right: 600, bottom: 760 }
    await stage.moveToElement(onStage)
    // Coming from the left, he stops on its left: 500 - 72 - 16.
    expect(stage.frame.x).toBe(412)
  })

  it('moveAwayFrom steps clear on the side he is already on', async () => {
    const { stage } = make({ reducedMotion: true })
    await stage.moveToPx(600)
    // At 600, right of its centre (590): steps out to the right, 620 + 72 + 40.
    await stage.moveAwayFrom({ left: 560, top: 0, right: 620, bottom: 800 }, 40)
    expect(stage.frame.x).toBe(732)
    await stage.moveToPx(500)
    await stage.moveAwayFrom({ left: 560, top: 0, right: 620, bottom: 800 }, 40)
    expect(stage.frame.x).toBe(560 - 72 - 40)
  })
})

describe('stage locomotion', () => {
  it('turns first, then walks, eases in and out, then turns back to the viewer', async () => {
    const { stage, events } = make()
    const arrived = stage.moveToX(0)
    const { xs, headings, phases } = run(stage, 6)
    expect(await arrived).toBe(true)
    // Turning: no step before the body faces the way (heading -> -1 for a walk to the left).
    const firstStep = xs.findIndex(x => x < HI - 0.01)
    expect(headings[firstStep]).toBeLessThanOrEqual(-0.8)
    expect(phases[0]).toBe('turning')
    // Eases: the first and last steps are small, the middle ones near top speed (300 px/s = 5 px a frame).
    const steps = xs.slice(1).map((x, i) => xs[i] - x).filter(d => d > 1e-6)
    expect(steps[0]).toBeLessThan(1)
    expect(Math.max(...steps)).toBeCloseTo(5, 1)
    expect(steps[steps.length - 1]).toBeLessThan(1.5)
    // Never past the goal, and facing the viewer again at the end.
    expect(Math.min(...xs)).toBe(LO)
    expect(stage.frame.heading).toBe(0)
    expect(stage.frame.phase).toBe('idle')
    expect(stage.busy()).toBe(false)
    expect(events.map(e => e.type)).toEqual(['depart', 'arrive'])
  })

  it('a reversal mid-walk slows to a halt, turns, and walks back', () => {
    const { stage } = make()
    void stage.moveToX(0)
    run(stage, 1.2)
    const mid = stage.frame.x
    void stage.moveToX(1)
    const { xs, headings } = run(stage, 8)
    // It keeps going left a little while it brakes, and only steps right once it faces right.
    expect(Math.min(...xs)).toBeLessThan(mid)
    const back = xs.findIndex((x, i) => i > 0 && x > xs[i - 1] + 1e-6)
    expect(headings[back]).toBeGreaterThanOrEqual(0.8)
    expect(stage.frame.x).toBe(HI)
  })

  it('a new command supersedes the last: its promise resolves false', async () => {
    const { stage, events } = make()
    const first = stage.moveToX(0)
    run(stage, 0.5)
    const second = stage.moveToX(0.5)
    expect(await first).toBe(false)
    run(stage, 6)
    expect(await second).toBe(true)
    expect(events.some(e => e.type === 'cancel' && e.reason === 'superseded')).toBe(true)
  })

  it('stop() brakes where he is instead of walking on', async () => {
    const { stage } = make()
    const going = stage.moveToX(0)
    run(stage, 1.5)
    const at = stage.frame.x
    stage.stop()
    expect(await going).toBe(false)
    run(stage, 3)
    expect(stage.frame.x).toBeLessThan(at)            // a short braking distance...
    expect(at - stage.frame.x).toBeLessThan(200)      // ...not the rest of the way
    expect(stage.frame.x).toBeGreaterThan(LO + 100)
    expect(stage.frame.phase).toBe('idle')
  })

  it('is frame-rate independent', () => {
    const at = (fps: number) => {
      const { stage } = make()
      void stage.moveToX(0)
      for (let i = 0; i < fps * 1.5; i++) stage.update(1 / fps)
      return stage.frame.x
    }
    expect(Math.abs(at(30) - at(120))).toBeLessThan(6)
  })

  it('turnToward orients the body without walking, then relaxes', () => {
    const { stage } = make()
    stage.turnToward(100, 1)
    const { xs, headings } = run(stage, 2)
    expect(Math.min(...headings)).toBeCloseTo(-0.45, 2)
    expect(new Set(xs).size).toBe(1)
    expect(stage.frame.heading).toBe(0)
  })

  it('follows a moving element, without stepping for every small drift', () => {
    let left = 300
    const { stage } = make({ measure: () => ({ left, top: 100, right: left + 40, bottom: 140 }) })
    void stage.moveToElement('#target', { follow: true })
    run(stage, 5)
    expect(stage.frame.x).toBe(320)
    left = 310 // a 10 px drift: stays put
    run(stage, 1)
    expect(stage.frame.x).toBe(320)
    left = 500 // far: walks after it
    run(stage, 4)
    expect(stage.frame.x).toBe(520)
  })

  it('reduced motion snaps: no walking, no turning', async () => {
    const { stage, events } = make({ reducedMotion: true })
    expect(await stage.moveToX(0)).toBe(true)
    expect(stage.frame.x).toBe(LO)
    expect(stage.frame.heading).toBe(0)
    expect(stage.busy()).toBe(false)
    expect(events.map(e => e.type)).toEqual(['depart', 'arrive'])
  })

  it('with movement off he stays home, refuses to go elsewhere, and still snaps clear of the panel', async () => {
    const { stage } = make({ enabled: false })
    expect(await stage.moveToX(0)).toBe(false)
    expect(stage.frame.x).toBe(HI)
    stage.setObstacles([PANEL])
    expect(stage.frame.x).toBe(PANEL.left - 88)
  })

  it('a resize while standing keeps him standing at the new spot', () => {
    const { stage } = make()
    stage.setBounds({ ...PAGE, right: 900 }, ROBOT)
    expect(stage.frame.x).toBe(900 - 128)
    expect(stage.busy()).toBe(false)
  })

  it('lookAt reports the point to look at, and lets go after its time', () => {
    const { stage } = make()
    stage.lookAt({ left: 100, top: 100, right: 200, bottom: 140 }, 0.5)
    stage.update(1 / 60)
    expect(stage.frame.gaze).toEqual({ x: 150, y: 120 })
    run(stage, 1)
    expect(stage.frame.gaze).toBeNull()
  })
})
