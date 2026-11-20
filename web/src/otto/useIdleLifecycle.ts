// The hook that feeds the idle lifecycle (idle.ts, pure) the page: the cursor, scroll, clicks, keys, and the cursor over Otto.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { createIdleLifecycle, type IdleLifecycle, type IdleState, type IdleTimes } from './idle'
import { useOttoConfig } from './useOttoConfig'

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
export function useIdleLifecycle({ busy, robot, onLook, times: given, enabled = true }: IdleHookOptions) {
  const configured = useOttoConfig().idle
  const times = given ?? configured
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
