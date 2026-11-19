// Otto lab (npm run dev, then http://localhost:5173/lab.html): every face, pose and gesture, and a fake voice for the mouth, with no server.
import { StrictMode, useCallback, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createGestureChannel, GESTURE_NAMES } from './otto/robot/gestures'
import OttoRobot from './otto/robot/OttoRobot'
import { FACES, type RobotExpression, type RobotPose } from './otto/robot/robot'
import './otto/voice.css'
import './app.css'

const POSES: RobotPose[] = ['idle', 'listening', 'thinking', 'talking']

function Lab() {
  const [pose, setPose] = useState<RobotPose>('idle')
  const [expression, setExpression] = useState<RobotExpression>('happy')
  const [say, setSay] = useState('')
  const channel = useMemo(createGestureChannel, [])
  // A made-up voice: syllables a few times a second, louder in the low bands.
  const fakeBands = useCallback((count: number) => {
    const t = performance.now() / 1000
    const syllable = Math.max(0, Math.sin(t * 11) * Math.sin(t * 3.1 + 1))
    return Array.from({ length: count }, (_, i) => Math.min(1, syllable * (1 - i / (count + 1)) * (0.7 + 0.3 * Math.sin(t * 17 + i))))
  }, [])
  return <main className="app-main" style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) 420px', gap: '1rem', maxInlineSize: '64rem' }}>
    <div>
      <h1>Otto lab</h1>
      <fieldset><legend>Pose</legend>{POSES.map(item =>
        <button key={item} type="button" className="otto-btn otto-btn--tonal" aria-pressed={pose === item} onClick={() => {
          setPose(item)
          setSay(item === 'talking' ? 'Hi, I am Otto. Ask me anything about this app.' : '')
          if (item === 'talking') setExpression('excited')
        }}>{item}</button>)}</fieldset>
      <fieldset><legend>Face</legend>{(Object.keys(FACES) as RobotExpression[]).map(item =>
        <button key={item} type="button" className="otto-btn otto-btn--tonal" aria-pressed={expression === item} onClick={() => setExpression(item)}>{item}</button>)}</fieldset>
      {/* Pose "thinking" holds thinkingHand by itself (GESTURE_SETTINGS.whileThinking); the buttons here play one-shots. */}
      <fieldset><legend>Gesture</legend>{GESTURE_NAMES.map(name =>
        <button key={name} type="button" className="otto-btn otto-btn--tonal" onClick={() => channel.play(name, { force: true })}>{name}</button>)}
        <button type="button" className="otto-btn otto-btn--tonal" onClick={() => channel.stop()}>Stop gestures</button></fieldset>
    </div>
    <div style={{ blockSize: 460 }}>
      <OttoRobot pose={pose} expression={expression} say={say} speechBands={fakeBands} gestures={channel} />
    </div>
  </main>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>)
