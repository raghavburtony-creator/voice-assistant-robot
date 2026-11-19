// Otto lab (npm run dev, then http://localhost:5173/lab.html), with no server and no Gemini key. Otto stands along the
// bottom of this page, as he does in an app, and everything about him can be tried on its own:
//   movement   waypoints, going to and following an element, stepping away, turning and looking, stop, a simulated
//              panel to dodge, speed, and snapping as with reduced motion; every departure and arrival is logged
//   idle       fast-forward to idle and to sleep, and wake (or wait, with short timeouts)
//   body       every face, pose and gesture; the mouth from a fake voice or an audio file; each sound cue
//   voice      a simulated session that drives the lifecycle gestures; or the real Otto (panel, voice pipeline, bubble,
//              barge-in) against a simulated Gemini server that streams synthetic speech
//   awareness  app events (success, failure, a task, attention...) at any importance and place, floods of them, and
//              each decision Otto makes with why; what he knows right now; and the theme presets
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createOttoEvents, OTTO_EVENT_TYPES, type Importance, type OttoEvent, type OttoEventType } from './otto/awareness/events'
import type { Awareness, Reaction } from './otto/awareness/reactions'
import { defineOttoConfig, OttoConfigProvider, THEME_NAMES, type ThemeName } from './otto/config'
import { FakeVoiceServer } from './lab/fakeServer'
import { analyserMouth, fakeMouth, MOUTH_BANDS, type MouthSource } from './otto/mouth'
import { createOttoStage } from './otto/movement/useStage'
import type { StageEvent } from './otto/movement/stage'
import Otto from './otto/Otto'
import { expressionFor, poseFor } from './otto/OttoDock'
import OttoStage, { type IdleControls } from './otto/OttoStage'
import type { IdleState } from './otto/idle'
import { createGestureChannel, GESTURE_NAMES, type GestureEvent } from './otto/robot/gestures'
import { FACES, useReducedMotion, type RobotExpression, type RobotPose } from './otto/robot/robot'
import { useOttoConfig } from './otto/config'
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
const SHORT_IDLE = { idleLookAroundMs: 4000, sleepTimeoutMs: 12000 }
const kHz = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : `${hz}`)
const time = () => new Date().toLocaleTimeString()

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

/** Newest first, a few lines. */
function useLog(size = 8) {
  const [lines, setLines] = useState<string[]>([])
  const add = useCallback((line: string) => setLines(all => [`${time()} ${line}`, ...all].slice(0, size)), [size])
  return [lines, add] as const
}

function Log({ id, title, lines }: { id: string; title: string; lines: string[] }) {
  return <section aria-labelledby={id}>
    <h2 id={id}>{title}</h2>
    <ol role="log" aria-live="polite" className="lab-log">{lines.map((line, i) => <li key={lines.length - i}>{line}</li>)}</ol>
  </section>
}

const describeMove = (e: StageEvent) =>
  e.type === 'depart' ? `depart ${Math.round(e.from)} -> ${Math.round(e.to)}`
    : e.type === 'arrive' ? `arrive at ${Math.round(e.x)}`
      : e.type === 'cancel' ? `cancel (${e.reason}) at ${Math.round(e.x)}`
        : e.hidden ? 'hidden: no room on the stage' : 'shown again'

const describeReaction = (e: OttoEvent, r: Reaction) => {
  const did = r.size === 'none' ? 'no reaction' : [r.size, r.face, r.gesture, r.walk ? 'walks there' : r.look ? 'looks' : ''].filter(Boolean).join(', ')
  return `${e.type}${e.importance ? ` (${e.importance})` : ''}: ${did}. Why: ${r.why.join('; ')}`
}

function Lab() {
  const [theme, setTheme] = useState<ThemeName>('default')
  const config = useMemo(() => defineOttoConfig({ theme }), [theme])
  return <OttoConfigProvider config={config}><LabInner theme={theme} setTheme={setTheme} /></OttoConfigProvider>
}

function LabInner({ theme, setTheme }: { theme: ThemeName; setTheme: (t: ThemeName) => void }) {
  const config = useOttoConfig()
  const SOUND_SETTINGS = config.sound
  const [pose, setPose] = useState<RobotPose>('idle')
  const [expression, setExpression] = useState<RobotExpression>('happy')
  const [say, setSay] = useState('')
  // A simulated voice session: while set, the robot follows the status the way the dock does.
  const [session, setSession] = useState<AssistantStatus | null>(null)
  const [log, addLog] = useLog()
  const [moves, addMove] = useLog()
  const [serverLines, addServer] = useLog(10)
  const [voice, setVoice] = useState<'fake' | 'file' | null>(null)
  const [fileStatus, setFileStatus] = useState('')
  const [soundOn, setSoundOn] = useState<boolean>(SOUND_SETTINGS.soundEnabled)
  const [volume, setVolume] = useState<number>(SOUND_SETTINGS.soundVolume)
  const channel = useMemo(createGestureChannel, [])
  const stage = useMemo(createOttoStage, [])
  const timers = useRef<number[]>([])

  // The real Otto against a simulated server, instead of the lab's own robot.
  const [full, setFull] = useState(false)
  const server = useMemo(() => new FakeVoiceServer(addServer), [addServer])
  useEffect(() => () => server.dispose(), [server])

  // Movement controls.
  const [panel, setPanel] = useState(false)
  const [speed, setSpeed] = useState(260)
  const [snap, setSnap] = useState(false)
  const [following, setFollowing] = useState(false)
  const [where, setWhere] = useState('')
  useEffect(() => stage.onEvent(e => addMove(describeMove(e))), [stage, addMove])
  useEffect(() => { stage.setSpeed(speed) }, [stage, speed])
  // The visitor's own reduced-motion setting always snaps; the checkbox only adds to it.
  const reduced = useReducedMotion()
  useEffect(() => { stage.setReducedMotion(snap || reduced) }, [stage, snap, reduced])
  useEffect(() => {
    const id = window.setInterval(() => {
      const f = stage.frame
      setWhere(`${f.phase}, x ${Math.round(f.x)} px, ${Math.round(f.v)} px/s, heading ${f.heading.toFixed(2)}${f.gaze ? ', looking at a target' : ''}`)
    }, 150)
    return () => window.clearInterval(id)
  }, [stage])
  const go = (what: string, move: Promise<boolean>) => { setFollowing(false); void move.then(ok => addMove(`${what}: ${ok ? 'arrived' : 'did not arrive'}`)) }

  // Awareness: events in, decisions out.
  const events = useMemo(createOttoEvents, [])
  const [reactions, addReaction] = useLog(10)
  const [importance, setImportance] = useState<Importance | ''>('')
  const [place, setPlace] = useState<'none' | 'target' | 'left' | 'top'>('target')
  const knows = useRef<(() => Awareness) | null>(null)
  const [known, setKnown] = useState('')
  useEffect(() => {
    const id = window.setInterval(() => {
      const a = knows.current?.()
      if (!a) return
      const tasks = a.app.tasks.map(t => `${t.id} (${t.topic ?? 'no topic'}, ${Math.round((performance.now() - t.since) / 100) / 10} s)`).join(', ') || 'none'
      setKnown(`Otto: ${a.self.asleep ? 'asleep' : 'awake'}${a.self.talking ? ', talking' : ''}${a.self.walking ? ', walking' : ''}${a.self.mayMove ? '' : ', staying put'}. `
        + `Visitor: ${a.user.present ? 'here' : 'away'}${a.user.idle ? ', idle' : ''}. Tasks: ${tasks}. Section: ${a.app.section ?? 'none'}. `
        + `Waiting on the visitor: ${a.app.waiting ? 'yes' : 'no'}. Recent: ${a.recent.slice(-4).map(r => `${r.type}->${r.size}`).join(', ') || 'none'}.`)
    }, 300)
    return () => window.clearInterval(id)
  }, [])
  const eventPlace = () => place === 'target' ? '#lab-target' : place === 'left' ? '.lab-spot-left' : place === 'top' ? '.lab-spot-top' : undefined
  const send = (type: OttoEventType, extra: Partial<OttoEvent> = {}) =>
    events.notify({ type, importance: importance || undefined, where: eventPlace(), topic: extra.topic ?? `lab ${type}`, ...extra })
  const taskCount = useRef(0)
  const runTask = (seconds: number, result: 'succeed' | 'fail') => {
    const job = events.task(`job${++taskCount.current}`, { topic: 'lab task', where: eventPlace() })
    window.setTimeout(() => (result === 'succeed' ? job.succeed('The lab task finished.') : job.fail('The lab task failed.')), seconds * 1000)
  }

  // Idle controls.
  const [shortIdle, setShortIdle] = useState(true)
  const [idleState, setIdleState] = useState<IdleState>('awake')
  const idle = useRef<IdleControls | null>(null)

  useGestureTriggers(session ?? 'idle', channel)
  const sound = useGestureSounds(channel, { enabled: soundOn, volume, cues: SOUND_SETTINGS.gestureCues })
  useEffect(() => channel.onEvent((event: GestureEvent) => {
    addLog(event.type === 'start' ? `${event.name} started${event.held ? ' (held)' : ''}` : `${event.name} ended: ${event.reason}`)
  }), [channel, addLog])
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
  const busy = !!session && session !== 'idle' && session !== 'ended'

  const btn = 'otto-btn otto-btn--tonal'
  return <>
    <main className="app-main lab">
      <div>
        <h1>Otto lab</h1>

        <fieldset><legend>Movement</legend>
          <p className="lab-hint">Otto walks along the bottom of this page. <span role="status">{where}</span></p>
          <div className="lab-row">
            <button type="button" className={btn} onClick={() => go('left', stage.moveToX(0))}>Left</button>
            <button type="button" className={btn} onClick={() => go('centre', stage.moveToX(0.5))}>Centre</button>
            <button type="button" className={btn} onClick={() => go('right', stage.moveToX(1))}>Right</button>
            <button type="button" className={btn} onClick={() => go('home', stage.goHome())}>Home</button>
            <button type="button" className={btn} onClick={() => { setFollowing(false); stage.stop() }}>Stop</button>
          </div>
          <div className="lab-row">
            <button type="button" className={btn} onClick={() => go('to the target', stage.moveToElement('#lab-target'))}>Go to the target</button>
            <button type="button" className={btn} onClick={() => go('away from the target', stage.moveAwayFrom('#lab-target', 80))}>Step away from it</button>
            <button type="button" className={btn} onClick={() => stage.turnToward('#lab-target', 2)}>Turn toward it</button>
            <button type="button" className={btn} onClick={() => stage.lookAt('#lab-target', 3)}>Look at it (3 s)</button>
            <button type="button" className={btn} onClick={() => {
              setFollowing(false)
              void stage.moveToElement('#lab-target').then(arrived => {
                if (!arrived) return
                stage.lookAt('#lab-target', 2.5)
                channel.play('welcomeWave', { force: true })
              })
            }}>Walk there, look up, wave</button>
            <button type="button" id="lab-target" className="otto-btn otto-btn--filled lab-target">Target</button>
          </div>
          <div className="lab-row">
            <button type="button" className={btn} aria-pressed={following} onClick={() => {
              if (following) { setFollowing(false); void stage.goHome(); return }
              setFollowing(true)
              void stage.moveToElement('.lab-mover', { follow: true })
            }}>Follow the moving dot</button>
            <button type="button" className={btn} aria-pressed={panel} onClick={() => setPanel(open => !open)}>Simulated panel</button>
          </div>
          <label className="lab-inline">Speed <input type="range" min={40} max={600} step={20} value={speed} onChange={e => setSpeed(Number(e.target.value))} /> {speed} px/s</label>
          <label className="lab-inline"><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} /> Snap, as with reduced motion</label>
        </fieldset>

        <fieldset><legend>Awareness: what happens in the app</legend>
          <p className="lab-hint">Send Otto an event and watch what he decides, and why (the log on the right). He reacts less to repeats, to events too close together, while asleep or talking, and not at all with the tab hidden.</p>
          <div className="lab-row">
            <label className="lab-inline">Importance <select value={importance} onChange={e => setImportance(e.target.value as Importance | '')}>
              <option value="">by type</option><option value="minor">minor</option><option value="normal">normal</option><option value="major">major</option></select></label>
            <label className="lab-inline">Where <select value={place} onChange={e => setPlace(e.target.value as typeof place)}>
              <option value="target">the Target button</option><option value="left">bottom left of the page</option><option value="top">top of the page</option><option value="none">nowhere in particular</option></select></label>
          </div>
          <div className="lab-row">{OTTO_EVENT_TYPES.filter(t => t !== 'task').map(type =>
            <button key={type} type="button" className={btn} aria-label={`Event: ${type}`} onClick={() => send(type, type === 'failure' || type === 'attention' ? { message: type === 'failure' ? 'Saving failed.' : 'Please check this.' } : {})}>{type}</button>)}
          </div>
          <div className="lab-row">
            <button type="button" className={btn} onClick={() => runTask(1, 'succeed')}>A 1 s task, then success</button>
            <button type="button" className={btn} onClick={() => runTask(6, 'succeed')}>A 6 s task, then success</button>
            <button type="button" className={btn} onClick={() => runTask(3, 'fail')}>A 3 s task, then failure</button>
            <button type="button" className={btn} onClick={() => { for (let i = 0; i < 5; i++) window.setTimeout(() => send('success', { topic: 'flood' }), i * 300) }}>5 successes in 1.5 s</button>
          </div>
          <p className="lab-hint" role="status">{known}</p>
        </fieldset>

        <fieldset><legend>Theme</legend>
          <label className="lab-inline">Preset <select value={theme} onChange={e => setTheme(e.target.value as ThemeName)}>
            {THEME_NAMES.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
          <p className="lab-hint">Colours, glow, gesture size, sound, speed and liveliness change at once, without rebuilding the robot. The web component playground is at <a href="/preview/">/preview/</a>.</p>
        </fieldset>

        <fieldset><legend>Idle and sleep</legend>
          <p className="lab-hint">Now: <strong role="status">{idleState}</strong>. Asleep, Otto wakes when the cursor comes over him, on a click or a key.</p>
          <label className="lab-inline"><input type="checkbox" checked={shortIdle} disabled={full} onChange={e => setShortIdle(e.target.checked)} /> Short timeouts (idle after 4 s, asleep after 12 s)</label>
          <div className="lab-row">
            <button type="button" className={btn} onClick={() => idle.current?.idleNow()}>Idle now</button>
            <button type="button" className={btn} onClick={() => idle.current?.sleep()}>Sleep now</button>
            <button type="button" className={btn} onClick={() => idle.current?.wake()}>Wake</button>
          </div>
        </fieldset>

        <fieldset disabled={full}><legend>Pose</legend>{POSES.map(item =>
          <button key={item} type="button" className={btn} aria-pressed={!session && pose === item} onClick={() => {
            manual()
            setPose(item)
            setSay(item === 'talking' ? LINE : '')
            if (item === 'talking') { setExpression('excited'); if (!voice) setVoice('fake') }
            else quiet()
          }}>{item}</button>)}</fieldset>
        <fieldset disabled={full}><legend>Face</legend>{(Object.keys(FACES) as RobotExpression[]).map(item =>
          <button key={item} type="button" className={btn} aria-pressed={!session && expression === item}
            onClick={() => { manual(); setExpression(item) }}>{item}</button>)}</fieldset>
        {/* Pose "thinking" holds thinkingHand by itself (GESTURE_SETTINGS.whileThinking); the buttons here play one-shots. */}
        <fieldset><legend>Gesture</legend>{GESTURE_NAMES.map(name =>
          <button key={name} type="button" className={btn} onClick={() => channel.play(name, { force: true })}>{name}</button>)}
          <button type="button" className={btn} onClick={() => channel.stop()}>Stop gestures</button></fieldset>

        <fieldset disabled={full}><legend>Mouth</legend>
          <p className="lab-hint">Five speech bands from 85 Hz to 4 kHz, through the same analyzer as the live voice.</p>
          <button type="button" className={btn} aria-pressed={voice === 'fake'} onClick={() => { quiet(); setVoice('fake'); talk() }}>Fake voice</button>
          <label className={`${btn} lab-file`}>Lip-sync an audio file
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
          <button type="button" className={btn} onClick={() => { quiet(); setPose('idle'); setExpression('happy') }}>Stop voice</button>
          <p role="status" className="lab-hint">{fileStatus}</p>
          <div className="lab-meter" aria-hidden="true">{MOUTH_BANDS.map((band, i) =>
            <div key={band.from}><span ref={el => { meter.current[i] = el }} /><small>{kHz(band.from)}-{kHz(band.to)}</small></div>)}</div>
        </fieldset>

        <fieldset><legend>Sound</legend>
          <p className="lab-hint">Gestures chirp as they start (SOUND_SETTINGS.gestureCues). Sound starts after your first click.</p>
          <label className="lab-inline"><input type="checkbox" checked={soundOn} onChange={e => setSoundOn(e.target.checked)} /> Sound on</label>
          <label className="lab-inline">Volume <input type="range" min={0} max={1} step={0.05} value={volume} onChange={e => setVolume(Number(e.target.value))} /></label>
          <div>{SOUND_CUES.map(cue =>
            <button key={cue} type="button" className={btn} onClick={() => sound.current?.play(cue)}>{cue}</button>)}</div>
        </fieldset>

        <fieldset disabled={full}><legend>Voice session (simulated)</legend>
          <p className="lab-hint">The robot follows the status as in the app, and the lifecycle gestures (GESTURE_SETTINGS) play on the way.</p>
          {STATUSES.map(status =>
            <button key={status} type="button" className={btn} aria-pressed={session === status} aria-label={`Session: ${status}`}
              onClick={() => { clearScript(); quiet(); setSession(status) }}>{status}</button>)}
          <button type="button" className="otto-btn otto-btn--filled" onClick={() => { quiet(); runConversation() }}>Run a conversation</button>
        </fieldset>

        <fieldset><legend>The real Otto, with a simulated Gemini server</legend>
          <p className="lab-hint">
            The whole voice pipeline runs as it does live: the panel, streamed speech through the speech player and the mouth,
            the bubble in step with the audio, and barge-in. Open the panel (click Otto, or Alt+O), choose to type, and ask anything.
          </p>
          <label className="lab-inline"><input type="checkbox" checked={full} onChange={e => { manual(); quiet(); setFull(e.target.checked) }} /> Use the real Otto</label>
          <div className="lab-row">
            <button type="button" className={btn} disabled={!full} onClick={() => { if (!server.reply()) addServer('not connected: open the panel and start first') }}>Otto answers</button>
            <button type="button" className={btn} disabled={!full} onClick={() => { if (!server.bargeIn()) addServer('Otto is not speaking') }}>Barge in (the server hears you)</button>
          </div>
          <p className="lab-hint">To cut Otto off from this page instead, use the panel's Stop talking while he talks.</p>
        </fieldset>
      </div>
      <aside className="lab-side">
        <Log id="lab-reactions" title="Reactions" lines={reactions} />
        <Log id="lab-moves" title="Movement" lines={moves} />
        <Log id="lab-events" title="Gesture events" lines={log} />
        {full && <Log id="lab-server" title="Simulated server" lines={serverLines} />}
      </aside>
    </main>

    <div className={following ? 'lab-mover is-moving' : 'lab-mover'} aria-hidden="true" />
    <div className="lab-spot-left" aria-hidden="true" />
    <div className="lab-spot-top" aria-hidden="true" />
    {panel && <div className="lab-panel" role="region" aria-label="Simulated panel">A simulated panel: Otto keeps clear of it.</div>}

    {full
      ? <Otto page="home" onAction={action => addServer(`action: ${JSON.stringify(action)}`)} gestures={channel} stage={stage}
          createSocket={server.createSocket} idleControls={idle} events={events} config={config} />
      : <OttoStage className="otto-dock" stage={stage} pose={shownPose} expression={shownExpression} say={shownSay}
          mouth={shownMouth} gestures={channel} busy={busy} obstacles={panel ? ['.lab-panel'] : undefined} obstaclesKey={panel}
          idleTimes={shortIdle ? SHORT_IDLE : undefined} onIdleState={setIdleState} idleControls={idle}
          events={events} onReaction={(e, r) => addReaction(describeReaction(e, r))} awarenessRef={knows} />}
  </>
}

createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>)
