// Sign input (D-29), shell: binds the rules in sign.ts to an injected SignRecognizer, the page's visibility and the clock.
// Visitor-started only; stops on Stop, a hidden tab, the end of the conversation, a failure or the time limit; and never
// restarts by itself. Nothing is stored, logged or sent from here except text the visitor confirmed, through sendText
// (the same path as typing, so it can never run a tool: D-02). No frame leaves this file except to the recognizer.

import { useCallback, useEffect, useRef, useState } from 'react'
import { SignRecognitionGate } from '../signRecognition'
import {
  SIGN_IDLE, SIGN_MAX_SECONDS, SIGN_TEXT_EMPTY, applySignUpdate, confirmSign, correctSign, discardSign,
  pushSignFrame, signConsent, signDecline, signStart, signStop, signStopReason, type SignFrame, type SignFrameData,
  type SignRecognizer, type SignState, type SignStopReason, type SignText,
} from './sign'

let captureCount = 0
/** The capture that is running: the adapter that was actually started, and how to end it. Nothing else may be driven by it. */
interface Capture { adapter: SignRecognizer; end: (reason: SignStopReason) => void }

interface Options {
  /** A conversation is open: sign input may start, and it stops when this goes false. */
  open: boolean
  recognizer: SignRecognizer | null
  /** The existing text path (useVoiceAssistant.sendText). True when the message went. */
  sendText: (text: string) => boolean
}

export function useSign({ open, recognizer, sendText }: Options) {
  const [state, setState] = useState<SignState>(SIGN_IDLE)
  const [text, setTextState] = useState<SignText>(SIGN_TEXT_EMPTY)
  const stateRef = useRef(state)
  const textRef = useRef(text)
  const openRef = useRef(open)
  openRef.current = open
  const recognizerRef = useRef(recognizer)
  recognizerRef.current = recognizer
  const sendRef = useRef(sendText)
  sendRef.current = sendText
  const captureRef = useRef<Capture | null>(null)
  /** The recognizer the notice on screen was shown for. */
  const noticeFor = useRef<SignRecognizer | null>(null)
  /** The adapter of the running capture, kept in state so the "Signing is on" line (and Stop) can never vanish while it runs. */
  const [capturing, setCapturing] = useState<SignRecognizer | null>(null)
  const framesRef = useRef<SignFrame[]>([])

  const setSign = useCallback((next: SignState) => { stateRef.current = next; setState(next) }, [])
  const setText = useCallback((next: SignText) => { textRef.current = next; setTextState(next) }, [])

  /** Opens the notice. Nothing starts, and nothing is asked of the browser, until the visitor accepts it. */
  const ask = useCallback(() => {
    if (!recognizerRef.current) return
    noticeFor.current = recognizerRef.current
    setSign(signStart(stateRef.current, openRef.current))
  }, [setSign])
  const decline = useCallback(() => setSign(signDecline(stateRef.current)), [setSign])
  const stop = useCallback(() => captureRef.current?.end('visitor_stop'), [])

  /** The notice's Start button. Consent covers this one capture only. */
  const consent = useCallback(() => {
    const adapter = recognizerRef.current
    if (!adapter || captureRef.current || adapter !== noticeFor.current || stateRef.current.phase !== 'consenting' || !openRef.current) return
    setSign(signConsent(stateRef.current))
    setText(SIGN_TEXT_EMPTY)
    setCapturing(adapter)
    const startedAt = performance.now()
    let failed = false
    let timer = 0

    const end = (reason: SignStopReason) => {
      if (captureRef.current !== capture) return
      captureRef.current = null
      setCapturing(null)
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      framesRef.current = [] // the buffer never outlives the capture
      try { adapter.stop() } catch { /* stopping must not fail the stop */ }
      setSign(signStop(stateRef.current, reason))
      // What was read but not yet answered stays for the visitor, unless the conversation is gone; a half-read partial never does.
      setText(reason === 'conversation_end' ? SIGN_TEXT_EMPTY : { ...textRef.current, partial: null })
    }
    const check = () => {
      const reason = signStopReason({ open: openRef.current, visible: document.visibilityState === 'visible', elapsedMs: performance.now() - startedAt, failed })
      if (reason) end(reason)
    }
    const onVisibility = () => check()
    const capture: Capture = { adapter, end }
    captureRef.current = capture
    document.addEventListener('visibilitychange', onVisibility)
    // Ends directly: a timer that fires a hair early must not let the capture outlive its limit.
    timer = window.setTimeout(() => end('session_limit'), SIGN_MAX_SECONDS * 1000)
    try {
      // A new gate for each capture: another session's, another language's, repeated, reordered or post-final updates are dropped.
      const sessionId = `sign-${++captureCount}`
      const gate = new SignRecognitionGate(sessionId, adapter.language)
      adapter.start(sessionId, raw => {
        if (captureRef.current !== capture) return // late updates after a stop are dropped
        const result = gate.accept(raw)
        if (result.accepted) setText(applySignUpdate(textRef.current, result.update))
      })
    } catch {
      failed = true
      check()
    }
    check() // the tab may already be hidden
  }, [setSign, setText])

  /** For a host that captures frames: held in memory within the limits, handed to the recognizer, never anywhere else. */
  const pushFrame = useCallback((data: SignFrameData, bytes: number) => {
    const capture = captureRef.current
    if (!capture) return false
    framesRef.current = pushSignFrame(framesRef.current, { atMs: performance.now(), bytes, data }).frames
    // Always the adapter this capture started, never one swapped in since.
    try { capture.adapter.push?.(data) } catch { capture.end('failure') }
    return true
  }, [])

  const send = (result: { state: SignText; outgoing: string | null }) => {
    if (result.outgoing === null || !sendRef.current(result.outgoing)) return false
    setText(result.state)
    return true
  }
  const confirm = useCallback(() => send(confirmSign(textRef.current)), []) // eslint-disable-line react-hooks/exhaustive-deps
  const correct = useCallback((edited: string) => send(correctSign(textRef.current, edited)), []) // eslint-disable-line react-hooks/exhaustive-deps
  const discard = useCallback(() => setText(discardSign(textRef.current)), [setText])

  // The conversation ended: the capture ends with it, and an unanswered notice goes away.
  useEffect(() => {
    if (open) return
    captureRef.current?.end('conversation_end')
    if (stateRef.current.phase === 'consenting') setSign(signStop(stateRef.current, 'conversation_end'))
    setText(SIGN_TEXT_EMPTY)
  }, [open, setSign, setText])

  // The recognizer was removed or swapped mid-capture: the capture ends (the adapter that was started is stopped and the buffer
  // dropped) rather than going on with a different or missing reader and no indicator. An open notice for the old one goes away.
  useEffect(() => {
    const capture = captureRef.current
    if (capture && capture.adapter !== recognizer) capture.end('failure')
    if (stateRef.current.phase === 'consenting' && noticeFor.current !== recognizer) setSign(SIGN_IDLE)
  }, [recognizer, setSign])

  // Unmount: nothing keeps running (recognizer, timer, listener, buffer).
  useEffect(() => () => captureRef.current?.end('visitor_stop'), [])

  return { available: recognizer !== null, state, recognizer: capturing ?? recognizer, text, ask, decline, consent, stop, confirm, correct, discard, pushFrame }
}
