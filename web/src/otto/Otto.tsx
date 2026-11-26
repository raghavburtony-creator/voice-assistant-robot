// Everything in one component: the voice conversation, the robot dock, the voice panel, "Hey Otto", and the keyboard shortcut (the config's hotkey).
//
//   <Otto page={page} onAction={action => { if (action.action === 'navigate') setPage(action.page) }} />
//
// Gestures: Otto waves, nods and so on by itself as the conversation goes. To trigger one yourself, pass a channel (create it once,
// outside render or in useMemo, so it stays the same object):
//
//   const gestures = useMemo(createGestureChannel, [])
//   <Otto gestures={gestures} ... />   then   gestures.play('celebrate')
//
// Movement: Otto walks aside for the panel and back by himself. To send him somewhere, pass a stage the same way:
//
//   const stage = useMemo(createOttoStage, [])
//   <Otto stage={stage} ... />   then   await stage.moveToElement('#cart'); gestures.play('celebrate')
//
// Put it once near the top of your app. `page` is the current static page id, or a runtime destination id the page reports.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ASSISTANT_NAME, LANGUAGE, OTTO_CONFIG, STORAGE_PREFIX } from '../otto.config'
import { busyContext, EMPTY_BUSY, nextBusy } from './awareness/busy'
import { createOttoEvents, type OttoEvents } from './awareness/events'
import type { OttoConfig } from './config'
import { OttoConfigProvider, useOttoConfig } from './useOttoConfig'
import type { StageController } from './movement/stage'
import { useOwnStage } from './movement/useStage'
import OttoDock from './OttoDock'
import type { IdleControls } from './OttoStage'
import { clearPageContext, publishContext } from './context'
import { getDesktopContext, isDesktopRuntime, setDesktopPermissionEnabled } from './desktop'
import { capList } from './contextBudget'
import type { IdleState } from './idle'
import type { RobotExpression } from './robot/robot'
import { createOttoGuide, type GuideEvent, type GuideRequest, type OttoGuide } from './guidance/guide'
import { attachGuide } from './guidance/runner'
import { resumeFrom, savedTask, taskProgress } from './guidance/task'
import { readStored, writeStoredText } from './storage'
import { createSpotlight } from './guidance/spotlight'
import { watchPageContext } from './awareness/collectPage'
import { toSpoken } from './gemini/channels'
import { findGuideTask, listGuideTargets, listGuideTasks, onGuideTargetsChange, onGuideTasksChange } from './guidance/targets'
import { observeGuidance } from './guidance/observe'
import { createGestureChannel, type GestureChannel } from './robot/gestures'
import { useGestureSounds } from './useGestureSounds'
import { useGestureTriggers } from './useGestureTriggers'
import type { AssistantAction } from './messages'
import { loadAssistantAudio, useVoiceAssistant } from './useVoiceAssistant'
import { useWakeWord, type WakeState } from './useWakeWord'
import VoiceAssistant from './VoiceAssistant'
import { useWakeSetting } from './wakeWord'
import './voice.css'

type Props = {
  /** The current static page id, or a valid runtime destination id (D-23). URLs and paths are refused. */
  page: string
  onAction: (action: AssistantAction) => void
  /** Hide the 3D robot and keep only the panel (for a small or low-power page). Default true. */
  showRobot?: boolean
  /** Lets your code play gestures (`gestures.play('celebrate')`). Optional; keep the same object between renders. */
  gestures?: GestureChannel
  /** Lets your code move Otto (`stage.moveToElement('#cart')`; createOttoStage). Optional; keep the same object. */
  stage?: StageController
  /** What happens in your app, for Otto to react to (`events.notify({ type: 'success', where: '#save' })`). Keep the same object. */
  events?: OttoEvents
  /** The mascot's settings (default: OTTO_CONFIG in otto.config.ts). */
  config?: OttoConfig
  /** Lets your code show things on the page (`guide.show('save')`, `guide.startTask(...)`). Optional; keep the same object. */
  guide?: OttoGuide
  /** For tests and the lab: a stand-in for the server's WebSocket. */
  createSocket?: (url: string) => WebSocket
  /** For the lab: set to the idle lifecycle's controls. */
  idleControls?: { current: IdleControls | null }
}

/** The running guided task, kept in this tab only (D-20). */
const GUIDE_TASK_KEY = `${STORAGE_PREFIX}:guide-task`

const WAKE_TEXT: Partial<Record<WakeState, string>> = {
  listening: `Listening for “Hey ${ASSISTANT_NAME}”`,
  waiting: `“Hey ${ASSISTANT_NAME}” starts after you click or press a key`,
  blocked: `“Hey ${ASSISTANT_NAME}” is off: the browser refused the microphone. Allow it for this site, then turn it on again`,
}

export default function Otto({ config = OTTO_CONFIG, ...props }: Props) {
  return <OttoConfigProvider config={config}><OttoInner {...props} /></OttoConfigProvider>
}

function OttoInner({ page, onAction, showRobot = true, gestures, stage, events, guide, createSocket, idleControls }: Omit<Props, 'config'>) {
  const ownChannel = useMemo(createGestureChannel, [])
  const channel = gestures ?? ownChannel
  const ownEvents = useMemo(createOttoEvents, [])
  const otto = events ?? ownEvents
  const config = useOttoConfig()
  const ottoStage = useOwnStage(stage, config)
  const SHORTCUT_KEY = config.hotkey
  // A new page is a new section: Otto notices (a curious glance, at most).
  const firstPage = useRef(true)
  useEffect(() => {
    if (firstPage.current) { firstPage.current = false; return }
    // A runtime destination is a new host-supported interface. Drop the previous page's
    // allow-lists immediately; the new page will publish its own registries below.
    clearPageContext()
    otto.notify({ type: 'section', topic: page })
  }, [page, otto])
  const [open, setOpen] = useState(false)
  const [desktopAwarenessEnabled, setDesktopAwarenessEnabled] = useState(false)
  // The permission lives in the desktop bridge module, so clear it when this owner unmounts.
  // This prevents a later Otto instance from inheriting access after the conversation UI is gone.
  useEffect(() => () => {
    setDesktopPermissionEnabled(false)
  }, [])
  const setDesktopAwareness = (enabled: boolean) => {
    setDesktopPermissionEnabled(enabled)
    setDesktopAwarenessEnabled(enabled)
  }
  const opener = useRef<HTMLElement | null>(null)
  const ownGuide = useMemo(createOttoGuide, [])
  const ottoGuide = guide ?? ownGuide
  // A voice 'guide' action (already checked against the page's targets) is shown by Otto's body; the model speaks.
  const handleAction = useCallback((action: AssistantAction) => {
    if (action.action === 'guide') ottoGuide.show({ target: action.target, reason: 'asked', say: null })
    // A voice 'task' action (checked against the page's offered tasks): Otto walks the visitor through it, step by step.
    if (action.action === 'task') { const spec = findGuideTask(action.task); if (spec) ottoGuide.startTask(spec) }
    // Cross-session resume is rechecked against the live task and step registry; an already-running local task wins.
    if (action.action === 'task_resume' && !ottoGuide.task) {
      const spec = findGuideTask(action.task)
      if (spec?.steps.some(step => step.id === action.step)) ottoGuide.startTask(spec, action.step)
    }
    // A voice 'task_move' (checked against the fixed moves): stop the running task, or go back or on a step.
    if (action.action === 'task_move') ottoGuide.move(action.move)
    onAction(action)
  }, [ottoGuide, onAction])
  const assistant = useVoiceAssistant({ language: LANGUAGE, page, onAction: handleAction, createSocket,
    onEnvironmental: event => otto.notify(event) })
  const { status, sendText, start, stop, transcript, mouth, speech, interruptions } = assistant
  // Barge-ins too: whatever Otto was doing stops, and he nods (the config's gestures.onInterrupt) as he goes back to listening.
  useGestureTriggers(status, channel, interruptions)
  // Chirps follow the gestures (SOUND_SETTINGS.gestureCues), never the voice state directly.
  useGestureSounds(channel)
  const conversing = status === 'connecting' || status === 'listening' || status === 'speaking'
  const conversingRef = useRef(conversing)
  conversingRef.current = conversing
  // Guide words shown as text (D-06): one live region, always mounted, only its text changes. A line stays until replaced or cleared.
  const [guideSay, setGuideSay] = useState('')
  const [guideFace, setGuideFace] = useState<RobotExpression | null>(null)
  const faceRef = useRef<RobotExpression | null>(null)
  const idleRef = useRef<IdleState>('awake')
  const [offer, setOffer] = useState<{ request: GuideRequest } | null>(null)
  const offerRef = useRef(offer)
  offerRef.current = offer
  const sayTimer = useRef<{ timer: number; done: (v: boolean) => void } | null>(null)
  const configRef = useRef(config)
  configRef.current = config
  useEffect(() => {
    const endSay = (finished: boolean) => {
      if (!sayTimer.current) return
      window.clearTimeout(sayTimer.current.timer)
      sayTimer.current.done(finished)
    }
    const clear = () => { endSay(false); setGuideSay(''); setOffer(null) }
    const speak = (text: string) => new Promise<boolean>(resolve => {
      endSay(false)
      setGuideSay(text)
      const done = (v: boolean) => { sayTimer.current = null; resolve(v) }
      // Read time: 5 s and then the reading speed. The line goes after that unless an offer waits.
      sayTimer.current = { timer: window.setTimeout(() => {
        done(true)
        if (!offerRef.current) setGuideSay('') // read time is over: the line goes (a newer line would have cancelled this timer)
      }, 5000 + (text.length / 15) * 1000), done }
    })
    // The ring around what Otto shows (point, approach, explain); Escape or a press dismisses it.
    const spotlight = createSpotlight()
    const detach = attachGuide(ottoGuide, {
      highlight: element => spotlight.show(element),
      stage: ottoStage,
      playGesture: name => channel.play(name),
      face: () => faceRef.current,
      setFace: face => { faceRef.current = face; setGuideFace(face) },
      speak,
      settings: () => configRef.current.guidance,
      situation: () => ({ idle: idleRef.current, conversing: conversingRef.current, movementEnabled: configRef.current.movement.movementEnabled }),
      ottoRect: () => { const x = ottoStage.frame.x; return { left: x, right: x, top: 0, bottom: 0 } },
    })
    const offFeed = ottoGuide.onEvent(event => {
      const e = event as GuideEvent | { type: 'offered'; target: string; request: GuideRequest }
      if (e.type === 'offered') setOffer({ request: e.request })
      else if (e.type === 'cancelled') clear()
      else if (e.type === 'shown' || e.type === 'step') setOffer(null)
    })
    const offStop = ottoGuide.subscribe(command => { if (command.type === 'stop') clear() })
    return () => { detach(); offFeed(); offStop(); endSay(false); spotlight.dispose() }
  }, [ottoGuide, ottoStage, channel])
  // Otto follows what the visitor does: their clicks and typing move a guided task on, and events that name a help
  // target may get an offer of help (guidance/observe.ts).
  useEffect(() => observeGuidance(ottoGuide, { events: otto, settings: () => configRef.current.guidance }), [ottoGuide, otto])
  const answerOffer = (yes: boolean) => {
    if (yes && offer) ottoGuide.show({ ...offer.request, reason: 'asked' })
    else setGuideSay('')
    setOffer(null)
  }
  // Tell the server which targets exist (it only lets the model show these), capped to the context budget (D-23).
  useEffect(() => {
    const publish = () => publishContext('guide_targets', capList('targets', listGuideTargets()))
    const frame = requestAnimationFrame(publish) // after the page has rendered
    const off = onGuideTargetsChange(publish)
    return () => { cancelAnimationFrame(frame); off() }
  }, [page])
  useEffect(() => () => publishContext('guide_targets', null), [])
  // And which guided tasks the page offers (the voice can start only these).
  useEffect(() => {
    const publish = () => publishContext('guide_tasks', capList('tasks', listGuideTasks()))
    publish()
    const off = onGuideTasksChange(publish)
    return () => { off(); publishContext('guide_tasks', null) }
  }, [page])
  // And the one running now, with the visitor's step, so "where was I?" gets a real answer; cleared when it ends.
  useEffect(() => {
    const off = ottoGuide.subscribe(command => { if (command.type === 'task') publishContext('guide_task_running', taskProgress(command.event, command.spec)) })
    return () => { off(); publishContext('guide_task_running', null) }
  }, [ottoGuide])
  // A running task survives a reload in this tab (D-20): its ids are kept on every step and forgotten when it ends. On
  // load it resumes only if the page still offers that task with that step; otherwise the entry goes and nothing resumes.
  useEffect(() => {
    const off = ottoGuide.subscribe(command => {
      if (command.type !== 'task') return
      const keep = savedTask(command.event, Date.now())
      writeStoredText(GUIDE_TASK_KEY, keep && JSON.stringify(keep), 'session')
    })
    // After the first frame, so the page has registered its tasks (a parent's effects run after Otto's).
    // shortcut: a task registered later than that (a lazy page) is not resumed; listen to onGuideTasksChange if one must be.
    const frame = requestAnimationFrame(() => {
      if (ottoGuide.task) return // the host started one itself: its steps are what is kept now
      const resume = resumeFrom(readStored(GUIDE_TASK_KEY, JSON.parse, null, 'session'), findGuideTask, Date.now())
      if (!resume) { writeStoredText(GUIDE_TASK_KEY, null, 'session'); return }
      ottoGuide.startTask(resume.spec, resume.step)
    })
    return () => { cancelAnimationFrame(frame); off() }
  }, [ottoGuide])
  // And what the app is busy with (its events.task handles, open and lately ended), so "is my upload done?" gets a real answer.
  useEffect(() => {
    let busy = EMPTY_BUSY
    const off = otto.subscribe(event => {
      const next = nextBusy(busy, event)
      if (next !== busy) {
        const terminal = ['success', 'failure', 'complete'].includes(event.type)
        const announce = terminal && event.topic === 'desktop-action'
          ? 'desktop_action_finished'
          : terminal && event.topic === 'desktop-movement'
            ? 'desktop_movement_finished'
            : undefined
        publishContext('app_tasks', busyContext(busy = next), announce)
      }
    })
    return () => { off(); publishContext('app_tasks', null) }
  }, [otto])
  // While a conversation is open: what the page shows, privacy-filtered and budgeted (awareness/collectPage.ts), and the
  // targets' current state (hidden, disabled), refreshed as the visitor works. Nothing is read or sent otherwise.
  const pageContext = config.pageContext
  useEffect(() => {
    if (!conversing || !pageContext.enabled) return
    let sentTargets = ''
    const stop = watchPageContext(snapshot => {
      publishContext('page', snapshot)
      const targets = JSON.stringify(capList('targets', listGuideTargets()))
      if (targets !== sentTargets) { sentTargets = targets; publishContext('guide_targets', JSON.parse(targets)) }
    }, () => ({ maxChars: pageContext.maxChars, maxNodes: pageContext.maxNodes, includeSelection: pageContext.includeSelection, includeTargets: false }))
    return () => { stop(); publishContext('page', null) }
  }, [conversing, pageContext.enabled, pageContext.maxChars, pageContext.maxNodes, pageContext.includeSelection])

  // Desktop metadata is sampled only during an open conversation and an explicit, visible opt-in.
  useEffect(() => {
    if (!conversing || !desktopAwarenessEnabled || !isDesktopRuntime()) {
      publishContext('desktop_context', null)
      return
    }
    let stopped = false
    let inFlight = false
    const refresh = async () => {
      if (inFlight) return
      inFlight = true
      try {
        const context = await getDesktopContext()
        if (!stopped) publishContext('desktop_context', context ? { enabled: true, ...context } : null)
      } catch {
        if (!stopped) publishContext('desktop_context', null)
      } finally {
        inFlight = false
      }
    }
    void refresh()
    const timer = window.setInterval(() => { void refresh() }, 2000)
    return () => {
      stopped = true
      window.clearInterval(timer)
      publishContext('desktop_context', null)
    }
  }, [conversing, desktopAwarenessEnabled])

  useEffect(() => {
    if (!conversing && desktopAwarenessEnabled) setDesktopAwareness(false)
  }, [conversing, desktopAwarenessEnabled])

  /** What Otto is saying now, for the robot to mouth: the spoken channel only (no URLs, code or markdown in the bubble). */
  const line = status === 'speaking' ? toSpoken([...transcript].reverse().find(entry => entry.role === 'assistant')?.text ?? '') : ''

  const openPanel = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Start loading the audio code now, so Start can make the speech player inside its own click.
    void loadAssistantAudio().catch(() => {})
    setOpen(true)
  }, [])

  const wakeQuestion = useRef<string | null>(null)
  const closePanel = useCallback(() => {
    wakeQuestion.current = null
    setDesktopAwareness(false)
    publishContext('desktop_context', null)
    stop()
    setOpen(false)
    opener.current?.focus()
  }, [stop])

  // "Hey Otto" (opt-in): opens the panel and starts talking. Words said after the phrase are asked once connected.
  const [wakeOn, setWakeOn] = useWakeSetting()
  const busy = status === 'connecting' || status === 'listening' || status === 'speaking'
  const wake = useWakeWord({
    enabled: wakeOn, paused: busy, lang: LANGUAGE,
    onWake: question => { wakeQuestion.current = question || null; openPanel(); start() },
  })
  useEffect(() => {
    if (status !== 'listening' || !wakeQuestion.current) return
    const question = wakeQuestion.current
    wakeQuestion.current = null
    sendText(question)
  }, [status, sendText])

  // Alt+<SHORTCUT_KEY> (Alt+O by default) opens and closes the panel, except while typing in a field.
  const toggle = useRef(() => {})
  useEffect(() => { toggle.current = () => (open ? closePanel() : openPanel()) })
  useEffect(() => {
    if (!SHORTCUT_KEY) return
    const code = /^\d$/.test(SHORTCUT_KEY) ? `Digit${SHORTCUT_KEY}` : `Key${SHORTCUT_KEY.toUpperCase()}`
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.code !== code) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]') && !target.closest('.voice-assistant')) return
      event.preventDefault()
      toggle.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [SHORTCUT_KEY])

  const wakeText = busy ? undefined : WAKE_TEXT[wake.state]

  return <>
    <div className="otto-notices" data-otto-private="">
      {wakeText && <div className="otto-wake" role="status">
        <span>{wakeText}</span>
        <button type="button" className="otto-btn otto-btn--text" onClick={() => setWakeOn(false)}>Turn off</button>
      </div>}
      <div className="otto-guide-say" role="status" aria-live="polite">{guideSay}</div>
      {offer && <div className="otto-guide-offer">
        <button type="button" className="otto-btn otto-btn--filled" onClick={() => answerOffer(true)}>Show me</button>
        <button type="button" className="otto-btn otto-btn--text" onClick={() => answerOffer(false)}>Not now</button>
      </div>}
    </div>
    {showRobot
      ? <OttoDock status={status} voiceOpen={open} line={line} mouth={mouth} speech={speech} gestures={channel} stage={ottoStage}
          events={otto} idleControls={idleControls} face={guideFace} onIdleState={state => { idleRef.current = state }} onTalk={open ? () => {} : openPanel} />
      : !open && <button type="button" className="otto-btn otto-btn--filled otto-open" onClick={openPanel}>Talk to {ASSISTANT_NAME}</button>}
    {open && <VoiceAssistant assistant={assistant} onClose={closePanel} desktopAwarenessEnabled={desktopAwarenessEnabled} onDesktopAwarenessChange={setDesktopAwareness} />}
  </>
}
