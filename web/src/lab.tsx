// Otto lab (npm run dev, then http://localhost:5173/lab.html), with no server:
//   every face, pose and gesture; the mouth from a fake voice or any audio file, through the same speech-band analyzer as
//   the live voice, with a meter of the five bars; each sound cue; and a simulated voice session that drives the gestures
//   (and their chirps) through the same lifecycle rules as the app.
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SOUND_SETTINGS } from './otto.config'
import { analyserMouth, fakeMouth, MOUTH_BANDS, type MouthSource } from './otto/mouth'
import { expressionFor, poseFor } from './otto/OttoDock'
import { createGestureChannel, GESTURE_NAMES, type GestureEvent } from './otto/robot/gestures'
import OttoRobot from './otto/robot/OttoRobot'
import { FACES, type RobotExpression, type RobotPose } from './otto/robot/robot'
import { SOUND_CUES } from './otto/sound'
import { useGestureSounds } from './otto/useGestureSounds'
import { useGestureTriggers } from './otto/useGestureTriggers'
import type { AssistantStatus } from './otto/useVoiceAssistant'
import './otto/voice.css'
import './app.css'

const POSES: RobotPose[] = ['idle', 'listening', 'thinking', 'talking']
const STATUSES: AssistantStatus[] = ['idle', 'connecting', 'listening', 'speaking', 'ended', 'error']
const LINE = 'Hi, I am Otto. Ask me anything about this app.'
/** A short conversation: connect, a reply, listening again, then hang up. Seconds from the start. */
const SCRIPT: [number, AssistantStatus][] = [[0, 'connecting'], [1, 'listening'], [3.5, 'speaking'], [6, 'listening'], [8.5, 'idle']]
const kHz = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : `${hz}`)

/** An audio file played through an AnalyserNode, so the mouth reads it exactly as it reads the live voice. */
function useFileVoice(onEnd: () => void) {
  const current = useRef<{ context: AudioContext; source: AudioBufferSourceNode } | null>(null)
  const stop = useCallback(() => {
    const was = current.current
    current.current = null
    if (!was) return
    was.source.onended = null
    try { was.source.stop() } catch { /* not started */ }
    void was.context.close().catch(() => {})
  }, [])
  useEffect(() => stop, [stop])
  const play = useCallback(async (file: File): Promise<MouthSource | null> => {
    stop()
    const context = new AudioContext()
    try {
      const buffer = await context.decodeAudioData(await file.arrayBuffer())
      const source = context.createBufferSource()
      const analyser = context.createAnalyser()
      source.buffer = buffer
      source.connect(analyser)
      analyser.connect(context.destination)
      let playing = true
      source.onended = () => { playing = false; stop(); onEnd() }
      current.current = { context, source }
      source.start()
      return analyserMouth(analyser, () => playing)
    } catch {
      void context.close().catch(() => {})
      return null
    }
  }, [stop, onEnd])
  return { play, stop }
}

function Lab() {
  const [pose, setPose] = useState<RobotPose>('idle')
  const [expression, setExpression] = useState<RobotExpression>('happy')
  const [say, setSay] = useState('')
  // A simulated voice session: while set, the robot follows the status the way the dock does.
  const [session, setSession] = useState<AssistantStatus | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [voice, setVoice] = useState<'fake' | 'file' | null>(null)
  const [fileStatus, setFileStatus] = useState('')
  const [soundOn, setSoundOn] = useState<boolean>(SOUND_SETTINGS.soundEnabled)
  const [volume, setVolume] = useState<number>(SOUND_SETTINGS.soundVolume)
  const channel = useMemo(createGestureChannel, [])
  const timers = useRef<number[]>([])

  useGestureTriggers(session ?? 'idle', channel)
  const sound = useGestureSounds(channel, { enabled: soundOn, volume, cues: SOUND_SETTINGS.gestureCues })
  useEffect(() => channel.onEvent((event: GestureEvent) => {
    const what = event.type === 'start' ? `${event.name} started${event.held ? ' (held)' : ''}` : `${event.name} ended: ${event.reason}`
    setLog(lines => [`${new Date().toLocaleTimeString()} ${what}`, ...lines].slice(0, 8))
  }), [channel])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  // The mouth: whichever voice plays, through the same analyzer. The meter shows exactly what the robot reads.
  const fake = useMemo(() => fakeMouth(), [])
  const fileMouth = useRef<MouthSource | null>(null)
  const lastBars = useRef<ArrayLike<number> | null>(null)
  const meter = useRef<(HTMLSpanElement | null)[]>([])
  const mouth = useCallback<MouthSource>(() => {
    const bars = voice === 'fake' ? fake() : voice === 'file' ? fileMouth.current?.() ?? null : null
    lastBars.current = bars
    return bars
  }, [voice, fake])
  useEffect(() => {
    let raf = 0
    const draw = () => {
      meter.current.forEach((el, i) => { if (el) el.style.blockSize = `${6 + (lastBars.current?.[i] ?? 0) * 94}%` })
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const clearScript = () => { timers.current.forEach(clearTimeout); timers.current = [] }
  const endVoice = useCallback(() => { setVoice(null); setFileStatus('') }, [])
  const file = useFileVoice(endVoice)
  const quiet = () => { file.stop(); fileMouth.current = null; endVoice() }
  const manual = () => { clearScript(); setSession(null) }
  const runConversation = () => {
    clearScript()
    timers.current = SCRIPT.map(([at, status]) => window.setTimeout(() => setSession(status), at * 1000))
  }
  const talk = () => { manual(); setPose('talking'); setExpression('excited') }

  const shownPose = session ? poseFor(session) : pose
  const shownExpression = session ? expressionFor(session) : expression
  const shownSay = session ? (session === 'speaking' ? LINE : '') : say
  // In a simulated session, "speaking" plays the fake voice (through the meter's tap too).
  const sessionMouth = useCallback<MouthSource>(() => { const bars = fake(); lastBars.current = bars; return bars }, [fake])
  const shownMouth = session === 'speaking' ? sessionMouth : mouth

  return <main className="app-main lab">
    <div>
      <h1>Otto lab</h1>
      <fieldset><legend>Pose</legend>{POSES.map(item =>
        <button key={item} type="button" className="otto-btn otto-btn--tonal" aria-pressed={!session && pose === item} onClick={() => {
          manual()
          setPose(item)
          setSay(item === 'talking' ? LINE : '')
          if (item === 'talking') { setExpression('excited'); if (!voice) setVoice('fake') }
          else quiet()
        }}>{item}</button>)}</fieldset>
      <fieldset><legend>Face</legend>{(Object.keys(FACES) as RobotExpression[]).map(item =>
        <button key={item} type="button" className="otto-btn otto-btn--tonal" aria-pressed={!session && expression === item}
          onClick={() => { manual(); setExpression(item) }}>{item}</button>)}</fieldset>
      {/* Pose "thinking" holds thinkingHand by itself (GESTURE_SETTINGS.whileThinking); the buttons here play one-shots. */}
      <fieldset><legend>Gesture</legend>{GESTURE_NAMES.map(name =>
        <button key={name} type="button" className="otto-btn otto-btn--tonal" onClick={() => channel.play(name, { force: true })}>{name}</button>)}
        <button type="button" className="otto-btn otto-btn--tonal" onClick={() => channel.stop()}>Stop gestures</button></fieldset>

      <fieldset><legend>Mouth</legend>
        <p className="lab-hint">Five speech bands from 85 Hz to 4 kHz, through the same analyzer as the live voice.</p>
        <button type="button" className="otto-btn otto-btn--tonal" aria-pressed={voice === 'fake'} onClick={() => { quiet(); setVoice('fake'); talk() }}>Fake voice</button>
        <label className="otto-btn otto-btn--tonal lab-file">Lip-sync an audio file
          <input type="file" accept="audio/*" onChange={async event => {
            const chosen = event.target.files?.[0]
            event.target.value = ''
            if (!chosen) return
            quiet()
            const source = await file.play(chosen)
            if (!source) { setFileStatus(`Could not play ${chosen.name}.`); return }
            fileMouth.current = source
            setVoice('file')
            setFileStatus(`Lip-syncing ${chosen.name}.`)
            talk()
          }} />
        </label>
        <button type="button" className="otto-btn otto-btn--tonal" onClick={() => { quiet(); setPose('idle'); setExpression('happy') }}>Stop voice</button>
        <p role="status" className="lab-hint">{fileStatus}</p>
        <div className="lab-meter" aria-hidden="true">{MOUTH_BANDS.map((band, i) =>
          <div key={band.from}><span ref={el => { meter.current[i] = el }} /><small>{kHz(band.from)}-{kHz(band.to)}</small></div>)}</div>
      </fieldset>

      <fieldset><legend>Sound</legend>
        <p className="lab-hint">Gestures chirp as they start (SOUND_SETTINGS.gestureCues). Sound starts after your first click.</p>
        <label className="lab-inline"><input type="checkbox" checked={soundOn} onChange={e => setSoundOn(e.target.checked)} /> Sound on</label>
        <label className="lab-inline">Volume <input type="range" min={0} max={1} step={0.05} value={volume} onChange={e => setVolume(Number(e.target.value))} /></label>
        <div>{SOUND_CUES.map(cue =>
          <button key={cue} type="button" className="otto-btn otto-btn--tonal" onClick={() => sound.current?.play(cue)}>{cue}</button>)}</div>
      </fieldset>

      <fieldset><legend>Voice session (simulated)</legend>
        <p className="lab-hint">The robot follows the status as in the app, and the lifecycle gestures (GESTURE_SETTINGS) play on the way.</p>
        {STATUSES.map(status =>
          <button key={status} type="button" className="otto-btn otto-btn--tonal" aria-pressed={session === status} aria-label={`Session: ${status}`}
            onClick={() => { clearScript(); quiet(); setSession(status) }}>{status}</button>)}
        <button type="button" className="otto-btn otto-btn--filled" onClick={() => { quiet(); runConversation() }}>Run a conversation</button>
      </fieldset>
      <section aria-labelledby="lab-events">
        <h2 id="lab-events">Gesture events</h2>
        <ol role="log" aria-live="polite" className="lab-log">{log.map((line, i) => <li key={log.length - i}>{line}</li>)}</ol>
      </section>
    </div>
    <div className="lab-stage">
      <OttoRobot pose={shownPose} expression={shownExpression} say={shownSay} mouth={shownMouth} gestures={channel} />
    </div>
  </main>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>)
