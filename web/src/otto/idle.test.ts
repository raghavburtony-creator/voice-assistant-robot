import { describe, expect, it } from 'vitest'
import { createIdleLifecycle, type IdleEvent } from './idle'

const TIMES = { idleLookAroundMs: 1000, sleepTimeoutMs: 5000 }
const half = () => 0.5 // look gaps of exactly 1.1 x idleLookAroundMs
/** Ticks every 100 ms from `from` to `to`, collecting events with their times. */
function play(l: ReturnType<typeof createIdleLifecycle>, from: number, to: number) {
  const out: [number, IdleEvent][] = []
  for (let t = from; t <= to; t += 100) for (const e of l.tick(t)) out.push([t, e])
  return out
}

describe('idle lifecycle', () => {
  it('goes idle after idleLookAroundMs, looks about now and then, and sleeps after sleepTimeoutMs', () => {
    const l = createIdleLifecycle(TIMES, 0, half)
    const events = play(l, 0, 6000)
    expect(events).toEqual([
      [1000, { type: 'state', state: 'idle' }], [1000, { type: 'look' }],
      [2100, { type: 'look' }], [3200, { type: 'look' }], [4300, { type: 'look' }],
      [5000, { type: 'state', state: 'asleep' }],
    ])
    expect(l.state).toBe('asleep')
    expect(l.next()).toBe(Infinity)
  })

  it('cursor movement keeps him awake, but does not wake him once asleep', () => {
    const l = createIdleLifecycle(TIMES, 0, half)
    play(l, 0, 900); l.activity(900)
    expect(play(l, 1000, 1800)).toEqual([])
    l.sleep(2000)
    l.activity(2100)
    expect(l.state).toBe('asleep')
  })

  it('hover, click or key wakes him, and the quiet clock starts again', () => {
    const l = createIdleLifecycle(TIMES, 0, half)
    l.sleep(0)
    l.tick(0)
    l.wake(100)
    expect(l.tick(100)).toEqual([{ type: 'state', state: 'awake' }])
    expect(play(l, 200, 1000)).toEqual([])
    expect(play(l, 1100, 1100)).toEqual([[1100, { type: 'state', state: 'idle' }], [1100, { type: 'look' }]])
  })

  it('stays awake, with the clock stopped, while busy', () => {
    const l = createIdleLifecycle(TIMES, 0, half)
    l.sleep(0)
    l.setBusy(true, 10)
    expect(l.state).toBe('awake')
    // The sleep and the wake are reported at the next tick; then nothing for 20 s.
    expect(play(l, 100, 20000).map(([, e]) => e)).toEqual([{ type: 'state', state: 'asleep' }, { type: 'state', state: 'awake' }])
    l.setBusy(false, 20000)
    expect(play(l, 20100, 20900)).toEqual([])
    expect(l.tick(21000)).toEqual([{ type: 'state', state: 'idle' }, { type: 'look' }])
  })

  it('next() names the moment something is due, so a timer can wait for it', () => {
    const l = createIdleLifecycle(TIMES, 0, half)
    expect(l.next()).toBe(1000)
    l.tick(1000)
    expect(l.next()).toBe(2100)
  })

  it('idleNow skips ahead (for the lab)', () => {
    const l = createIdleLifecycle(TIMES, 0, half)
    l.idleNow(200)
    expect(l.tick(200).map(e => e.type)).toEqual(['state', 'look'])
  })
})
