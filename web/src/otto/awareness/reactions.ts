// Otto's judgement: given an event and what he knows (his awareness), whether to react and how much. Pure: no DOM, no
// React, a clock passed in; the reaction is carried out by useAwareness (useAwareness.ts) through the face, gesture,
// movement and voice systems.
//
// A reaction has a size, and most events get the smallest that says enough:
//   glance   a look toward it, a flicker of mood          (minor events, repeats, while he is talking)
//   gesture  a nod, a small celebration, a head shake     (normal events)
//   big      walk there, full gesture, the bubble          (major events, rarely)
//
// What keeps him from being annoying, in order:
//   1. your rules (config.awareness.rules) may decide first, from the event and the awareness
//   2. nobody watching (tab hidden): no reaction; a failure or attention waits for the visitor to come back
//   3. asleep: only a failure, attention or a major event wakes him; the rest pass
//   4. talking with the visitor (voice): a glance at most, never a gesture over his own speech
//   5. a repeat (same type and topic within repeatWindowMs): one size smaller, and the third time nothing
//   6. too soon after the last reaction of that size (cooldownMs): smaller, or nothing
//   7. too many gestures this minute (gesturesPerMinute): a glance instead
// Each step that changes the reaction says so in `why`, which the lab shows.

import type { OttoConfig } from '../config'
import type { StagePlace } from '../movement/stage'
import type { GestureName } from '../robot/gestures'
import type { RobotExpression } from '../robot/robot'
import type { Importance, OttoEvent, OttoEventType } from './events'

export type ReactionSize = 'none' | 'glance' | 'gesture' | 'big'
const SIZES: ReactionSize[] = ['none', 'glance', 'gesture', 'big']

export type Reaction = {
  size: ReactionSize
  /** A mood for a moment (only while no voice session owns the face). */
  face?: RobotExpression
  faceMs?: number
  gesture?: GestureName
  gestureIntensity?: number
  /** Look at a place, or at the visitor ('user': back to following the cursor). */
  look?: StagePlace | 'user'
  lookMs?: number
  /** Turn the body toward it (without walking). */
  turn?: boolean
  /** Walk there first (the gesture plays on arrival), and back home later. */
  walk?: StagePlace
  /** Wake from sleep first. */
  wake?: boolean
  /** Said to screen readers; shown in the bubble too for a big reaction. */
  say?: string
  /** How it was decided, step by step. */
  why: string[]
}

/** What Otto knows when he decides. The reactor fills `app` and `recent`; the caller fills `self` and `user`. */
export type Awareness = {
  self: {
    asleep: boolean
    /** In a voice conversation (listening or speaking): the voice owns his face and body. */
    talking: boolean
    walking: boolean
    /** He may walk now (movement on, no panel open, no reduced motion). */
    mayMove: boolean
  }
  user: { present: boolean; idle: boolean }
  app: {
    /** Tasks running, oldest first. */
    tasks: readonly TaskInfo[]
    /** The last section opened. */
    section: string | null
    /** What the app is waiting on the visitor for, if anything. */
    waiting: StagePlace | null
  }
  recent: readonly { type: OttoEventType; topic?: string; at: number; size: ReactionSize }[]
}

export type TaskInfo = { id: string; topic?: string; where?: StagePlace; since: number }

/** Your own judgement, asked first. Return a Reaction (or { size: 'none' }) to decide, undefined to leave it to Otto. */
export type ReactionRule = (event: Readonly<OttoEvent>, awareness: Readonly<Awareness>) => Omit<Reaction, 'why'> | undefined

export type AwarenessSettings = OttoConfig['awareness']

const IMPORTANCE: Partial<Record<OttoEventType, Importance>> = { success: 'normal', failure: 'normal', attention: 'normal' }
const SIZE_OF: Record<Importance, ReactionSize> = { minor: 'glance', normal: 'gesture', major: 'big' }
/** The largest reaction an event of this type ever gets (a section opening is never a celebration). */
const MAX_SIZE: Partial<Record<OttoEventType, ReactionSize>> = {
  task: 'glance', section: 'gesture', select: 'gesture', waiting: 'gesture', interact: 'gesture', leave: 'none', idle: 'none',
}

/** The built-in reaction to each type, at each size. */
function shape(event: OttoEvent, size: ReactionSize): Omit<Reaction, 'why'> {
  const at = event.where
  const look = at ?? undefined
  const big = size === 'big'
  if (size === 'none') return { size }
  switch (event.type) {
    case 'success':
      return size === 'glance' ? { size, face: 'happy', faceMs: 1200, look, lookMs: 1000 }
        : { size, face: 'excited', faceMs: big ? 2600 : 1600, look, lookMs: big ? 2500 : 1500,
          gesture: 'celebrate', gestureIntensity: big ? 1 : 0.55, walk: big ? at : undefined, say: big ? event.message : undefined }
    case 'failure':
      return size === 'glance' ? { size, face: 'alert', faceMs: 1200, look, lookMs: 1200 }
        : { size, face: big ? 'alert' : 'sad', faceMs: big ? 3200 : 2200, look, lookMs: big ? 3000 : 2000, turn: !!at,
          gesture: 'headShake', gestureIntensity: big ? 1 : 0.7, say: big ? event.message : undefined }
    case 'attention':
      return size === 'glance' ? { size, face: 'curious', faceMs: 1500, look, lookMs: 1500 }
        : { size, face: 'curious', faceMs: big ? 3500 : 2500, look, lookMs: big ? 3500 : 2500, turn: !!at,
          gesture: big ? 'welcomeWave' : 'nod', gestureIntensity: big ? 0.7 : 0.5, walk: big ? at : undefined,
          say: big ? event.message : undefined }
    case 'complete':
      return size === 'glance' ? { size, face: 'happy', faceMs: 1000, look, lookMs: 800 }
        : { size, face: 'happy', faceMs: 1500, look, lookMs: 1200, gesture: big ? 'celebrate' : 'nod', gestureIntensity: big ? 0.7 : 0.6 }
    case 'task':
      return { size, look, lookMs: 1000 }
    case 'section':
      return size === 'glance' ? { size, face: 'curious', faceMs: 900, look, lookMs: 1100 }
        : { size, face: 'curious', faceMs: 1600, look, lookMs: 1600, turn: !!at, gesture: 'nod', gestureIntensity: 0.4 }
    case 'select':
      return size === 'glance' ? { size, look, lookMs: 700 } : { size, look, lookMs: 1200, gesture: 'nod', gestureIntensity: 0.5 }
    case 'waiting':
      return size === 'glance' ? { size, face: 'curious', faceMs: 2000, look, lookMs: 2000 }
        : { size, face: 'curious', faceMs: 2500, look, lookMs: 2500, turn: !!at, gesture: 'nod', gestureIntensity: 0.45 }
    case 'arrive':
      return size === 'glance' ? { size, face: 'happy', faceMs: 1500, look: 'user', lookMs: 1500 }
        : { size, face: 'excited', faceMs: big ? 2200 : 1600, look: 'user', lookMs: 1500, gesture: 'welcomeWave', gestureIntensity: big ? 1 : 0.7 }
    case 'interact':
      return size === 'glance' ? { size, face: 'happy', faceMs: 1200, look: 'user', lookMs: 1500 }
        : { size, face: 'excited', faceMs: 1000, look: 'user', lookMs: 1500, gesture: 'nod', gestureIntensity: 0.6 }
    default:
      return { size: 'none' }
  }
}

const smaller = (size: ReactionSize): ReactionSize => SIZES[Math.max(0, SIZES.indexOf(size) - 1)]
const atMost = (size: ReactionSize, cap: ReactionSize): ReactionSize => SIZES[Math.min(SIZES.indexOf(size), SIZES.indexOf(cap))]

export type Reactor = {
  /** Decide on an event at `now` (ms), given Otto's own state and the visitor's. Updates the awareness. */
  decide(event: OttoEvent, state: Pick<Awareness, 'self' | 'user'>, now: number): Reaction
  /** What Otto knows now. */
  awareness(state: Pick<Awareness, 'self' | 'user'>, now: number): Awareness
  /** The task to show on Otto now: the oldest that has run at least taskNoticeMs, and for how long. */
  activeTask(now: number): (TaskInfo & { ms: number }) | null
  /** Failures and attention that came while nobody was watching (handed back once, on the visitor's return). */
  takeMissed(): OttoEvent[]
  setSettings(settings: AwarenessSettings): void
}

/** Tasks never ended are forgotten after this long. */
const TASK_STALE_MS = 120_000

export function createReactor(initial: AwarenessSettings): Reactor {
  let settings = initial
  const tasks = new Map<string, TaskInfo>()
  let section: string | null = null
  let waiting: Awareness['app']['waiting'] = null
  let recent: Awareness['recent'][number][] = []
  /** When the last reaction of at least each size happened. */
  const last: Record<Exclude<ReactionSize, 'none'>, number> = { glance: -Infinity, gesture: -Infinity, big: -Infinity }
  let gestureTimes: number[] = []
  let missed: OttoEvent[] = []

  const cooldown = (size: Exclude<ReactionSize, 'none'>) => {
    const ms = settings.cooldownMs[size]
    return settings.liveliness === 'lively' ? ms * 0.6 : settings.liveliness === 'quiet' ? ms * 1.5 : ms
  }

  function track(event: OttoEvent, now: number) {
    for (const [id, t] of tasks) if (now - t.since > TASK_STALE_MS) tasks.delete(id)
    if (event.type === 'task' && event.task) tasks.set(event.task, { id: event.task, topic: event.topic, where: event.where, since: now })
    if (event.type === 'section') section = event.topic ?? (typeof event.where === 'string' ? event.where : 'section')
    if (event.type === 'waiting') waiting = event.where ?? 'page'
    if (event.type === 'select' || event.type === 'success' || event.type === 'complete' || event.type === 'section') waiting = null
  }

  /** An ending names its task: it inherits the task's place and topic. */
  function withTask(event: OttoEvent): OttoEvent {
    if (!event.task || event.type === 'task') return event
    const t = tasks.get(event.task)
    tasks.delete(event.task)
    return t ? { where: t.where, topic: t.topic, ...stripUndefined(event) } : event
  }

  const reactor: Reactor = {
    awareness(state, now) {
      for (const [id, t] of tasks) if (now - t.since > TASK_STALE_MS) tasks.delete(id)
      return { ...state, app: { tasks: [...tasks.values()], section, waiting }, recent: [...recent] }
    },

    decide(raw, state, now) {
      const event = withTask(raw)
      track(event, now)
      const why: string[] = []
      const importance = event.importance ?? IMPORTANCE[event.type] ?? 'minor'
      const known = reactor.awareness(state, now)
      let r: Omit<Reaction, 'why'> | undefined

      if (!settings.enabled) { r = { size: 'none' }; why.push('awareness off') }

      // 1. The app's own rules.
      if (!r) for (const rule of settings.rules) {
        const out = rule(event, known)
        if (out) { r = out; why.push('your rule'); break }
      }
      if (!r) {
        let size = atMost(SIZE_OF[importance], MAX_SIZE[event.type] ?? 'big')
        if (settings.liveliness === 'quiet' && importance !== 'major') size = atMost(size, 'glance')
        why.push(`${event.type} (${importance}): ${size}`)
        r = shape(event, size)
      }
      let size = r.size
      const resize = (next: ReactionSize, reason: string) => {
        if (next === size) return
        why.push(`${reason}: ${next}`)
        size = next
        r = shape(event, next)
      }

      // 2. Nobody watching.
      if (size !== 'none' && !state.user.present) {
        if (event.type === 'failure' || event.type === 'attention') { missed.push(event); why.push('nobody watching: kept for their return') }
        else why.push('nobody watching')
        resize('none', 'nobody watching')
        size = 'none'
      }
      // 3. Asleep.
      let wake = false
      if (size !== 'none' && state.self.asleep) {
        if (event.type === 'failure' || event.type === 'attention' || importance === 'major' || event.type === 'interact') {
          wake = true
          why.push('wakes him')
        } else resize('none', 'asleep')
      }
      // 4. In a conversation.
      if (state.self.talking && SIZES.indexOf(size) > SIZES.indexOf('glance')) resize('glance', 'talking with the visitor')
      // 5. Repeats.
      const key = (e: { type: OttoEventType; topic?: string }) => `${e.type}:${e.topic ?? ''}`
      const repeats = recent.filter(e => key(e) === key(event) && now - e.at < settings.repeatWindowMs).length
      if (size !== 'none' && repeats >= 2) resize('none', `repeat x${repeats + 1}`)
      else if (size !== 'none' && repeats === 1) resize(smaller(size), 'repeat')
      // 6. Cooldowns: shrink until one fits.
      while (size !== 'none' && now - last[size as Exclude<ReactionSize, 'none'>] < cooldown(size as Exclude<ReactionSize, 'none'>)) {
        resize(smaller(size), `${size} cooldown`)
      }
      // 7. The gesture budget.
      gestureTimes = gestureTimes.filter(t => now - t < 60_000)
      if ((size === 'gesture' || size === 'big') && gestureTimes.length >= settings.gesturesPerMinute) resize('glance', 'enough gestures this minute')

      const out: Reaction = { ...r, size, why }
      if (size === 'none') { delete out.face; delete out.gesture; delete out.look; delete out.walk; delete out.say; delete out.turn }
      if (out.walk && !(settings.walkToEvents && state.self.mayMove)) { delete out.walk; why.push('stays put') }
      if (state.self.talking) delete out.face // the voice owns the face
      if (wake && size !== 'none') out.wake = true
      if (!out.say && event.message && size !== 'none' && (event.type === 'failure' || event.type === 'attention')) out.say = event.message

      if (size !== 'none') {
        for (const s of ['glance', 'gesture', 'big'] as const) if (SIZES.indexOf(s) <= SIZES.indexOf(size)) last[s] = now
        if (out.gesture) gestureTimes.push(now)
      }
      recent = [...recent, { type: event.type, topic: event.topic, at: now, size }].slice(-12)
      return out
    },

    activeTask(now) {
      let oldest: TaskInfo | null = null
      for (const t of tasks.values()) {
        if (now - t.since > TASK_STALE_MS) continue
        if (!oldest || t.since < oldest.since) oldest = t
      }
      if (!oldest || now - oldest.since < settings.taskNoticeMs) return null
      return { ...oldest, ms: now - oldest.since }
    },

    takeMissed() { const m = missed; missed = []; return m },
    setSettings(next) { settings = next },
  }
  return reactor
}

function stripUndefined<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T
}
