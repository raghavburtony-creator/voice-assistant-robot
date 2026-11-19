// Otto's movement: where Otto stands on the stage (a strip along the bottom of the page, or of any container), where he is
// going, and how he gets there. Pure state and math, no DOM and no React: useStageHost (useStage.ts) feeds it the stage's
// size and the obstacles to keep clear of, and moves the robot's element; ClayScene reads `frame` to animate the walk.
//
// The app says WHAT should happen, the stage decides HOW:
//
//   stage.moveToX(0.2)                    walk to 20% across the stage
//   await stage.moveToElement('#cart')    walk under (or beside) an element; resolves true on arrival
//   stage.goHome()                        back to the normal spot (MOVEMENT_SETTINGS.home)
//   stage.moveAwayFrom('#toast')          step clear of something
//   stage.turnToward('#cart')             orient toward something without walking
//   stage.lookAt('#cart')                 head and eyes on something (null: back to following the cursor)
//   stage.stop()                          stop where he is
//
// One destination ("intent") is kept until the next command, and obstacles (the voice panel, MOVEMENT_SETTINGS.avoid) only
// bend it: when the panel opens over the destination Otto walks aside, and when it closes he walks back to it.
//
// A move: idle -> turning (the body turns toward the destination) -> walking (eases up to speed, slows on arrival) ->
// arriving (turns back to face the viewer) -> idle. Reversing mid-walk slows, turns, then walks back. With reduced motion,
// or movement turned off, Otto snaps to the spot instead (still clear of obstacles), and nothing walks.

/** A rectangle in the stage's coordinates (CSS px; the viewport's, for the page stage). */
export type Rect = { left: number; top: number; right: number; bottom: number }

/** Something to go to or look at: an x (px), a rect, an element, a selector, or a function that returns one of those. */
export type StagePlace = number | Rect | Element | string | (() => number | Rect | Element | string | null)

export type MovePhase = 'idle' | 'turning' | 'walking' | 'arriving'

export type StageEvent =
  | { type: 'depart'; from: number; to: number }
  | { type: 'arrive'; x: number }
  | { type: 'cancel'; x: number; reason: 'stopped' | 'superseded' | 'blocked' }
  /** No room on the stage for the robot (a phone with the panel open): it hides until there is. */
  | { type: 'hidden'; hidden: boolean }

/** What the renderer reads every frame. Reused: read it, do not keep it. */
export type StageFrame = {
  /** Centre of the robot's footprint (px). */
  x: number
  /** Velocity (px/s, + toward the right) and acceleration (px/s²). */
  v: number
  accel: number
  /** |v| / top speed, 0..1. */
  speed: number
  /** Which way the body faces: -1 the robot's travel to the left, 0 the viewer, +1 to the right. Eased. */
  heading: number
  phase: MovePhase
  /** A point to look at (stage px), or null to follow the cursor. */
  gaze: { x: number; y: number } | null
  hidden: boolean
}

export type StageOptions = {
  /** Top walking speed, px/s. */
  speed?: number
  /** Kept clear at the stage's left and right edges (px). */
  margins?: { left: number; right: number }
  /** The normal spot, 0 (left) to 1 (right) across the free stage. */
  home?: number
  /** Space kept between the robot's footprint and an obstacle (px; negative lets them overlap). */
  gap?: number
  /** Seconds to turn toward a destination before the first step. */
  turnTime?: number
  /** Walking on commands. Off: Otto stays home, still stepping (snapping) clear of obstacles. */
  enabled?: boolean
  /** Snap instead of walking. */
  reducedMotion?: boolean
  onEvent?: (event: StageEvent) => void
  /** Resolves selectors and elements (the host passes one bound to the document). */
  measure?: (place: Element | string) => Rect | null
}

export type MoveOptions = {
  /** For elements: keep walking to it as it moves (scrolls, animates), until the next command. */
  follow?: boolean
}

export type StageController = {
  moveToX(normalized: number): Promise<boolean>
  /** Walk to an x in px (stage coordinates). */
  moveToPx(x: number): Promise<boolean>
  moveToElement(place: StagePlace, options?: MoveOptions): Promise<boolean>
  goHome(): Promise<boolean>
  moveAwayFrom(place: StagePlace, distance?: number): Promise<boolean>
  stop(): void
  /** Turn the body toward something for `seconds` (default 1.5) without walking. */
  turnToward(place: StagePlace, seconds?: number): void
  /** Head and eyes on something for `seconds` (default: until lookAt(null)). */
  lookAt(place: StagePlace | null, seconds?: number): void

  /** For the host: the stage's extent, the robot's size, and what to keep clear of. */
  setBounds(bounds: Rect, robot: { width: number; height: number; footprint?: number }): void
  setObstacles(rects: Rect[]): void
  setReducedMotion(on: boolean): void
  setEnabled(on: boolean): void
  setSpeed(pxPerSecond: number): void
  /** Advances dt seconds (clamped to 0.25). Returns true while anything still moves (the host keeps its loop running). */
  update(dt: number): boolean
  busy(): boolean
  readonly frame: StageFrame
  /** Where the current destination is (px), after obstacles; null before the stage has bounds. */
  readonly goal: number | null
  /** Hear departures and arrivals. Returns an unsubscribe function. */
  onEvent(listener: (event: StageEvent) => void): () => void
  /** Called whenever something starts moving, so the host can start its loop. */
  onWake(listener: () => void): () => void
}

type Intent =
  | { kind: 'home' }
  | { kind: 'px'; x: number }
  | { kind: 'place'; place: StagePlace; follow: boolean }
  | { kind: 'away'; place: StagePlace; distance: number }
  | { kind: 'here' }

type Pending = { resolve: (arrived: boolean) => void }

const ARRIVE_PX = 0.5       // close enough to the goal
const START_PX = 6          // a gap smaller than this is not worth a walk (when standing)
const FOLLOW_START_PX = 28  // following: let the target drift this far before setting off again
const FACING = 0.82         // |heading| past which the body faces its way well enough to step

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x))
const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0)
const isRect = (v: unknown): v is Rect => typeof v === 'object' && v !== null && !('nodeType' in v) && 'left' in v && 'right' in v

export function createStage(options: StageOptions = {}): StageController {
  let speed = Math.max(1, options.speed ?? 260)
  const margins = options.margins ?? { left: 8, right: 8 }
  const home = clamp(options.home ?? 1, 0, 1)
  const gap = options.gap ?? 16
  const turnTime = Math.max(0.05, options.turnTime ?? 0.24)
  let enabled = options.enabled ?? true
  let reduced = options.reducedMotion ?? false
  const measure = options.measure ?? (() => null)

  let bounds: Rect | null = null
  let robot = { width: 240, height: 216, footprint: 144 }
  let obstacles: Rect[] = []
  let intent: Intent = { kind: 'home' }
  let pending: Pending[] = []
  let goal: number | null = null
  let started = false // a walk is under way toward `goal` (so small corrections keep following it)
  let attention: { dir: number; until: number } | null = null
  let gaze: { place: StagePlace; until: number } | null = null
  let clock = 0
  let lastV = 0

  const frame: StageFrame = { x: 0, v: 0, accel: 0, speed: 0, heading: 0, phase: 'idle', gaze: null, hidden: false }
  const listeners = new Set<(event: StageEvent) => void>()
  const wakers = new Set<() => void>()
  if (options.onEvent) listeners.add(options.onEvent)
  const emit = (event: StageEvent) => listeners.forEach(l => l(event))
  const wake = () => wakers.forEach(w => w())

  const settle = (arrived: boolean) => { const was = pending; pending = []; was.forEach(p => p.resolve(arrived)) }

  /** A place as an x (px) or a rect, or null when it cannot be found now. */
  function resolve(place: StagePlace): number | Rect | null {
    const value = typeof place === 'function' ? place() : place
    if (value === null || value === undefined) return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (isRect(value)) return value
    return measure(value as Element | string)
  }
  const centreOf = (r: number | Rect) => (typeof r === 'number' ? r : (r.left + r.right) / 2)

  /** Where the robot's centre may stand: the stage minus its margins (for its half-width). */
  function range(): [number, number] {
    const b = bounds!
    const half = robot.width / 2
    const lo = b.left + margins.left + half, hi = b.right - margins.right - half
    return lo <= hi ? [lo, hi] : [(lo + hi) / 2, (lo + hi) / 2]
  }

  /** Free stretches for the centre, given obstacles that reach down into the robot's band. */
  function freeSpans(extra: Rect | null): [number, number][] {
    const b = bounds!
    const [lo, hi] = range()
    const band = { top: b.bottom - robot.height, bottom: b.bottom }
    const half = robot.footprint / 2
    let spans: [number, number][] = [[lo, hi]]
    const all = extra ? [...obstacles, extra] : obstacles
    for (const o of all) {
      if (o.bottom <= band.top || o.top >= band.bottom || o.right <= o.left) continue
      const cutL = o.left - half - gap, cutR = o.right + half + gap
      const next: [number, number][] = []
      for (const [a, z] of spans) {
        if (cutR <= a || cutL >= z) { next.push([a, z]); continue }
        if (cutL > a) next.push([a, cutL])
        if (cutR < z) next.push([cutR, z])
      }
      spans = next
    }
    return spans
  }

  /** The free x nearest `want`; on a tie, the one on the robot's side. Null when the stage has no room. */
  function place(want: number, extra: Rect | null = null): number | null {
    const spans = freeSpans(extra)
    let best: number | null = null, bestD = Infinity
    for (const [a, z] of spans) {
      const x = clamp(want, a, z)
      const d = Math.abs(x - want) + (sign(x - want) === sign(frame.x - want) ? 0 : 1e-6)
      if (d < bestD) { bestD = d; best = x }
    }
    return best
  }

  /** The destination for the current intent, after obstacles (px), or null with no room. */
  function target(): number | null {
    if (!bounds) return null
    const [lo, hi] = range()
    const homeX = place(lo + (hi - lo) * home)
    if (!enabled && intent.kind !== 'here') return homeX
    switch (intent.kind) {
      case 'home': return homeX
      case 'here': return place(frame.x)
      case 'px': return place(intent.x)
      case 'place': {
        const r = resolve(intent.place)
        if (r === null) return place(frame.x)
        // Something down on the stage itself is stood beside, not on: it counts as an obstacle while going to it.
        return place(centreOf(r), typeof r === 'number' ? null : r)
      }
      case 'away': {
        const r = resolve(intent.place)
        if (r === null) return place(frame.x)
        const rect = typeof r === 'number' ? { left: r, right: r, top: -Infinity, bottom: Infinity } : r
        const c = centreOf(rect)
        const side = sign(frame.x - c) || 1
        const half = robot.footprint / 2
        const want = side > 0 ? rect.right + half + intent.distance : rect.left - half - intent.distance
        return place(want, { ...rect, top: -Infinity, bottom: Infinity })
      }
    }
  }

  function setHidden(hidden: boolean) {
    if (frame.hidden === hidden) return
    frame.hidden = hidden
    emit({ type: 'hidden', hidden })
  }

  /** Re-aims at the current intent. `fresh`: a new command (a walk starts even for a small gap). */
  function retarget(fresh: boolean) {
    const next = target()
    if (next === null) {
      // No room: hide where he is; the destination stays, for when room comes back.
      setHidden(true)
      return
    }
    setHidden(false)
    goal = next
    if (!started && !snapping() && Math.abs(goal - frame.x) > (fresh ? ARRIVE_PX : threshold())) {
      started = true
      if (frame.phase === 'idle' || frame.phase === 'arriving') frame.phase = 'turning'
      emit({ type: 'depart', from: frame.x, to: goal })
      wake()
    }
    if (snapping()) snapTo(goal)
  }
  const threshold = () => (intent.kind === 'place' && intent.follow ? FOLLOW_START_PX : START_PX)
  const snapping = () => reduced || !enabled

  function snapTo(x: number) {
    const moved = Math.abs(x - frame.x) > ARRIVE_PX
    if (moved) emit({ type: 'depart', from: frame.x, to: x })
    frame.x = x
    frame.v = frame.accel = frame.speed = frame.heading = 0
    frame.phase = 'idle'
    started = false
    if (moved || pending.length) emit({ type: 'arrive', x })
    settle(true)
  }

  /** Starts a new command: whatever was pending is superseded. */
  function command(next: Intent): Promise<boolean> {
    if (pending.length) { emit({ type: 'cancel', x: frame.x, reason: 'superseded' }); settle(false) }
    // Movement off: Otto stays home, so a command to go anywhere else is refused (and home is kept).
    if (!enabled && next.kind !== 'home') return Promise.resolve(false)
    intent = next
    const promise = new Promise<boolean>(resolve => pending.push({ resolve }))
    if (!bounds) return promise // resolved once the host gives the stage its size
    started = false
    const before = frame.phase
    retarget(true)
    if (frame.hidden) { emit({ type: 'cancel', x: frame.x, reason: 'blocked' }); settle(false) }
    else if (!started && before !== 'walking' && goal !== null && Math.abs(goal - frame.x) <= ARRIVE_PX && !snapping()) {
      // Already there.
      emit({ type: 'arrive', x: frame.x })
      settle(true)
    } else if (frame.phase === 'walking' || frame.phase === 'turning') started = true
    return promise
  }

  const now = () => clock

  const stage: StageController = {
    frame,
    get goal() { return goal },
    moveToX: n => {
      if (!bounds) return command({ kind: 'home' })
      const [lo, hi] = range()
      return command({ kind: 'px', x: lo + (hi - lo) * clamp(n, 0, 1) })
    },
    moveToPx: x => command({ kind: 'px', x }),
    moveToElement: (p, o) => command({ kind: 'place', place: p, follow: o?.follow ?? false }),
    goHome: () => command({ kind: 'home' }),
    moveAwayFrom: (p, distance = 48) => command({ kind: 'away', place: p, distance }),
    stop() {
      if (pending.length) { emit({ type: 'cancel', x: frame.x, reason: 'stopped' }); settle(false) }
      intent = { kind: 'here' }
      // Slow to a halt where he is (decelerating, not a dead stop), then face the viewer.
      if (bounds) {
        const stopping = frame.v * Math.abs(frame.v) / (2 * decel())
        goal = place(frame.x + stopping) ?? frame.x
        intent = { kind: 'px', x: goal }
        if (snapping()) snapTo(frame.x)
      }
      wake()
    },
    turnToward(p, seconds = 1.5) {
      const r = resolve(p)
      if (r === null) return
      attention = { dir: sign(centreOf(r) - frame.x), until: now() + seconds }
      wake()
    },
    lookAt(p, seconds) {
      gaze = p === null ? null : { place: p, until: seconds === undefined ? Infinity : now() + seconds }
      wake()
    },

    setBounds(next, size) {
      const first = !bounds
      const was = bounds
      bounds = next
      robot = { width: size.width, height: size.height, footprint: size.footprint ?? size.width * 0.6 }
      if (first) {
        // Start at the destination, not walking in from somewhere.
        frame.x = (next.left + next.right) / 2
        const t = target()
        if (t !== null) frame.x = t
        goal = t
        setHidden(t === null)
        if (intent.kind !== 'home' || pending.length) { emit({ type: 'arrive', x: frame.x }); settle(t !== null) }
        return
      }
      // A resize: standing still stays standing (snapped to the new spot); a walk carries on.
      const resting = frame.phase === 'idle' && !started
      if (was && resting) {
        const t = target()
        if (t !== null) { frame.x = t; goal = t; setHidden(false) } else setHidden(true)
      } else retarget(false)
    },
    setObstacles(rects) {
      obstacles = rects.slice()
      if (bounds) retarget(false)
    },
    setReducedMotion(on) {
      reduced = on
      if (on && bounds && goal !== null) snapTo(goal)
    },
    setEnabled(on) {
      enabled = on
      if (bounds) { started = false; retarget(false) }
    },
    setSpeed(px) { speed = Math.max(1, px) },

    busy() {
      return started || frame.phase !== 'idle' || Math.abs(frame.heading) > 1e-3 || attention !== null ||
        Math.abs(frame.v) > 1e-3 || (intent.kind === 'place' && intent.follow) || (gaze !== null && gaze.until !== Infinity)
    },

    update(dt) {
      // Fixed small steps, so a walk looks and lands the same at 30 fps as at 120.
      // Up to 250 ms a frame: a slow device still walks in real time (as gestures do); more (a tab coming back) is cut.
      let left = clamp(dt || 0, 0, 0.25)
      let busy = false
      do { const h = Math.min(left, 1 / 120); busy = advance(h); left -= h } while (left > 1e-9)
      return busy
    },

    onEvent(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    onWake(listener) { wakers.add(listener); return () => { wakers.delete(listener) } },
  }

  function advance(dt: number): boolean {
    clock += dt
    if (!bounds) return false
    if (attention && clock >= attention.until) attention = null

    // Gaze: resolved every frame (it may move), dropped when its time is up or it cannot be found.
    if (gaze && clock >= gaze.until) gaze = null
    const g = gaze ? resolve(gaze.place) : null
    if (g === null) frame.gaze = null
    else if (typeof g === 'number') frame.gaze = { x: g, y: bounds.bottom - robot.height }
    else frame.gaze = { x: (g.left + g.right) / 2, y: (g.top + g.bottom) / 2 }

    // A followed element is re-measured every frame.
    if (intent.kind === 'place' && intent.follow) retarget(false)

    if (snapping()) {
      frame.heading = 0
      frame.v = frame.accel = frame.speed = 0
      return gaze !== null && gaze.until !== Infinity
    }

    const dist = goal === null ? 0 : goal - frame.x
    const dir = sign(dist)
    const moving = Math.abs(frame.v) > 1

    // Heading: the way he is moving; before the first step, the way he is going; at rest, the viewer (or a turn toward
    // something). Eased at a constant rate, so turning takes `turnTime` for a full quarter turn.
    let want = 0
    if (moving) want = sign(frame.v)
    else if (started && Math.abs(dist) > ARRIVE_PX) want = dir
    else if (attention) want = attention.dir * 0.45
    const step = dt / turnTime
    frame.heading += clamp(want - frame.heading, -step, step)

    // Velocity: up to speed while facing the way; slowing so as to stop on the goal (v² = 2·a·d); a reversal (moving one
    // way, going the other) first slows to a halt.
    let vWant = 0
    if (started && Math.abs(dist) > ARRIVE_PX) {
      const facing = frame.heading * dir >= FACING
      if (facing && sign(frame.v) !== -dir) vWant = dir * Math.min(speed, Math.sqrt(2 * decel() * Math.abs(dist)))
      if (facing && frame.phase === 'turning') frame.phase = 'walking'
    }
    const a = accelFor(vWant)
    const dv = clamp(vWant - frame.v, -a * dt, a * dt)
    frame.v += dv
    // Never overshoot: a step past the goal lands on it.
    let nx = frame.x + frame.v * dt
    if (goal !== null && started && dir !== 0 && sign(goal - nx) !== dir) { nx = goal; frame.v = 0 }
    frame.x = nx
    frame.accel = frame.accel + ((frame.v - lastV) / Math.max(dt, 1e-3) - frame.accel) * Math.min(1, dt * 10)
    lastV = frame.v
    frame.speed = Math.min(1, Math.abs(frame.v) / speed)

    if (started && goal !== null && Math.abs(goal - frame.x) <= ARRIVE_PX && Math.abs(frame.v) < speed * 0.08) {
      frame.x = goal
      frame.v = 0
      started = false
      frame.phase = 'arriving'
      emit({ type: 'arrive', x: frame.x })
      settle(true)
    }
    if (frame.phase === 'arriving' && Math.abs(frame.heading) < 0.02 && !attention) {
      frame.heading = 0
      frame.phase = 'idle'
    }
    if (!started && frame.phase === 'idle' && !moving) frame.accel = 0
    return stage.busy()
  }

  /** Braking (px/s²): stops from full speed in about 0.45 s. Speeding up is a little gentler. */
  function decel() { return speed / 0.45 }
  function accelFor(vWant: number) { return Math.abs(vWant) > Math.abs(frame.v) ? speed / 0.55 : decel() }

  return stage
}
