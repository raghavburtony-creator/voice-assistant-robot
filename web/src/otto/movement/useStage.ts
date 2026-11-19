// Binds a StageController (stage.ts) to the page: measures the stage (the viewport, or a container) and the robot, finds
// the obstacles to keep clear of, runs the stage while it moves, and moves the robot's element with a transform.
// Nothing runs while Otto stands still: a frame loop only while he walks, observers otherwise.

import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react'
import { DEFAULT_OTTO_CONFIG, useOttoConfig, type OttoConfig } from '../config'
import { useReducedMotion } from '../robot/robot'
import { createStage, type Rect, type StageController } from './stage'

/** Something to keep clear of: a selector (every match), an element, or a function returning rects. */
export type Obstacle = string | Element | (() => Rect[] | Rect | null)

export type StageHostOptions = {
  /** The stage: null for the viewport (the dock), or a container whose box the robot walks in. */
  container?: RefObject<HTMLElement | null> | null
  /** What to keep clear of, besides the config's movement.avoid. Re-read whenever `obstaclesKey` changes. */
  obstacles?: readonly Obstacle[]
  /** Change it to make the host look for the obstacles again (e.g. when the panel opens or closes). */
  obstaclesKey?: unknown
  /** The robot's footprint as a share of its element's width, for keeping clear of obstacles. */
  footprint?: number
}

const toRect = (r: DOMRect | Rect): Rect => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })

/** A stage with a config's movement settings (the defaults if none). Make it once (useMemo, or outside React) and keep it. */
export function createOttoStage(config: OttoConfig = DEFAULT_OTTO_CONFIG): StageController {
  const m = config.movement
  return createStage({
    speed: m.moveSpeed,
    margins: m.stageMargins,
    home: m.home,
    gap: m.obstacleGap,
    enabled: m.movementEnabled,
    measure: place => {
      if (typeof document === 'undefined') return null
      const element = typeof place === 'string' ? document.querySelector(place) : place
      return element ? toRect(element.getBoundingClientRect()) : null
    },
  })
}

/**
 * Moves `element` (position: fixed at left 0, or absolute in `container`) along the stage as `stage` says. Sets
 * `data-stage-side` ("left" / "right": which half Otto stands in, for the speech bubble) and hides it when there is no room.
 */
export function useStageHost(stage: StageController, element: RefObject<HTMLElement | null>, options: StageHostOptions = {}) {
  const reduced = useReducedMotion()
  const avoid = useOttoConfig().movement.avoid
  const opts = useRef(options)
  useEffect(() => { opts.current = options })
  const { obstaclesKey, container } = options

  useEffect(() => { stage.setReducedMotion(reduced) }, [stage, reduced])

  // Bounds: the viewport (or the container) and the robot's box, measured again whenever either changes size.
  useLayoutEffect(() => {
    const el = element.current
    if (!el) return
    const measure = () => {
      const box = container?.current?.getBoundingClientRect()
      const bounds = box ? toRect(box) : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      const width = el.offsetWidth, height = el.offsetHeight
      stage.setBounds(bounds, { width, height, footprint: width * (opts.current.footprint ?? 0.6) })
    }
    measure()
    window.addEventListener('resize', measure)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    if (container?.current) ro?.observe(container.current)
    return () => { window.removeEventListener('resize', measure); ro?.disconnect() }
  }, [stage, element, container])

  // The loop: wakes when something starts to move, stops once everything has settled. Placed before the first paint, so
  // Otto never shows at the wrong spot.
  useLayoutEffect(() => {
    let raf = 0, last = 0
    const apply = () => {
      const el = element.current
      if (!el) return
      const box = opts.current.container?.current?.getBoundingClientRect()
      const offset = box ? box.left : 0
      const width = el.offsetWidth
      el.style.transform = `translate3d(${(stage.frame.x - width / 2 - offset).toFixed(2)}px, 0, 0)`
      const mid = box ? (box.left + box.right) / 2 : window.innerWidth / 2
      el.dataset.stageSide = stage.frame.x < mid ? 'left' : 'right'
      el.style.visibility = stage.frame.hidden ? 'hidden' : ''
    }
    const tick = (now: number) => {
      const dt = last ? (now - last) / 1000 : 1 / 60
      last = now
      const busy = stage.update(dt)
      apply()
      if (busy) raf = requestAnimationFrame(tick)
      else { raf = 0; last = 0 }
    }
    const wake = () => { if (!raf) raf = requestAnimationFrame(tick) }
    const offWake = stage.onWake(wake)
    const offEvent = stage.onEvent(event => { if (event.type === 'hidden' || event.type === 'arrive') apply() })
    apply()
    wake()
    return () => { offWake(); offEvent(); if (raf) cancelAnimationFrame(raf) }
  }, [stage, element])

  // Obstacles: looked for when `obstaclesKey` changes, and measured again when one resizes or the window does.
  useEffect(() => {
    const list: Obstacle[] = [...avoid, ...(opts.current.obstacles ?? [])]
    const elements: Element[] = []
    const fns: (() => Rect[] | Rect | null)[] = []
    for (const item of list) {
      if (typeof item === 'string') elements.push(...Array.from(document.querySelectorAll(item)))
      else if (typeof item === 'function') fns.push(item)
      else elements.push(item)
    }
    const measure = () => {
      const rects: Rect[] = elements.filter(e => e.isConnected).map(e => toRect(e.getBoundingClientRect()))
      for (const fn of fns) { const r = fn(); if (Array.isArray(r)) rects.push(...r); else if (r) rects.push(r) }
      stage.setObstacles(rects)
    }
    measure()
    window.addEventListener('resize', measure)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    elements.forEach(e => ro?.observe(e))
    return () => { window.removeEventListener('resize', measure); ro?.disconnect() }
  }, [stage, obstaclesKey, avoid])
}

/** A stage made once for this component (when none is passed in). */
export function useOwnStage(given?: StageController, config?: OttoConfig): StageController {
  const own = useMemo(() => (given ? null : createOttoStage(config)), [given]) // eslint-disable-line react-hooks/exhaustive-deps
  return given ?? own!
}
