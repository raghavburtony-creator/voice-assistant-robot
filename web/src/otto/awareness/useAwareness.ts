// Carries out Otto's reactions (reactions.ts) through his own systems: the face (a passing mood), gestures, the stage
// (looking, turning, walking there and back) and words (the bubble, and a live region for screen readers). It also notices
// a few things by itself: the visitor leaving the tab and coming back, coming over Otto, clicking him; and shows a long
// task on his face while it runs (searching, then thinking hard).

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useOttoConfig } from '../config'
import type { IdleState } from '../idle'
import type { StageController } from '../movement/stage'
import type { GestureChannel } from '../robot/gestures'
import type { RobotExpression } from '../robot/robot'
import type { OttoEvent, OttoEvents } from './events'
import { createReactor, type Awareness, type Reaction } from './reactions'

export type ReactionListener = (event: OttoEvent, reaction: Reaction) => void

type Options = {
  events?: OttoEvents
  stage: StageController
  gestures: GestureChannel
  robot: RefObject<HTMLElement | null>
  idle: { state: IdleState; wake: () => void; idleNow: () => void }
  /** In a voice conversation: the voice owns the face and body, so reactions stay small. */
  talking: boolean
  /** He may walk now (nothing like an open panel holding him in place). */
  mayMove: boolean
  onReaction?: ReactionListener
}

export type AwarenessOutput = {
  /** A passing mood, or the look of a task running; null to leave the face to its owner. */
  face: RobotExpression | null
  /** A long task: think hard (the thinking pose). */
  thinking: boolean
  /** Words for the bubble (big reactions only). */
  bubble: string
  /** Words for screen readers. */
  announce: string
  /** What Otto knows right now (for the lab). */
  awareness: () => Awareness
}

export function useAwareness({ events, stage, gestures, robot, idle, talking, mayMove, onReaction }: Options): AwarenessOutput {
  const settings = useOttoConfig().awareness
  const reactor = useMemo(() => createReactor(settings), []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reactor.setSettings(settings) }, [reactor, settings])

  const [mood, setMood] = useState<RobotExpression | null>(null)
  const [taskLook, setTaskLook] = useState<{ face: RobotExpression | null; thinking: boolean }>({ face: null, thinking: false })
  const [bubble, setBubble] = useState('')
  const [announce, setAnnounce] = useState('')

  const live = useRef({ idle, talking, mayMove, onReaction, settings })
  useEffect(() => { live.current = { idle, talking, mayMove, onReaction, settings } })

  const timers = useRef(new Set<number>())
  const later = useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => { timers.current.delete(id); fn() }, ms)
    timers.current.add(id)
    return id
  }, [])
  useEffect(() => () => { timers.current.forEach(id => window.clearTimeout(id)); timers.current.clear() }, [])

  const state = useCallback((): Pick<Awareness, 'self' | 'user'> => {
    const l = live.current
    return {
      self: { asleep: l.idle.state === 'asleep', talking: l.talking, walking: stage.frame.phase !== 'idle', mayMove: l.mayMove },
      user: { present: typeof document === 'undefined' || document.visibilityState !== 'hidden', idle: l.idle.state !== 'awake' },
    }
  }, [stage])

  // The reaction, through the systems. Tokens keep a later reaction from being undone by an earlier one's timers.
  const moodToken = useRef(0)
  const walkToken = useRef(0)
  const carryOut = useCallback((event: OttoEvent, r: Reaction) => {
    live.current.onReaction?.(event, r)
    if (r.size === 'none') return
    if (r.wake) live.current.idle.wake()
    if (r.face) {
      const token = ++moodToken.current
      setMood(r.face)
      later(() => { if (moodToken.current === token) setMood(null) }, r.faceMs ?? 1500)
    }
    if (r.say) {
      setAnnounce(r.say)
      if (r.size === 'big') { setBubble(r.say); later(() => setBubble(''), 3500) }
    }
    const look = () => {
      if (r.look === 'user') stage.lookAt(null)
      else if (r.look !== undefined) {
        stage.lookAt(r.look, (r.lookMs ?? 1200) / 1000)
        if (r.turn) stage.turnToward(r.look, Math.min(2, (r.lookMs ?? 1200) / 1000))
      }
    }
    const gesture = () => { if (r.gesture) gestures.play(r.gesture, { intensity: r.gestureIntensity }) }
    if (!r.walk) { look(); gesture(); return }
    // Walk there, then look and gesture on arrival; back home a little later, unless something else moved him since.
    const token = ++walkToken.current
    void stage.moveToElement(r.walk).then(arrived => {
      if (walkToken.current !== token) return
      look(); gesture()
      if (!arrived) return
      const there = stage.goal
      later(() => {
        if (walkToken.current === token && stage.goal === there && stage.frame.phase === 'idle') void stage.goHome()
      }, live.current.settings.returnAfterMs)
    })
  }, [stage, gestures, later])

  // Tasks: shown on his face only once they have run a while; nothing at all for a quick one.
  const taskTimer = useRef<number | undefined>(undefined)
  const watchTasks = useCallback(() => {
    window.clearInterval(taskTimer.current)
    let looked: string | null = null
    const check = () => {
      const t = reactor.activeTask(performance.now())
      const any = reactor.awareness(state(), performance.now()).app.tasks.length > 0
      if (!any) { window.clearInterval(taskTimer.current); taskTimer.current = undefined; setTaskLook({ face: null, thinking: false }); return }
      if (!t) return
      if (looked !== t.id && t.where !== undefined && !live.current.talking) { looked = t.id; stage.lookAt(t.where, 1.5) }
      const thinking = t.ms >= live.current.settings.thinkingAfterMs
      setTaskLook(was => (was.face === 'searching' && was.thinking === thinking ? was : { face: 'searching', thinking }))
    }
    taskTimer.current = window.setInterval(check, 200)
  }, [reactor, state, stage])
  useEffect(() => () => window.clearInterval(taskTimer.current), [])

  const handle = useCallback((event: OttoEvent) => {
    const now = performance.now()
    if (event.type === 'idle') live.current.idle.idleNow()
    const reaction = reactor.decide(event, state(), now)
    carryOut(event, reaction)
    if (event.type === 'task') watchTasks()
    // Back after missing something: the latest thing that went wrong or needed them, once.
    if (event.type === 'arrive') {
      const missed = reactor.takeMissed()
      const last = missed[missed.length - 1]
      if (last) later(() => carryOut(last, reactor.decide({ ...last, importance: 'normal' }, state(), performance.now())), 1600)
    }
  }, [reactor, state, carryOut, watchTasks, later])

  useEffect(() => events?.subscribe(handle), [events, handle])

  // What Otto notices by himself.
  useEffect(() => {
    if (!settings.enabled || !settings.noticePresence || typeof document === 'undefined') return
    let leftAt = 0
    const onVisibility = () => {
      const now = performance.now()
      if (document.visibilityState === 'hidden') { leftAt = now; handle({ type: 'leave' }); return }
      const away = leftAt ? now - leftAt : 0
      leftAt = 0
      if (away >= settings.awayMs) handle({ type: 'arrive', importance: away >= settings.awayMs * 10 ? 'major' : 'normal' })
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [settings.enabled, settings.noticePresence, settings.awayMs, handle])

  useEffect(() => {
    const el = robot.current
    if (!el || !settings.enabled) return
    let dwell: number | undefined
    const onEnter = () => { window.clearTimeout(dwell); dwell = window.setTimeout(() => handle({ type: 'interact', topic: 'hover' }), 600) }
    const onLeave = () => window.clearTimeout(dwell)
    const onDown = () => { window.clearTimeout(dwell); handle({ type: 'interact', importance: 'normal', topic: 'click' }) }
    el.addEventListener('pointerenter', onEnter)
    el.addEventListener('pointerleave', onLeave)
    el.addEventListener('pointerdown', onDown)
    return () => {
      window.clearTimeout(dwell)
      el.removeEventListener('pointerenter', onEnter)
      el.removeEventListener('pointerleave', onLeave)
      el.removeEventListener('pointerdown', onDown)
    }
  }, [robot, settings.enabled, handle])

  const awareness = useCallback(() => reactor.awareness(state(), performance.now()), [reactor, state])
  return { face: mood ?? taskLook.face, thinking: taskLook.thinking, bubble, announce, awareness }
}
