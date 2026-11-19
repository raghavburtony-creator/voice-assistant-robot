// Otto's robot, for the dock or anywhere else. It is only a picture: hidden from screen readers and the Tab order, because the
// dock's button and the voice panel say the same in words. The robot (ClayScene, the Clay Robot) loads on its own after the page, and where
// WebGL 2 is missing or the scene fails, nothing is drawn and the rest of Otto still works.

import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import type { MouthSource } from '../mouth'
import type { GestureChannel } from './gestures'
import { hasWebGL, SPEAK_CPS, type RobotExpression, type RobotPose } from './robot'

const ClayScene = lazy(() => import('./ClayScene'))

type Props = {
  pose: RobotPose
  expression: RobotExpression
  /** The line Otto is saying now, growing as it speaks. Empty when quiet. Shown in a speech bubble. */
  say?: string
  /** Otto's mouth: five bars, 0 to 1, or null when quiet (useVoiceAssistant's mouth; mouth.ts). */
  mouth?: MouthSource
  /** Gesture requests for this robot (see createGestureChannel). */
  gestures?: GestureChannel
  onActivate?: () => void
  className?: string
}

class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

/** Types `text` a character at a time at about the voice's pace, carrying on when the text grows. */
function useTyped(text: string): string {
  const [shown, setShown] = useState('')
  const target = useRef(text)
  target.current = text
  useEffect(() => {
    if (!text) { setShown(''); return }
    setShown(current => (text.startsWith(current) ? current : ''))
    const timer = window.setInterval(() => {
      setShown(current => {
        const goal = target.current
        if (!goal.startsWith(current)) return ''
        if (current.length >= goal.length) return current
        return goal.slice(0, current.length + 1)
      })
    }, 1000 / SPEAK_CPS)
    return () => window.clearInterval(timer)
  }, [text])
  return shown
}

export default function OttoRobot({ pose, expression, say = '', mouth, gestures, onActivate, className }: Props) {
  const [canDraw] = useState(hasWebGL)
  const typed = useTyped(say)
  // Only the end of a long line fits: the panel has the whole of it.
  const bubble = typed.length > 140 ? `…${typed.slice(-140).replace(/^\S*\s/, '')}` : typed
  return (
    <div className={['otto-robot', className].filter(Boolean).join(' ')} aria-hidden="true">
      {bubble && <p className="otto-robot__bubble">{bubble}</p>}
      {canDraw && <Quiet>
        <Suspense fallback={null}>
          <ClayScene pose={pose} expression={expression} mouth={mouth} gestures={gestures} onActivate={onActivate} />
        </Suspense>
      </Quiet>}
    </div>
  )
}
