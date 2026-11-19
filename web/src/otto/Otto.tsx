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
// Put it once near the top of your app. `page` is the page the visitor is on now (an id from otto.config.ts PAGES).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ASSISTANT_NAME, LANGUAGE, OTTO_CONFIG, type PageId } from '../otto.config'
import { createOttoEvents, type OttoEvents } from './awareness/events'
import { OttoConfigProvider, useOttoConfig, type OttoConfig } from './config'
import type { StageController } from './movement/stage'
import { useOwnStage } from './movement/useStage'
import OttoDock from './OttoDock'
import type { IdleControls } from './OttoStage'
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
  page: PageId
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
  /** For tests and the lab: a stand-in for the server's WebSocket. */
  createSocket?: (url: string) => WebSocket
  /** For the lab: set to the idle lifecycle's controls. */
  idleControls?: { current: IdleControls | null }
}

const WAKE_TEXT: Partial<Record<WakeState, string>> = {
  listening: `Listening for “Hey ${ASSISTANT_NAME}”`,
  waiting: `“Hey ${ASSISTANT_NAME}” starts after you click or press a key`,
  blocked: `“Hey ${ASSISTANT_NAME}” is off: the browser refused the microphone. Allow it for this site, then turn it on again`,
}

export default function Otto({ config = OTTO_CONFIG, ...props }: Props) {
  return <OttoConfigProvider config={config}><OttoInner {...props} /></OttoConfigProvider>
}

function OttoInner({ page, onAction, showRobot = true, gestures, stage, events, createSocket, idleControls }: Omit<Props, 'config'>) {
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
    otto.notify({ type: 'section', topic: page })
  }, [page, otto])
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const assistant = useVoiceAssistant({ language: LANGUAGE, page, onAction, createSocket })
  const { status, sendText, start, stop, transcript, mouth, speech, interruptions } = assistant
  // Barge-ins too: whatever Otto was doing stops, and he nods (the config's gestures.onInterrupt) as he goes back to listening.
  useGestureTriggers(status, channel, interruptions)
  // Chirps follow the gestures (SOUND_SETTINGS.gestureCues), never the voice state directly.
  useGestureSounds(channel)
  /** What Otto is saying now, for the robot to mouth. */
  const line = status === 'speaking' ? ([...transcript].reverse().find(entry => entry.role === 'assistant')?.text ?? '') : ''

  const openPanel = useCallback(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Start loading the audio code now, so Start can make the speech player inside its own click.
    void loadAssistantAudio().catch(() => {})
    setOpen(true)
  }, [])

  const wakeQuestion = useRef<string | null>(null)
  const closePanel = useCallback(() => {
    wakeQuestion.current = null
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
    {wakeText && <div className="otto-wake" role="status">
      <span>{wakeText}</span>
      <button type="button" className="otto-btn otto-btn--text" onClick={() => setWakeOn(false)}>Turn off</button>
    </div>}
    {showRobot
      ? <OttoDock status={status} voiceOpen={open} line={line} mouth={mouth} speech={speech} gestures={channel} stage={ottoStage}
          events={otto} idleControls={idleControls} onTalk={open ? () => {} : openPanel} />
      : !open && <button type="button" className="otto-btn otto-btn--filled otto-open" onClick={openPanel}>Talk to {ASSISTANT_NAME}</button>}
    {open && <VoiceAssistant assistant={assistant} onClose={closePanel} />}
  </>
}
