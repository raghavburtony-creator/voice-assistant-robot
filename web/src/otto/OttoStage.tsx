// Otto in the world: the robot on its stage (movement/stage.ts), walking where it is sent and keeping clear of obstacles;
// his own life when nobody is doing anything (idle.ts); and his awareness of the app (awareness/): events come in, he
// decides whether and how to react, and reacts through his face, gestures, movement and words.
//
// Each system keeps to its own job: the stage decides where Otto is and how he walks, the gestures what his body does,
// the face his mood, the reactor what is worth reacting to; this component only connects them. The dock (OttoDock), the
// lab and the <otto-mascot> element are built on it.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { SpeechClock } from './audio'
import type { OttoEvents } from './awareness/events'
import type { Awareness } from './awareness/reactions'
import { useAwareness, type ReactionListener } from './awareness/useAwareness'
import { useOttoConfig } from './useOttoConfig'
import type { IdleState, IdleTimes } from './idle'
import { useIdleLifecycle } from './useIdleLifecycle'
import type { MouthSource } from './mouth'
import type { StageController } from './movement/stage'
import { useStageHost, type Obstacle } from './movement/useStage'
import OttoRobot from './robot/OttoRobot'
import type { GestureChannel } from './robot/gestures'
import { useReducedMotion } from './robot/environment'
import type { RobotExpression, RobotPose } from './robot/robot'

export type IdleControls = { wake: () => void; sleep: () => void; idleNow: () => void }

type Props = {
  stage: StageController
  pose: RobotPose
  /** The face its owner wants (a voice session's, a host's); passing moods from events show over it for a moment. */
  expression: RobotExpression
  say?: string
  mouth?: MouthSource
  speech?: SpeechClock
  gestures: GestureChannel
  /** What happens in the app, for Otto to react to. */
  events?: OttoEvents
  /** Held awake, and kept in place (a voice session, the panel open). */
  busy?: boolean
  /** In a voice conversation: reactions to events stay small and leave the face alone. */
  conversing?: boolean
  /** Kept clear of, besides the config's movement.avoid; looked for again when `obstaclesKey` changes. */
  obstacles?: readonly Obstacle[]
  obstaclesKey?: unknown
  /** The stage: null for the viewport. */
  container?: RefObject<HTMLElement | null> | null
  onActivate?: () => void
  /** The robot could not be drawn (no WebGL 2, or it failed). */
  onRobotError?: (reason: 'no-webgl' | 'failed') => void
  className?: string
  /** Otto's own life when nobody is doing anything. */
  idle?: boolean
  idleTimes?: IdleTimes
  onIdleState?: (state: IdleState) => void
  /** Set to the idle lifecycle's controls (for the lab). */
  idleControls?: { current: IdleControls | null }
  /** Every decision on an event, with why (for the lab). */
  onReaction?: ReactionListener
  /** Set to a reader of what Otto knows now (for the lab). */
  awarenessRef?: { current: (() => Awareness) | null }
  children?: ReactNode
}

export default function OttoStage({
  stage, pose, expression, say, mouth, speech, gestures, events, busy = false, conversing = false, obstacles, obstaclesKey,
  container, onActivate, onRobotError, className, idle = true, idleTimes, onIdleState, idleControls, onReaction, awarenessRef, children,
}: Props) {
  const config = useOttoConfig()
  const reduced = useReducedMotion()
  const element = useRef<HTMLDivElement>(null)
  useStageHost(stage, element, { obstacles, obstaclesKey, container })
  // A new config (a theme) changes how he walks without a new stage.
  useEffect(() => { stage.setSpeed(config.movement.moveSpeed) }, [stage, config.movement.moveSpeed])
  useEffect(() => { stage.setEnabled(config.movement.movementEnabled) }, [stage, config.movement.movementEnabled])

  // Walking counts as something happening.
  const [walking, setWalking] = useState(false)
  useEffect(() => stage.onEvent(event => {
    if (event.type === 'depart') setWalking(true)
    else if (event.type === 'arrive' || event.type === 'cancel') setWalking(false)
  }), [stage])

  // Idle behaviours take turns (config gestures.idle); with movement.roam, now and then a stroll near home.
  const turn = useRef(0)
  const strolled = useRef(false)
  const life = useIdleLifecycle({
    busy: busy || walking, robot: element, enabled: idle, times: idleTimes,
    onLook: () => {
      const m = config.movement
      if (m.roam && !strolled.current && Math.random() < 0.35) {
        strolled.current = true
        void stage.moveToX(m.home + (m.home > 0.5 ? -1 : 1) * (0.06 + Math.random() * 0.12))
        return
      }
      if (strolled.current) { strolled.current = false; void stage.goHome(); return }
      const list = config.gestures.idle
      if (list.length) gestures.play(list[turn.current++ % list.length])
    },
  })
  useEffect(() => { onIdleState?.(life.state) }, [life.state, onIdleState])
  useEffect(() => {
    if (!idleControls) return
    idleControls.current = { wake: life.wake, sleep: life.sleep, idleNow: life.idleNow }
    return () => { idleControls.current = null }
  }, [idleControls, life.wake, life.sleep, life.idleNow])
  // A stroll is undone as soon as anything happens.
  useEffect(() => {
    if (life.state === 'awake' && strolled.current) { strolled.current = false; void stage.goHome() }
  }, [life.state, stage])

  const aware = useAwareness({
    events, stage, gestures, robot: element, idle: life, talking: conversing,
    mayMove: !busy && !reduced && config.movement.movementEnabled, onReaction,
  })
  useEffect(() => {
    if (!awarenessRef) return
    awarenessRef.current = aware.awareness
    return () => { awarenessRef.current = null }
  }, [awarenessRef, aware.awareness])

  const asleep = life.state === 'asleep' && pose === 'idle'
  // Dozing off stops any idle gesture still playing.
  useEffect(() => { if (asleep) gestures.stop() }, [asleep, gestures])

  // A click elsewhere on the page: Otto turns toward it for a moment (his head already follows the cursor).
  useEffect(() => {
    if (!config.movement.noticeClicks) return
    const onDown = (event: PointerEvent) => {
      if (element.current?.contains(event.target as Node)) return
      if (stage.frame.phase !== 'idle') return
      stage.turnToward(event.clientX, 1.2)
    }
    window.addEventListener('pointerdown', onDown, { passive: true })
    return () => window.removeEventListener('pointerdown', onDown)
  }, [stage, config.movement.noticeClicks])

  // The face: asleep, resting; in a conversation, the voice's; otherwise a passing mood or a task's look over the owner's.
  const face = asleep ? 'resting' : conversing ? expression : aware.face ?? expression
  // A long task: think hard, if nothing else has a pose for him.
  const shownPose = pose === 'idle' && aware.thinking && !conversing ? 'thinking' : pose

  return (
    <div ref={element} className={['otto-stage', className].filter(Boolean).join(' ')} data-idle={life.state}>
      <OttoRobot className="otto-stage__robot" pose={shownPose} expression={face}
        say={say || aware.bubble} mouth={mouth} speech={say ? speech : undefined} gestures={gestures} locomotion={stage.frame}
        asleep={asleep} onActivate={onActivate} onError={onRobotError} />
      {/* The robot is a picture; what Otto has to say about events is said here, for screen readers. */}
      <p className="otto-sr" role="status" aria-live="polite">{aware.announce}</p>
      {children}
    </div>
  )
}
