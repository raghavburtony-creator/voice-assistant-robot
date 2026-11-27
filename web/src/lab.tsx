// Otto lab (npm run dev, then http://localhost:5173/lab.html), with no server and no Gemini key. Otto stands along the
// bottom of this page, as he does in an app, and everything about him can be tried on its own:
//   movement   waypoints, going to and following an element, stepping away, turning and looking, stop, a simulated
//              panel to dodge, speed, and snapping as with reduced motion; every departure and arrival is logged
//   idle       fast-forward to idle and to sleep, and wake (or wait, with short timeouts)
//   body       every face, pose and gesture; the mouth from a fake voice or an audio file; each sound cue
//   voice      a simulated session that drives the lifecycle gestures; or the real Otto (panel, voice pipeline, bubble,
//              barge-in) against a simulated Gemini server that streams synthetic speech
//   guidance   guide Otto to a target (look, point, approach, explain), app suggestions at each importance, a missing
//              target, and a multi-step task; each decision logged with why (no AI backend)
//   embodied   a sample form, the model's tool calls simulated (show a target with the spotlight, a card, a finished step,
//              missing, hidden and disabled targets), what the page snapshot sends the model, the spoken / visual split
//              of a reply, and form friction (proactive help)
//   awareness  app events (success, failure, a task, attention...) at any importance and place, floods of them, and
//              each decision Otto makes with why; what he knows right now; and the theme presets
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { createOttoEvents, OTTO_EVENT_TYPES, type Importance, type OttoEvent, type OttoEventType } from './otto/awareness/events'
import type { Awareness, Reaction } from './otto/awareness/reactions'
import { defineOttoConfig, THEME_NAMES, type ThemeName } from './otto/config'
import { OttoConfigProvider, useOttoConfig } from './otto/useOttoConfig'
import { createOttoGuide, planGuide, type GuideMode, type GuideRequest, type GuideTaskHandle } from './otto/guidance/guide'
import type { GuideTaskSpec } from './otto/guidance/task'
import { attachGuide } from './otto/guidance/runner'
import { findGuideTarget, registerGuideTask } from './otto/guidance/targets'
import { observeGuidance } from './otto/guidance/observe'
import { createSpotlight } from './otto/guidance/spotlight'
import { EmbodiedSandbox } from './lab/EmbodiedSandbox'
import { VAD } from './otto.config'
import { VoiceActivityDetector } from './otto/gemini/vad'
import { compareConstraints, describeConstraint, describeLevels, MIC_REQUEST, summariseLevels, type MicSettings } from './otto/micDiagnostic'
import { FakeVoiceServer } from './lab/fakeServer'
import { FAKE_SIGN_SCRIPTS, FakeSignRecognizer, type FakeSignScriptName } from './lab/fakeSignRecognizer'
import { SignRecognizerProvider } from './otto/sign/useSignRecognizer'
import { analyserMouth, fakeMouth, MOUTH_BANDS, type MouthSource } from './otto/mouth'
import { createOttoStage } from './otto/movement/useStage'
import type { StageEvent } from './otto/movement/stage'
import Otto from './otto/Otto'
import { expressionFor, poseFor } from './otto/OttoDock'
import OttoStage, { type IdleControls } from './otto/OttoStage'
import type { IdleState } from './otto/idle'
import { createGestureChannel, GESTURE_NAMES, type GestureEvent } from './otto/robot/gestures'
import { FACES, type RobotExpression, type RobotPose } from './otto/robot/robot'
import { useReducedMotion } from './otto/robot/environment'
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
const GUIDE_TARGETS = [
  { id: 'lab-left', label: 'the far-left card', description: 'This card sits at the far left of the page.', style: { insetInlineStart: 8 } },
  { id: 'lab-right', label: 'the far-right card', description: 'This card sits at the far right of the page.', style: { insetInlineEnd: 8 } },
  { id: 'lab-near', label: 'the card next to me', description: 'This card is right beside Otto.', style: { insetInlineStart: '50%' } },
]
const GUIDE_MODES: GuideMode[] = ['auto', 'glance', 'point', 'approach', 'explain']
const GUIDE_TASK: GuideTaskSpec = {
  id: 'lab-tour', title: 'A three-step tour', intro: "Let's take a quick tour.", doneSay: 'That was the tour!',
  steps: [
    { id: 's1', target: 'lab-left', say: 'First, the card on the far left.' },
    { id: 's2', target: 'lab-right', say: 'Next, the card on the far right.' },
    { id: 's3', target: 'lab-below', say: 'Last, the card down below the fold.' },
  ],
}
/** A task Otto follows by himself: click the cards (or send the app events) and he notices each step. */
const FOLLOW_TASK: GuideTaskSpec = {
  id: 'lab-follow', title: 'A task Otto follows', intro: 'Do each step; I will notice.', doneSay: 'All done, nicely!',
  cancelWhen: [{ on: 'event', type: 'section', topic: 'lab-away' }],
  steps: [
    { id: 'f1', target: 'lab-left', say: 'Click the card on the far left.', doneWhen: [{ on: 'activate' }],
      undoneWhen: [{ on: 'event', type: 'complete', topic: 'lab-undo' }] },
    { id: 'f2', target: 'lab-near', say: 'Now click the card beside me.', doneWhen: [{ on: 'activate' }] },
    { id: 'f3', target: 'lab-right', say: 'Last, save: the app reports it.', doneWhen: [{ on: 'event', type: 'success', topic: 'lab-save' }] },
  ],
}
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
  // Proactive help is off by default in the kit; on here, with short waits, so friction can be tried at once.
  const [proactive, setProactive] = useState(true)
  const config = useMemo(() => defineOttoConfig({ theme, guidance: { proactiveHelpEnabled: proactive, frictionCooldownMs: 5000, stallMs: 6000 } }), [theme, proactive])
  return <OttoConfigProvider config={config}><LabInner theme={theme} setTheme={setTheme} proactive={proactive} setProactive={setProactive} /></OttoConfigProvider>
}

type LabProps = { theme: ThemeName; setTheme: (t: ThemeName) => void; proactive: boolean; setProactive: (on: boolean) => void }

function LabInner({ theme, setTheme, proactive, setProactive }: LabProps) {
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
  // A scripted sign reader (lab only, D-29): no camera and no model. Remade for each choice of script.
  const [signScript, setSignScript] = useState<FakeSignScriptName>('reads')
  const signReader = useMemo(() => new FakeSignRecognizer(FAKE_SIGN_SCRIPTS[signScript]), [signScript])
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

  // Guidance: one channel; the lab attaches the runner itself when it shows the body only (the real Otto does it inside).
  const guide = useMemo(createOttoGuide, [])
  const [guides, addGuide] = useLog(10)
  const [guideTarget, setGuideTarget] = useState('lab-right')
  const [guideMode, setGuideMode] = useState<GuideMode>('auto')
  const [guideQuiet, setGuideQuiet] = useState(false)
  const [taskNow, setTaskNow] = useState('')
  const [cooldownKey, setCooldownKey] = useState(0)
  const [offer, setOffer] = useState<GuideRequest | null>(null)
  const task = useRef<GuideTaskHandle | null>(null)
  const lastApp = useRef<number | null>(null)
  const heldFace = useRef<RobotExpression>('happy')
  heldFace.current = expression
  const sayTimer = useRef(0)
  const idleRef = useRef<IdleState>('awake')
  const attachDeps = useRef({ config, stage })
  attachDeps.current = { config, stage }
  useEffect(() => guide.onEvent(e => {
    addGuide(e.type === 'shown' ? `shown ${e.target}: ${e.size}` : e.type === 'offered' ? `offered ${e.target}: waiting for a yes` : e.type === 'missing' ? `missing target ${e.target} (${e.reason ?? 'not_found'})`
      : e.type === 'step' ? `task step ${e.index + 1}/${e.total} (${e.via}): ${e.step.id} -> ${e.step.target}`
        : e.type === 'done' ? `task ${e.task} done` : `task ${e.task} cancelled (${e.reason})`)
    if (e.type === 'offered') setOffer(e.request)
    else if (e.type === 'shown') setOffer(null)
    if (e.type === 'step') setTaskNow(`step ${e.index + 1} of ${e.total}: ${e.step.id}`)
    else if (e.type === 'done' || e.type === 'cancelled') setTaskNow('')
  }), [guide, addGuide])
  useEffect(() => () => window.clearTimeout(sayTimer.current), [])
  // Re-attaching (also what "Reset cooldown" does) gives the runner a fresh cooldown.
  const snapRef = useRef(false)
  snapRef.current = snap || reduced
  useEffect(() => {
    if (full) return
    const spotlight = createSpotlight({ reducedMotion: () => snapRef.current, onDismiss: () => addGuide('spotlight dismissed') })
    const detach = attachGuide(guide, {
      highlight: element => spotlight.show(element),
      reducedMotion: () => snapRef.current,
      stage,
      playGesture: name => channel.play(name),
      face: () => heldFace.current,
      setFace: face => setExpression(face ?? heldFace.current),
      speak: text => {
        window.clearTimeout(sayTimer.current)
        setSay(text)
        return new Promise<void>(resolve => { sayTimer.current = window.setTimeout(() => { setSay(''); resolve() }, 1500 + text.length * 50) })
      },
      settings: () => attachDeps.current.config.guidance,
      situation: () => ({ idle: idleRef.current, conversing: false, movementEnabled: attachDeps.current.config.movement.movementEnabled }),
      ottoRect: () => { const x = stage.frame.x; return { left: x, right: x, top: 0, bottom: 0 } },
    })
    return () => { detach(); spotlight.dispose() }
  }, [guide, full, stage, channel, cooldownKey, addGuide])
  const labSay = useCallback((text: string) => {
    window.clearTimeout(sayTimer.current)
    setSay(text)
    sayTimer.current = window.setTimeout(() => setSay(''), 1500 + text.length * 50)
  }, [])
  const askGuide = (request: GuideRequest) => {
    const full_ = { ...request, say: guideQuiet ? null : request.say }
    const found = findGuideTarget(full_.target)
    const r = found?.element.getBoundingClientRect()
    const dx = r ? (r.left + r.right) / 2 - stage.frame.x : 0
    const now = performance.now()
    // A preview of the runner's decision: same inputs, read from the page now.
    const plan = planGuide(full_, found?.info ?? null, {
      side: dx > 48 ? 'right' : dx < -48 ? 'left' : 'center', distance: Math.min(1, Math.abs(dx) / window.innerWidth),
      visible: !r || (r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth),
      tabVisible: document.visibilityState !== 'hidden', idle: idleRef.current, conversing: false,
      movementEnabled: config.movement.movementEnabled, now, lastAppGuideAt: lastApp.current,
    }, config.guidance)
    if ((full_.reason ?? 'app') === 'app' && found && plan.size !== 'skip') lastApp.current = now
    addGuide(`${full_.target}: ${plan.size}. Why: ${plan.why.join('; ')}`)
    guide.show(full_)
  }
  const startTask = () => { task.current = guide.startTask(GUIDE_TASK) }
  // Offered to the voice: the real Otto starts it on a 'task' action (and refuses any task not offered).
  useEffect(() => registerGuideTask(FOLLOW_TASK), [])
  // What the visitor does, for guidance: clicks on the cards and the app events move a followed task on; events that name
  // a help target may get an offer (logged with why).
  useEffect(() => {
    if (full) return
    return observeGuidance(guide, { events, settings: () => attachDeps.current.config.guidance, onHelp: (why, target) => addGuide(`help for ${target}: ${why}`) })
  }, [guide, events, full, addGuide])

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

        <fieldset><legend>Guidance: showing the visitor something</legend>
          <p className="lab-hint">Otto guides to the demo cards (far left, far right, beside him, and one below the fold, which makes him scroll). Without the AI backend. The decision log is on the right; its first line per request is a preview of the plan, and "shown" / "missing" / task lines are what the runner reported. Suggestions respect a cooldown.</p>
          <div className="lab-row">
            <label className="lab-inline">Target <select value={guideTarget} onChange={e => setGuideTarget(e.target.value)}>
              {[...GUIDE_TARGETS.map(t => t.id), 'lab-below', 'missing-target'].map(id => <option key={id} value={id}>{id}</option>)}</select></label>
            <label className="lab-inline"><input type="checkbox" checked={guideQuiet} onChange={e => setGuideQuiet(e.target.checked)} /> Say nothing (the voice speaks)</label>
          </div>
          <div className="lab-row"><span className="lab-hint">Asked:</span>{GUIDE_MODES.map(mode =>
            <button key={mode} type="button" className={btn} aria-pressed={guideMode === mode} onClick={() => { setGuideMode(mode); askGuide({ target: guideTarget, mode, reason: 'asked' }) }}>{mode}</button>)}
          </div>
          <div className="lab-row"><span className="lab-hint">App suggests:</span>{(['minor', 'normal', 'major'] as const).map(level =>
            <button key={level} type="button" className={btn} onClick={() => askGuide({ target: guideTarget, mode: 'auto', reason: 'app', importance: level })}>{level}</button>)}
            <button type="button" className={btn} onClick={() => { lastApp.current = null; setCooldownKey(k => k + 1); addGuide('cooldown reset') }}>Reset cooldown</button>
            <button type="button" className={btn} onClick={() => guide.stop()}>Stop guiding</button>
          </div>
          <div className="lab-row">
            <button type="button" className={btn} onClick={startTask}>Start task</button>
            <button type="button" className={btn} onClick={() => task.current?.complete()}>Complete step</button>
            <button type="button" className={btn} onClick={() => task.current?.complete('s2')}>Skip ahead (past step 2)</button>
            <button type="button" className={btn} onClick={() => task.current?.back()}>Back</button>
            <button type="button" className={btn} onClick={() => task.current?.cancel()}>Cancel</button>
          </div>
          <div className="lab-row"><span className="lab-hint">A task Otto follows:</span>
            <button type="button" className={btn} onClick={() => { task.current = guide.startTask(FOLLOW_TASK) }}>Start it</button>
            <span className="lab-hint">then click the cards, or:</span>
            <button type="button" className={btn} onClick={() => events.notify({ type: 'success', topic: 'lab-save' })}>App: saved</button>
            <button type="button" className={btn} onClick={() => events.notify({ type: 'complete', topic: 'lab-undo' })}>App: step 1 undone</button>
            <button type="button" className={btn} onClick={() => events.notify({ type: 'section', topic: 'lab-away' })}>App: visitor left</button>
          </div>
          <div className="lab-row"><span className="lab-hint">Needs help?</span>
            <button type="button" className={btn} onClick={() => events.notify({ type: 'failure', topic: 'lab-form', help: 'lab-right', message: 'That did not save.' })}>Failure naming a help target (press twice)</button>
            <button type="button" className={btn} onClick={() => events.notify({ type: 'attention', help: 'lab-left', message: 'This needs you.' })}>Attention naming one</button>
          </div>
          {offer && <div className="lab-row"><span className="lab-hint" role="status">Otto offered to show {offer.target}.</span>
            <button type="button" className={btn} onClick={() => { guide.show({ ...offer, reason: 'asked' }); setOffer(null) }}>Show me</button></div>}
          <p className="lab-hint" role="status">{taskNow ? `Task: ${taskNow}` : 'No task running.'}</p>
        </fieldset>

        <EmbodiedSandbox guide={guide} full={full} server={server} config={config} proactive={proactive} setProactive={setProactive}
          say={labSay} log={addGuide} />

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

        <VadLab />
        <MicCheckLab />

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
          <label className="lab-inline">Sign reader script (scripted, no camera or model)
            <select value={signScript} disabled={!full} onChange={e => setSignScript(e.target.value as FakeSignScriptName)}>
              {(Object.keys(FAKE_SIGN_SCRIPTS) as FakeSignScriptName[]).map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <div className="lab-row">
            <button type="button" className={btn} disabled={!full} onClick={() => { if (!server.reply()) addServer('not connected: open the panel and start first') }}>Otto answers</button>
            <button type="button" className={btn} disabled={!full} onClick={() => { if (!server.bargeIn()) addServer('Otto is not speaking') }}>Barge in (the server hears you)</button>
            <button type="button" className={btn} disabled={!full} onClick={() => { if (!server.action({ action: 'task', task: FOLLOW_TASK.id })) addServer('not connected') }}>Voice: start the followed task</button>
            <button type="button" className={btn} disabled={!full} onClick={() => { if (!server.action({ action: 'task', task: 'not-offered' })) addServer('not connected') }}>Voice: start a task the page never offered</button>
            {(['next', 'back', 'stop'] as const).map(move =>
              <button key={move} type="button" className={btn} disabled={!full} onClick={() => { if (!server.action({ action: 'task_move', move })) addServer('not connected') }}>Voice: task {move}</button>)}
            <button type="button" className={btn} disabled={!full} onClick={() => { if (!server.avatar({ kind: 'working', id: 'lab-job', topic: 'a long job' })) addServer('not connected') }}>Server: a long job starts</button>
            <button type="button" className={btn} disabled={!full} onClick={() => { if (!server.avatar({ kind: 'success', id: 'lab-job', message: 'The long job finished.' })) addServer('not connected') }}>Server: the job succeeds</button>
            <button type="button" className={btn} disabled={!full} onClick={() => { if (!server.avatar({ kind: 'permission', id: 'lab-ask', state: 'asking', message: 'May I send this for you?' })) addServer('not connected') }}>Server: asks permission</button>
            <button type="button" className={btn} disabled={!full} onClick={() => { if (!server.avatar({ kind: 'permission', id: 'lab-ask', state: 'granted' })) addServer('not connected') }}>Server: permission granted</button>
            <button type="button" className={btn} disabled={!full} onClick={() => { if (!server.avatar({ kind: 'permission', id: 'lab-ask', state: 'denied' })) addServer('not connected') }}>Server: permission denied</button>
            <button type="button" className={btn} disabled={!full} onClick={() => addServer(`running task: ${JSON.stringify(server.context('guide_task_running') ?? null)}`)}>What the server knows of the running task</button>
            <button type="button" className={btn} disabled={!full} onClick={() => addServer(`app tasks: ${JSON.stringify(server.context('app_tasks') ?? null)}`)}>What the server knows of the app's tasks</button>
            <button type="button" className={btn} disabled={!full} onClick={() => addServer(`sharing: ${server.capture ?? 'nothing'}, ${server.imageFrames} frames`)}>What the server has of a share</button>
          </div>
          <p className="lab-hint">To cut Otto off from this page instead, use the panel's Stop talking while he talks.</p>
        </fieldset>
      </div>
      <aside className="lab-side">
        <Log id="lab-reactions" title="Reactions" lines={reactions} />
        <Log id="lab-guides" title="Guidance" lines={guides} />
        <Log id="lab-moves" title="Movement" lines={moves} />
        <Log id="lab-events" title="Gesture events" lines={log} />
        {full && <Log id="lab-server" title="Simulated server" lines={serverLines} />}
      </aside>
    </main>

    <div className={following ? 'lab-mover is-moving' : 'lab-mover'} aria-hidden="true" />
    {GUIDE_TARGETS.map(t => <div key={t.id} className="otto-btn otto-btn--tonal" role="group" data-otto-target={t.id} data-otto-label={t.label} data-otto-description={t.description}
      style={{ position: 'fixed', insetBlockEnd: t.id === 'lab-near' ? 140 : 90, padding: '0.5rem 0.75rem', ...t.style }}>{t.label}</div>)}
    <div className="otto-btn otto-btn--tonal" role="group" data-otto-target="lab-below" data-otto-label="the card below the fold" data-otto-description="This card is far down the page."
      style={{ position: 'absolute', insetBlockStart: '180vh', insetInlineStart: '40%', padding: '0.5rem 0.75rem' }}>the card below the fold</div>
    <div className="lab-spot-left" aria-hidden="true" />
    <div className="lab-spot-top" aria-hidden="true" />
    {panel && <div className="lab-panel" role="region" aria-label="Simulated panel">A simulated panel: Otto keeps clear of it.</div>}

    {full
      ? <SignRecognizerProvider recognizer={signReader}>
        <Otto page="home" onAction={action => addServer(`action: ${JSON.stringify(action)}`)} gestures={channel} stage={stage}
          createSocket={server.createSocket} idleControls={idle} events={events} config={config} guide={guide} />
      </SignRecognizerProvider>
      : <OttoStage className="otto-dock" stage={stage} pose={shownPose} expression={shownExpression} say={shownSay}
          mouth={shownMouth} gestures={channel} busy={busy} obstacles={panel ? ['.lab-panel'] : undefined} obstaclesKey={panel}
          idleTimes={shortIdle ? SHORT_IDLE : undefined} onIdleState={s => { idleRef.current = s; setIdleState(s) }} idleControls={idle}
          events={events} onReaction={(e, r) => addReaction(describeReaction(e, r))} awarenessRef={knows} />}
  </>
}

/** Live input level against the VAD threshold, with a simulated turn (tone, then silence) that must be cut off. */
function VadLab() {
  const btn = 'otto-btn otto-btn--tonal'
  const bar = useRef<HTMLSpanElement>(null)
  const stop = useRef<(() => void) | null>(null)
  const token = useRef(0) // a new run, Stop or unmount bumps it; a getUserMedia that resolves late checks it
  const [lines, setLines] = useState<string[]>([])
  const add = (text: string) => setLines(l => [...l.slice(-7), `${(performance.now() / 1000).toFixed(1)}s ${text}`])
  useEffect(() => () => { token.current++; stop.current?.() }, [])
  const run = async (simulated: boolean) => {
    stop.current?.()
    const mine = ++token.current
    const context = new AudioContext()
    let stream: MediaStream
    let cleanup = () => {}
    if (simulated) {
      // 0.3 s of nothing, 1.5 s of tone, then silence: the detector must report speech, then the cutoff after silenceTimeoutMs.
      const osc = context.createOscillator(), gain = context.createGain(), dest = context.createMediaStreamDestination()
      gain.gain.setValueAtTime(0, 0); gain.gain.setValueAtTime(0.3, context.currentTime + 0.3); gain.gain.setValueAtTime(0, context.currentTime + 1.8)
      osc.connect(gain).connect(dest); osc.start()
      stream = dest.stream
      cleanup = () => osc.stop()
    } else {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch { add('microphone refused'); void context.close(); return }
      if (mine !== token.current) { stream.getTracks().forEach(t => t.stop()); void context.close(); return }
      cleanup = () => stream.getTracks().forEach(t => t.stop())
    }
    add(simulated ? 'simulated turn started' : 'listening to the microphone')
    const detector = new VoiceActivityDetector(stream, VAD, {
      onLevel: rms => { if (bar.current) bar.current.style.width = `${Math.min(100, rms * 500)}%` },
      onSpeechStart: () => add('speech confirmed'),
      onSpeechEnd: reason => { add(`turn ended (${reason})`); end() },
      onNoSpeech: () => { add('no speech: cancelled'); end() },
    })
    const end = () => { detector.dispose(); cleanup(); void context.close(); stop.current = null; if (bar.current) bar.current.style.width = '0' }
    stop.current = end
  }
  return (
    <fieldset><legend>End-of-turn detection (VAD)</legend>
      <p className="lab-hint">Level against the threshold ({VAD.speechThreshold}), settings from VAD in otto.config.ts.</p>
      <div className="lab-meter" aria-hidden="true" style={{ position: 'relative', height: 10, background: 'rgba(128,128,128,.25)' }}>
        <span ref={bar} style={{ display: 'block', height: '100%', width: 0, background: 'currentColor' }} />
        <i style={{ position: 'absolute', top: 0, bottom: 0, left: `${VAD.speechThreshold * 500}%`, borderLeft: '2px solid red' }} />
      </div>
      <button type="button" className={btn} onClick={() => void run(true)}>Simulate a turn and a silence cutoff</button>
      <button type="button" className={btn} onClick={() => void run(false)}>Meter my microphone</button>
      <button type="button" className={btn} onClick={() => { token.current++; stop.current?.() }}>Stop</button>
      <p role="status" className="lab-hint">{lines.join(' | ')}</p>
    </fieldset>
  )
}

/** Measures first (#145): what the recorder asks the microphone for, what the browser actually applied, and the input level
 *  over a few seconds. Levels and settings only: no audio is kept or sent. */
const MIC_CHECK_MS = 3000
function MicCheckLab() {
  const btn = 'otto-btn otto-btn--tonal'
  const stop = useRef<(() => void) | null>(null)
  const token = useRef(0) // a new run, Stop or unmount bumps it; a getUserMedia that resolves late checks it
  const [lines, setLines] = useState<string[]>([])
  useEffect(() => () => { token.current++; stop.current?.() }, [])
  const run = async () => {
    stop.current?.()
    const mine = ++token.current
    setLines(['asking for the microphone with the same request as the voice panel...'])
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { ...MIC_REQUEST } }) } catch { setLines(['microphone refused or not available']); return }
    if (mine !== token.current) { stream.getTracks().forEach(t => t.stop()); return }
    const track = stream.getAudioTracks()[0]
    const settings = (track?.getSettings?.() ?? null) as MicSettings | null
    const supported = navigator.mediaDevices.getSupportedConstraints?.() ?? null
    const report = [
      `device: ${track?.label || 'unnamed'}`,
      ...compareConstraints(settings, supported).map(describeConstraint),
      `channels: ${String(settings?.channelCount ?? 'not reported')}, sample rate: ${String(settings?.sampleRate ?? 'not reported')}`,
    ]
    setLines([...report, `measuring the level for ${MIC_CHECK_MS / 1000} s: talk normally, then stay quiet...`])
    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    context.createMediaStreamSource(stream).connect(analyser)
    const buffer = new Float32Array(analyser.fftSize)
    const rms: number[] = []
    const timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buffer)
      let sum = 0
      for (const sample of buffer) sum += sample * sample
      rms.push(Math.sqrt(sum / buffer.length))
    }, 50)
    const end = (done: boolean) => {
      window.clearInterval(timer); window.clearTimeout(finish)
      stream.getTracks().forEach(t => t.stop()); void context.close(); stop.current = null
      if (done && mine === token.current) setLines([...report, describeLevels(summariseLevels(rms))])
    }
    const finish = window.setTimeout(() => end(true), MIC_CHECK_MS)
    stop.current = () => end(false)
  }
  return (
    <fieldset><legend>Microphone check</legend>
      <p className="lab-hint">Asks for the microphone the way the voice panel does and reports which processing the browser really applied (echo cancellation, noise suppression, auto gain) and the level. Use it first in the desktop app on Zorin, before changing any threshold.</p>
      <button type="button" className={btn} onClick={() => void run()}>Check my microphone</button>
      <button type="button" className={btn} onClick={() => { token.current++; stop.current?.(); setLines([]) }}>Stop</button>
      <ul role="status" aria-label="Microphone check result" className="lab-hint">{lines.map(line => <li key={line}>{line}</li>)}</ul>
    </fieldset>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Lab /></StrictMode>)
