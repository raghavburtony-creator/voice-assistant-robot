// Otto on his own: awake while things happen, idle (looking about now and then) after a quiet spell, asleep after a long one.
// A pure state machine on a clock you pass in (so tests and the lab can fast-forward), and a hook that feeds it the page.
//
//   awake  --idleLookAroundMs quiet-->  idle  --sleepTimeoutMs quiet-->  asleep
//     ^          (any activity)          |                                  |
//     +----------------------------------+------- hover over Otto, a click or tap, a key (the hotkey too)
//
// Moving the cursor or scrolling counts as activity while awake or idle, but does not wake Otto once asleep: only coming
// over him, a click or a key does, so he is not woken by someone reading the page. While `busy` (a voice session, the panel
// open, a walk) he stays awake and the clock does not run.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { IDLE_SETTINGS } from '../otto.config'

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

export type IdleHookOptions = {
  /** Held awake while true. */
  busy: boolean
  /** Otto's element: the cursor coming over it wakes him. */
  robot: RefObject<HTMLElement | null>
  /** Called for each idle behaviour while idle (pick a gesture, a glance...). */
  onLook?: () => void
  times?: IdleTimes
  enabled?: boolean
}

/**
 * The idle lifecycle, fed by the page: the cursor, scroll, clicks, keys, and the cursor over `robot`. Runs on timers set
 * for the next thing due (no frame loop). Returns the state and controls for the lab.
 */
export function useIdleLifecycle({ busy, robot, onLook, times = IDLE_SETTINGS, enabled = true }: IdleHookOptions) {
  const [state, setState] = useState<IdleState>('awake')
  const life = useRef<IdleLifecycle | null>(null)
  const timer = useRef<number | undefined>(undefined)
  const look = useRef(onLook)
  const busyRef = useRef(busy)
  useEffect(() => { look.current = onLook; busyRef.current = busy })

  const run = useCallback(() => {
    const l = life.current
    if (!l) return
    window.clearTimeout(timer.current)
    for (const event of l.tick(performance.now())) {
      if (event.type === 'state') setState(event.state)
      else look.current?.()
    }
    const due = l.next()
    if (due !== Infinity) timer.current = window.setTimeout(run, Math.max(16, due - performance.now()))
  }, [])

  useEffect(() => {
    if (!enabled) { setState('awake'); return }
    const l = createIdleLifecycle(times, performance.now())
    l.setBusy(busyRef.current, performance.now())
    life.current = l
    // Pointer moves are many: only note them, at most a few times a second.
    let lastMove = 0
    const onMove = () => {
      const now = performance.now()
      if (now - lastMove < 250) return
      lastMove = now
      if (l.state === 'asleep') return
      l.activity(now); run()
    }
    const onPress = () => { l.wake(performance.now()); run() }
    const onHover = () => { l.wake(performance.now()); run() }
    const passive = { passive: true, capture: true } as const
    window.addEventListener('pointermove', onMove, passive)
    window.addEventListener('scroll', onMove, passive)
    window.addEventListener('wheel', onMove, passive)
    window.addEventListener('pointerdown', onPress, passive)
    window.addEventListener('keydown', onPress, passive)
    const el = robot.current
    el?.addEventListener('pointerenter', onHover)
    run()
    return () => {
      window.removeEventListener('pointermove', onMove, passive)
      window.removeEventListener('scroll', onMove, passive)
      window.removeEventListener('wheel', onMove, passive)
      window.removeEventListener('pointerdown', onPress, passive)
      window.removeEventListener('keydown', onPress, passive)
      el?.removeEventListener('pointerenter', onHover)
      window.clearTimeout(timer.current)
      life.current = null
    }
    // A change of times starts a fresh lifecycle.
  }, [enabled, times.idleLookAroundMs, times.sleepTimeoutMs, robot, run]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { life.current?.setBusy(busy, performance.now()); run() }, [busy, run])

  const wake = useCallback(() => { life.current?.wake(performance.now()); run() }, [run])
  const sleep = useCallback(() => { life.current?.sleep(performance.now()); run() }, [run])
  const idleNow = useCallback(() => { life.current?.idleNow(performance.now()); run() }, [run])
  return { state, wake, sleep, idleNow }
}
