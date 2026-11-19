// Otto lab (npm run dev, then http://localhost:5173/lab.html): every face, pose and gesture, a fake voice for the mouth, and a
// simulated voice session that drives the gestures through the same lifecycle rules as the app (useGestureTriggers), with no server.
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expressionFor, poseFor } from './otto/OttoDock'
import { createGestureChannel, GESTURE_NAMES, type GestureEvent } from './otto/robot/gestures'
import OttoRobot from './otto/robot/OttoRobot'
import { FACES, type RobotExpression, type RobotPose } from './otto/robot/robot'
import { useGestureTriggers } from './otto/useGestureTriggers'
import type { AssistantStatus } from './otto/useVoiceAssistant'
import './otto/voice.css'
import './app.css'

const POSES: RobotPose[] = ['idle', 'listening', 'thinking', 'talking']
const STATUSES: AssistantStatus[] = ['idle', 'connecting', 'listening', 'speaking', 'ended', 'error']
const LINE = 'Hi, I am Otto. Ask me anything about this app.'
/** A short conversation: connect, a reply, listening again, then hang up. Seconds from the start. */
const SCRIPT: [number, AssistantStatus][] = [[0, 'connecting'], [1, 'listening'], [3.5, 'speaking'], [6, 'listening'], [8.5, 'idle']]

function Lab() {
  const [pose, setPose] = useState<RobotPose>('idle')
  const [expression, setExpression] = useState<RobotExpression>('happy')
  const [say, setSay] = useState('')
  // A simulated voice session: while set, the robot follows the status the way the dock does.
  const [session, setSession] = useState<AssistantStatus | null>(null)
  const [log, setLog] = useState<string[]>([])
  const channel = useMemo(createGestureChannel, [])
  const timers = useRef<number[]>([])

  useGestureTriggers(session ?? 'idle', channel)
  useEffect(() => channel.onEvent((event: GestureEvent) => {
    const what = event.type === 'start' ? `${event.name} started${event.held ? ' (held)' : ''}` : `${event.name} ended: ${event.reason}`
    setLog(lines => [`${new Date().toLocaleTimeString()} ${what}`, ...lines].slice(0, 8))
  }), [channel])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const clearScript = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const manual = () => { clearScript(); setSession(null) }
  const runConversation = () => {
    clearScript()
    timers.current = SCRIPT.map(([at, status]) => window.setTimeout(() => setSession(status), at * 1000))
  }

  // A made-up voice: syllables a few times a second, louder in the low bands.
  const fakeBands = useCallback((count: number) => {
    const t = performance.now() / 1000
    const syllable = Math.max(0, Math.sin(t * 11) * Math.sin(t * 3.1 + 1))
    return Array.from({ length: count }, (_, i) => Math.min(1, syllable * (1 - i / (count + 1)) * (0.7 + 0.3 * Math.sin(t * 17 + i))))
  }, [])

  const shownPose = session ? poseFor(session) : pose
  const shownExpression = session ? expressionFor(session) : expression
  const shownSay = session ? (session === 'speaking' ? LINE : '') : say

  return <main className="app-main" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 420px', gap: '1rem', maxInlineSize: '64rem' }}>
    <div>
      <h1>Otto lab</h1>
      <fieldset><legend>Pose</legend>{POSES.map(item =>
        <button key={item} type="button" className="otto-btn otto-btn--tonal" aria-pressed={!session && pose === item} onClick={() => {
          manual()
          setPose(item)
          setSay(item === 'talking' ? LINE : '')
          if (item === 'talking') setExpression('excited')
        }}>{item}</button>)}</fieldset>
      <fieldset><legend>Face</legend>{(Object.keys(FACES) as RobotExpression[]).map(item =>
        <button key={item} type="button" className="otto-btn otto-btn--tonal" aria-pressed={!session && expression === item}
          onClick={() => { manual(); setExpression(item) }}>{item}</button>)}</fieldset>
      {/* Pose "thinking" holds thinkingHand by itself (GESTURE_SETTINGS.whileThinking); the buttons here play one-shots. */}
      <fieldset><legend>Gesture</legend>{GESTURE_NAMES.map(name =>
        <button key={name} type="button" className="otto-btn otto-btn--tonal" onClick={() => channel.play(name, { force: true })}>{name}</button>)}
        <button type="button" className="otto-btn otto-btn--tonal" onClick={() => channel.stop()}>Stop gestures</button></fieldset>
      <fieldset><legend>Voice session (simulated)</legend>
        <p className="lab-hint">The robot follows the status as in the app, and the lifecycle gestures (GESTURE_SETTINGS) play on the way.</p>
        {STATUSES.map(status =>
          <button key={status} type="button" className="otto-btn otto-btn--tonal" aria-pressed={session === status} aria-label={`Session: ${status}`}
            onClick={() => { clearScript(); setSession(status) }}>{status}</button>)}
        <button type="button" className="otto-btn otto-btn--filled" onClick={runConversation}>Run a conversation</button>
      </fieldset>
      <section aria-labelledby="lab-events">
        <h2 id="lab-events">Gesture events</h2>
        <ol role="log" aria-live="polite" className="lab-log">{log.map((line, i) => <li key={log.length - i}>{line}</li>)}</ol>
      </section>
    </div>
    <div style={{ blockSize: 460 }}>
      <OttoRobot pose={shownPose} expression={shownExpression} say={shownSay} speechBands={fakeBands} gestures={channel} />
    </div>
  </main>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>)
