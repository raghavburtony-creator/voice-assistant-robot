// Otto's robot, for the dock or anywhere else. It is only a picture: hidden from screen readers and the Tab order, because the
// dock's button and the voice panel say the same in words. The robot (ClayScene, the Clay Robot) loads on its own after the page, and where
// WebGL 2 is missing or the scene fails, nothing is drawn and the rest of Otto still works.

import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import type { SpeechClock } from '../audio'
import type { MouthSource } from '../mouth'
import type { StageFrame } from '../movement/stage'
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
  /**
   * How far Otto's speech has played (useVoiceAssistant's `speech`). With it the bubble keeps pace with the audio itself
   * and stops where the audio stops; without it, it types at about the voice's pace (SPEAK_CPS).
   */
  speech?: SpeechClock
  /** The stage's frame (movement/stage.ts), while the robot walks. */
  locomotion?: StageFrame
  /** Dozing (idle.ts). */
  asleep?: boolean
  onActivate?: () => void
  className?: string
}

class Quiet extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

/** No voice says more than this many characters a second: a transcript that runs ahead of its audio is held back to it. */
const MAX_CPS = 24

/** How many characters of `text` have been said, `p` of the way through the audio received (never backwards). */
export function spokenLength(text: string, p: { played: number; received: number } | null, shownBefore: number): number {
  if (!p || p.received <= 0) return Math.min(shownBefore, text.length)
  const share = Math.min(1, Math.max(0, p.played / p.received))
  const said = Math.min(text.length * share, p.played * MAX_CPS)
  return Math.min(text.length, Math.max(shownBefore, Math.round(said)))
}

/**
 * Shows `text` as it is said, carrying on when the text grows. With a clock, by how much of the audio has played (the
 * transcript and its audio arrive together, so the share of audio played is about the share of words said); without,
 * a character at a time at SPEAK_CPS. Polls the clock about 20 times a second and re-renders only on a change.
 */
function useTyped(text: string, clock?: SpeechClock): string {
  const [shown, setShown] = useState('')
  const target = useRef(text)
  const clockRef = useRef(clock)
  target.current = text
  clockRef.current = clock
  useEffect(() => {
    if (!text) { setShown(''); return }
    setShown(current => (text.startsWith(current) ? current : ''))
    const timer = window.setInterval(() => {
      setShown(current => {
        const goal = target.current
        if (!goal.startsWith(current)) return ''
        const read = clockRef.current
        if (read) {
          const n = spokenLength(goal, read(), current.length)
          return n === current.length ? current : goal.slice(0, n)
        }
        if (current.length >= goal.length) return current
        return goal.slice(0, current.length + 1)
      })
    }, clock ? 50 : 1000 / SPEAK_CPS)
    return () => window.clearInterval(timer)
  }, [text, !clock]) // eslint-disable-line react-hooks/exhaustive-deps
  return shown
}

export default function OttoRobot({ pose, expression, say = '', mouth, gestures, speech, locomotion, asleep, onActivate, className }: Props) {
  const [canDraw] = useState(hasWebGL)
  const typed = useTyped(say, speech)
  // Only the end of a long line fits: the panel has the whole of it.
  const bubble = typed.length > 140 ? `…${typed.slice(-140).replace(/^\S*\s/, '')}` : typed
  return (
    <div className={['otto-robot', className].filter(Boolean).join(' ')} aria-hidden="true">
      {bubble && <p className="otto-robot__bubble">{bubble}</p>}
      {canDraw && <Quiet>
        <Suspense fallback={null}>
          <ClayScene pose={pose} expression={expression} mouth={mouth} gestures={gestures} onActivate={onActivate}
            locomotion={locomotion} asleep={asleep} />
        </Suspense>
      </Quiet>}
    </div>
  )
}
