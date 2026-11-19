// Otto in the world: the robot on its stage (movement/stage.ts), walking where it is sent and keeping clear of obstacles,
// with its own life when nobody is doing anything (idle.ts): looking about now and then, dozing off, waking when the cursor
// comes over him, a click or a key. The dock (OttoDock) and the lab are built on it.
//
// Each system keeps to its own job: the stage decides where Otto is and how he walks, the gestures what his body does,
// the face his mood; this component only connects them.

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { GESTURE_SETTINGS, IDLE_SETTINGS, MOVEMENT_SETTINGS } from '../otto.config'
import type { SpeechClock } from './audio'
import { useIdleLifecycle, type IdleState, type IdleTimes } from './idle'
import type { MouthSource } from './mouth'
import type { StageController } from './movement/stage'
import { useStageHost, type Obstacle } from './movement/useStage'
import OttoRobot from './robot/OttoRobot'
import type { GestureChannel } from './robot/gestures'
import type { RobotExpression, RobotPose } from './robot/robot'

export type IdleControls = { wake: () => void; sleep: () => void; idleNow: () => void }

type Props = {
  stage: StageController
  pose: RobotPose
  expression: RobotExpression
  say?: string
  mouth?: MouthSource
  speech?: SpeechClock
  gestures: GestureChannel
  /** Held awake (a voice session, the panel open). */
  busy?: boolean
  /** Kept clear of, besides MOVEMENT_SETTINGS.avoid; looked for again when `obstaclesKey` changes. */
  obstacles?: readonly Obstacle[]
  obstaclesKey?: unknown
  /** The stage: null for the viewport. */
  container?: RefObject<HTMLElement | null> | null
  onActivate?: () => void
  className?: string
  /** Otto's own life when nobody is doing anything (IDLE_SETTINGS). */
  idle?: boolean
  idleTimes?: IdleTimes
  onIdleState?: (state: IdleState) => void
  /** Set to the idle lifecycle's controls (for the lab). */
  idleControls?: { current: IdleControls | null }
  children?: ReactNode
}

export default function OttoStage({
  stage, pose, expression, say, mouth, speech, gestures, busy = false, obstacles, obstaclesKey, container,
  onActivate, className, idle = true, idleTimes = IDLE_SETTINGS, onIdleState, idleControls, children,
}: Props) {
  const element = useRef<HTMLDivElement>(null)
  useStageHost(stage, element, { obstacles, obstaclesKey, container })

  // Walking counts as something happening.
  const [walking, setWalking] = useState(false)
  useEffect(() => stage.onEvent(event => {
    if (event.type === 'depart') setWalking(true)
    else if (event.type === 'arrive' || event.type === 'cancel') setWalking(false)
  }), [stage])

  // Idle behaviours take turns (GESTURE_SETTINGS.idle); with MOVEMENT_SETTINGS.roam, now and then a stroll near home.
  const turn = useRef(0)
  const strolled = useRef(false)
  const life = useIdleLifecycle({
    busy: busy || walking, robot: element, enabled: idle, times: idleTimes,
    onLook: () => {
      if (MOVEMENT_SETTINGS.roam && !strolled.current && Math.random() < 0.35) {
        strolled.current = true
        const home = MOVEMENT_SETTINGS.home
        void stage.moveToX(home + (home > 0.5 ? -1 : 1) * (0.06 + Math.random() * 0.12))
        return
      }
      if (strolled.current) { strolled.current = false; void stage.goHome(); return }
      const list = GESTURE_SETTINGS.idle
      if (list.length) gestures.play(list[turn.current++ % list.length])
    },
  })
  const asleep = life.state === 'asleep' && pose === 'idle'
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
  // Dozing off stops any idle gesture still playing.
  useEffect(() => { if (asleep) gestures.stop() }, [asleep, gestures])

  // A click elsewhere on the page: Otto turns toward it for a moment (his head already follows the cursor).
  useEffect(() => {
    if (!MOVEMENT_SETTINGS.noticeClicks) return
    const onDown = (event: PointerEvent) => {
      if (element.current?.contains(event.target as Node)) return
      if (stage.frame.phase !== 'idle') return
      stage.turnToward(event.clientX, 1.2)
    }
    window.addEventListener('pointerdown', onDown, { passive: true })
    return () => window.removeEventListener('pointerdown', onDown)
  }, [stage])

  return (
    <div ref={element} className={['otto-stage', className].filter(Boolean).join(' ')} data-idle={life.state}>
      <OttoRobot className="otto-stage__robot" pose={pose} expression={asleep ? 'resting' : expression}
        say={say} mouth={mouth} speech={speech} gestures={gestures} locomotion={stage.frame} asleep={asleep}
        onActivate={onActivate} />
      {children}
    </div>
  )
}
