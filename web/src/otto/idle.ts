// Otto on his own: awake while things happen, idle (looking about now and then) after a quiet spell, asleep after a long one.
// A pure state machine on a clock you pass in (so tests and the lab can fast-forward). useIdleLifecycle.ts feeds it the page.
//
//   awake  --idleLookAroundMs quiet-->  idle  --sleepTimeoutMs quiet-->  asleep
//     ^          (any activity)          |                                  |
//     +----------------------------------+------- hover over Otto, a click or tap, a key (the hotkey too)
//
// Moving the cursor or scrolling counts as activity while awake or idle, but does not wake Otto once asleep: only coming
// over him, a click or a key does, so he is not woken by someone reading the page. While `busy` (a voice session, the panel
// open, a walk) he stays awake and the clock does not run.


export type IdleState = 'awake' | 'idle' | 'asleep'
/** 'look': time for an idle behaviour (a glance about, a stretch...). */
export type IdleEvent = { type: 'state'; state: IdleState } | { type: 'look' }

export type IdleTimes = { idleLookAroundMs: number; sleepTimeoutMs: number }

export type IdleLifecycle = {
  readonly state: IdleState
  /** Cursor moved, scroll: keeps him awake, but does not wake him. */
  activity(now: number): void
  /** Hover over Otto, click, tap, key: wakes him. */
  wake(now: number): void
  /** Doze off now (the lab; or an app that wants him quiet). */
  sleep(now: number): void
  /** Skip ahead to idle now (the lab). */
  idleNow(now: number): void
  /** Held awake while true, with the quiet clock stopped (a voice session, a walk). */
  setBusy(busy: boolean, now: number): void
  setTimes(times: IdleTimes, now: number): void
  /** Runs the clock to `now`; returns what happened, in order. */
  tick(now: number): IdleEvent[]
  /** When tick() next has something to do (ms, same clock), or Infinity. */
  next(): number
}

/** `random` picks where between 0.8x and 1.4x idleLookAroundMs the next idle behaviour falls (tests pass a fixed one). */
export function createIdleLifecycle(times: IdleTimes, now: number, random: () => number = Math.random): IdleLifecycle {
  let t = { ...times }
  let state: IdleState = 'awake'
  let quietSince = now
  let busy = false
  let nextLook = Infinity
  let queued: IdleEvent[] = []

  const set = (next: IdleState) => {
    if (state === next) return
    state = next
    queued.push({ type: 'state', state })
  }
  const lookGap = () => t.idleLookAroundMs * (0.8 + 0.6 * random())

  const life: IdleLifecycle = {
    get state() { return state },
    activity(at) {
      if (state === 'asleep') return
      quietSince = at
      nextLook = Infinity
      set('awake')
    },
    wake(at) {
      quietSince = at
      nextLook = Infinity
      set('awake')
    },
    sleep(at) {
      quietSince = at - t.sleepTimeoutMs
      nextLook = Infinity
      set('asleep')
    },
    idleNow(at) {
      if (busy) return
      quietSince = at - t.idleLookAroundMs
      if (state === 'asleep') set('awake')
    },
    setBusy(on, at) {
      if (busy === on) return
      busy = on
      if (on) { quietSince = at; nextLook = Infinity; set('awake') }
      else quietSince = at
    },
    setTimes(next, at) {
      t = { ...next }
      quietSince = at
      nextLook = Infinity
      if (state !== 'asleep') set('awake')
    },
    tick(at) {
      if (!busy) {
        const quiet = at - quietSince
        if (state !== 'asleep' && quiet >= t.sleepTimeoutMs) { set('asleep'); nextLook = Infinity }
        else if (state === 'awake' && quiet >= t.idleLookAroundMs) {
          set('idle')
          queued.push({ type: 'look' })
          nextLook = at + lookGap()
        } else if (state === 'idle' && at >= nextLook) {
          queued.push({ type: 'look' })
          nextLook = at + lookGap()
        }
      }
      const out = queued
      queued = []
      return out
    },
    next() {
      if (busy) return Infinity
      if (state === 'asleep') return Infinity
      const sleepAt = quietSince + t.sleepTimeoutMs
      if (state === 'awake') return Math.min(quietSince + t.idleLookAroundMs, sleepAt)
      return Math.min(nextLook, sleepAt)
    },
  }
  return life
}
