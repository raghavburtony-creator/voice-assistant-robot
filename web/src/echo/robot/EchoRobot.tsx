// The 3D robot that draws Echo. It is only a picture: hidden from screen readers and the Tab order, because the dock's button
// and the voice panel say the same in words. The robot's own chat, tips and greetings are off; your app's state drives it.
//   pose        -> a gesture       expression -> a face
//   say         -> the line in its speech bubble, typed as the voice says it
//   speechBands -> its chest bars follow Echo's real voice while it speaks

import { useEffect, useRef, useState } from 'react'
import { ASSISTANT_NAME } from '../../echo.config'
import type { RobotCompanionElement } from './robot-companion'
import { FACE_FOR, GESTURE_FOR, loadRobot, nextLine, ROBOT_LOGO, ROBOT_THREE, SPEAK_CPS, type RobotExpression, type RobotPose } from './robot'

type Props = {
  pose: RobotPose
  expression: RobotExpression
  /** The line Echo is saying now, growing as it speaks. Empty when quiet. */
  say?: string
  /** Echo's voice in bands, 0 to 1, or null when silent (useVoiceAssistant's speechBands). */
  speechBands?: (count: number) => number[] | null
  /** A click on the robot. */
  onActivate?: () => void
  className?: string
}

const CHEST_BARS = 6
/** About 30 reads a second. */
const CHEST_READ_MS = 34

const QUIET_CONFIG = { name: ASSISTANT_NAME, faq: [], tips: [], pages: {}, lines: [], pokes: [], invitations: [], featured: [] }

const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

export default function EchoRobot({ pose, expression, say = '', speechBands, onActivate, className }: Props) {
  const host = useRef<RobotCompanionElement>(null)
  const [ready, setReady] = useState(false)
  const activate = useRef(onActivate)
  const bands = useRef(speechBands)
  const speech = useRef({ said: '', latest: '', busy: false })

  useEffect(() => { activate.current = onActivate; bands.current = speechBands })

  useEffect(() => {
    let live = true
    void loadRobot().then(ok => { if (live && ok) setReady(true) })
    return () => { live = false }
  }, [])

  // Once defined: its own voice off, out of the Tab order, and a click comes to us.
  useEffect(() => {
    const el = host.current
    if (!ready || !el) return
    el.configure(QUIET_CONFIG)
    el.shadowRoot?.querySelectorAll('.hit, .dock').forEach(part => part.setAttribute('tabindex', '-1'))
    const onClick = (event: Event) => { event.preventDefault(); activate.current?.() }
    el.addEventListener('robot-click', onClick)
    return () => el.removeEventListener('robot-click', onClick)
  }, [ready])

  useEffect(() => { if (ready) host.current?.face(FACE_FOR[expression], Infinity) }, [ready, expression])

  useEffect(() => {
    const el = host.current
    if (!ready || !el) return
    const gesture = GESTURE_FOR[pose]
    if (gesture) void el.gesture(gesture)
    else el.stopGesture()
  }, [ready, pose])

  // The chest bars follow Echo's real voice while it talks (not under reduced motion, and not in a hidden tab).
  useEffect(() => {
    const el = host.current
    if (!ready || !el || pose !== 'talking' || reducedMotion()) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return
      el.setChestBands(bands.current?.(CHEST_BARS) ?? null)
    }, CHEST_READ_MS)
    return () => { window.clearInterval(timer); el.setChestBands(null) }
  }, [ready, pose])

  // The spoken line, a piece at a time: each new part is typed when the last is done, so the mouth moves while the voice talks.
  useEffect(() => {
    const el = host.current
    if (!ready || !el) return
    const state = speech.current
    state.latest = say
    if (!say) {
      if (state.said) el.hush()
      state.said = ''
      state.busy = false
      return
    }
    const pump = () => {
      if (state.busy) return
      const line = nextLine(state.said, state.latest)
      if (!line) return
      state.said = state.latest
      state.busy = true
      void el.say(line, { speed: SPEAK_CPS, hold: 4000 }).finally(() => { state.busy = false; pump() })
    }
    pump()
  }, [ready, say])

  return (
    <robot-companion
      ref={host}
      className={className}
      three={ROBOT_THREE}
      logo={ROBOT_LOGO}
      bubble="left"
      quiet
      aria-hidden="true"
    />
  )
}
