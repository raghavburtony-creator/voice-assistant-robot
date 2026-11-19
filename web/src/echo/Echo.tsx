// Everything in one component: the voice conversation, the robot dock, the voice panel, "Hey Echo", and Alt+E.
//
//   <Echo page={page} onAction={action => { if (action.action === 'navigate') setPage(action.page) }} />
//
// Put it once near the top of your app. `page` is the page the visitor is on now (an id from echo.config.ts PAGES).

import { useCallback, useEffect, useRef, useState } from 'react'
import { ASSISTANT_NAME, LANGUAGE, type PageId } from '../echo.config'
import EchoDock from './EchoDock'
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
}

const WAKE_TEXT: Partial<Record<WakeState, string>> = {
  listening: `Listening for “Hey ${ASSISTANT_NAME}”`,
  waiting: `“Hey ${ASSISTANT_NAME}” starts after you click or press a key`,
  blocked: `“Hey ${ASSISTANT_NAME}” is off: the browser refused the microphone. Allow it for this site, then turn it on again`,
}

export default function Echo({ page, onAction, showRobot = true }: Props) {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const assistant = useVoiceAssistant({ language: LANGUAGE, page, onAction })
  const { status, sendText, start, stop, transcript, speechBands } = assistant
  /** What Echo is saying now, for the robot to mouth. */
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

  // "Hey Echo" (opt-in): opens the panel and starts talking. Words said after the phrase are asked once connected.
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

  // Alt+E opens and closes the panel, except while typing in a field.
  const toggle = useRef(() => {})
  useEffect(() => { toggle.current = () => (open ? closePanel() : openPanel()) })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.code !== 'KeyE') return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]') && !target.closest('.voice-assistant')) return
      event.preventDefault()
      toggle.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const wakeText = busy ? undefined : WAKE_TEXT[wake.state]

  return <>
    {wakeText && <div className="echo-wake" role="status">
      <span>{wakeText}</span>
      <button type="button" className="echo-btn echo-btn--text" onClick={() => setWakeOn(false)}>Turn off</button>
    </div>}
    {showRobot
      ? <EchoDock status={status} voiceOpen={open} line={line} speechBands={speechBands} onTalk={open ? () => {} : openPanel} />
      : !open && <button type="button" className="echo-btn echo-btn--filled echo-open" onClick={openPanel}>Talk to {ASSISTANT_NAME}</button>}
    {open && <VoiceAssistant assistant={assistant} onClose={closePanel} />}
  </>
}
