// Live voice conversation with Otto, over the server's /api/v1/voice/live WebSocket.
//
// The server holds the Gemini session and runs every tool. The only things it can ask this page to do are the actions in
// messages.ts (open a page, run a command), and each one is checked again here, because it arrives from a model.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Recorder, SpeechClock, SpeechPlayer } from './audio'
import {
  readAnswerLength, readMicConsent, readMicTalk, saveAnswerLength, saveMicConsent, saveMicTalk,
  type AnswerLength, type MicConsent, type MicTalk,
} from './consent'
import { currentContext, subscribeContext, type ContextUpdate } from './context'
import type { MouthSource } from './mouth'
import { apiBase, ASSISTANT_NAME, BARGE_IN, COMMAND_LABELS, PAGES } from '../otto.config'
import { findGuideTarget, findGuideTask } from './guidance/targets'
import { parseServerMessage, toAssistantAction, type AssistantAction, type AssistantCard } from './messages'

export type { AssistantAction } from './messages'
export type AssistantStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'ended' | 'error'
/** A line of the conversation, or a card Otto put in the panel (show_card: the visual channel, D-18). */
export type TranscriptEntry = { id: number; role: 'user' | 'assistant'; text: string; card?: undefined } | { id: number; role: 'card'; text: string; card: AssistantCard }

/** One thing Otto did, in plain words, and the action that takes it back (null when nothing can). */
export type ActionRecord = { id: number; label: string; inverse: AssistantAction | null }

/** The words and the undo for an action. `before` is the page that was showing. Add a case for each new kind of action. */
function describeAction(action: AssistantAction, before: string): { label: string; inverse: AssistantAction | null } {
  if (action.action === 'navigate') {
    const title = PAGES.find(item => item.id === action.page)?.title ?? action.page
    const back = PAGES.find(item => item.id === before)
    return { label: `Opened ${title}`, inverse: back && back.id !== action.page ? { action: 'navigate', page: back.id } : null }
  }
  if (action.action === 'guide') return { label: `Showed you: ${findGuideTarget(action.target)?.info.label ?? action.target}`, inverse: null }
  if (action.action === 'task') return { label: `Started: ${findGuideTask(action.task)?.title ?? action.task}`, inverse: null }
  if (action.action === 'card') return { label: `Put a card in the panel: ${action.card.title}`, inverse: null }
  return { label: COMMAND_LABELS[action.name], inverse: null }
}

/** WebSocket URL for a server path, on the API host or else this page's host. */
function socketUrl(path: string): string {
  const base = apiBase()
  const url = new URL(path, base || window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

const MAX_ACTION_RECORDS = 10

const MESSAGES = {
  connect: `${ASSISTANT_NAME} could not connect. The rest of the app still works.`,
  upstream: `${ASSISTANT_NAME} stopped unexpectedly. The rest of the app still works.`,
  busy: `${ASSISTANT_NAME} is busy with other conversations. Try again in a minute.`,
  time_limit: 'This conversation reached its time limit. Start again to keep talking.',
  service_ended: `${ASSISTANT_NAME} finished the conversation.`,
  closed: 'The conversation has ended.',
} as const

/** The words for a server error code. Codes with no entry (not_configured, bad_start) keep the server's own sentence. */
function errorMessage(code: string, serverText: string): string {
  if (code === 'busy' || code === 'upstream') return MESSAGES[code]
  return serverText || MESSAGES.upstream
}

/** A retry cannot help when the server is not set up or refused the start. */
export const NO_RETRY_CODES = ['not_configured', 'bad_start']

type Options = {
  language: string
  page: string
  onAction: (action: AssistantAction) => void
  /** For tests and the lab: make the socket (a stand-in for the server). Default: a real WebSocket. */
  createSocket?: (url: string) => WebSocket
}

const MAX_ENTRIES = 40
const MIC_HEARD_LEVEL = 0.02
/** One recorder frame (audio.ts FRAME_SAMPLES at 16 kHz). */
const FRAME_MS = 50
/** 5 seconds of 50 ms frames. */
const SILENT_WARNING_FRAMES = 100
/** Screens republish on every keystroke; forward at most this often per screen. */
const CONTEXT_DEBOUNCE_MS = 400

const SOCKET_PATH = '/api/v1/voice/live'

/** Used when the server's `ready` does not say (server/app/config.py, `max_session_seconds`). */
export const DEFAULT_LIMIT_SECONDS = 600
/** The warning comes this long before the limit. */
const WARNING_SECONDS = 60
/** An open mic with no speech for this long turns itself off. */
const OPEN_MIC_QUIET_MS = 60_000
/** A server still connecting after this long is probably waking up (free hosting tiers sleep). */
export const WAKING_AFTER_MS = 3_000

export const MIC_NOTES = {
  refused: `${ASSISTANT_NAME} cannot use the microphone. You can type your questions.`,
  quiet: 'The microphone was turned off after 60 seconds with no speech. Press Mute microphone again to speak.',
} as const

type AudioModule = typeof import('./audio')
/** The guide's speech player, recorder and meter. Not part of the first page: it loads the first time the guide is used. */
let audioModule: AudioModule | null = null
let audioLoad: Promise<AudioModule> | null = null

/**
 * Loads the guide's audio code once (a failed load is tried again next time). The App starts it when the panel opens,
 * so it has normally arrived before Start is pressed, and the speech player can still be made inside that click.
 */
export function loadAssistantAudio(): Promise<AudioModule> {
  audioLoad ??= import('./audio').then(
    loaded => { audioModule = loaded; return loaded },
    (error: unknown) => { audioLoad = null; throw error },
  )
  return audioLoad
}

export function useVoiceAssistant({ language, page, onAction, createSocket }: Options) {
  const [status, setStatus] = useState<AssistantStatus>('idle')
  /** Counts barge-ins (the visitor cut Otto off), so the robot can react to each one. */
  const [interruptions, setInterruptions] = useState(0)
  const socketFactory = useRef(createSocket)
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([])
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const [endedMessage, setEndedMessage] = useState('')
  const [actions, setActions] = useState<ActionRecord[]>([])
  const [micMuted, setMicMuted] = useState(false)
  const [micSilent, setMicSilent] = useState(false)
  const [micNote, setMicNote] = useState('')
  /** A recorder is running for this conversation. */
  const [micReady, setMicReady] = useState(false)
  const [consent, setConsent] = useState<MicConsent | null>(readMicConsent)
  /** Start was pressed (or the choice was cleared) while nothing was decided, so the panel asks. */
  const [consentAsked, setConsentAsked] = useState(false)
  const [talkMode, setTalkModeState] = useState<MicTalk>(readMicTalk)
  const [talking, setTalking] = useState(false)
  const [answerLength, setAnswerLengthState] = useState<AnswerLength>(readAnswerLength)
  const [limitWarning, setLimitWarning] = useState(false)
  const [waking, setWaking] = useState(false)
  /** The microphone's peak level, 0 to 1. A ref, so 20 updates a second re-render nothing; the meter reads it. */
  const levelRef = useRef(0)
  const socket = useRef<WebSocket | null>(null)
  const recorder = useRef<Recorder | null>(null)
  const player = useRef<SpeechPlayer | null>(null)
  const openEntry = useRef<{ role: TranscriptEntry['role']; id: number } | null>(null)
  const nextId = useRef(0)
  const actionRef = useRef(onAction)
  const pageRef = useRef(page)
  // Read by the recorder's frame callback and the timers, which outlive a render.
  const live = useRef(false)
  const mutedRef = useRef(false)
  const talkingRef = useRef(false)
  const talkModeRef = useRef(talkMode)
  const answerLengthRef = useRef(answerLength)
  const lastSound = useRef(0)
  const quietTimer = useRef<number | undefined>(undefined)
  const limitTimer = useRef<number | undefined>(undefined)
  const wakeTimer = useRef<number | undefined>(undefined)
  /** Moves on with every teardown, so a start still waiting for the audio code is dropped by Stop, a new start or unmount. */
  const openAttempt = useRef(0)
  useEffect(() => {
    actionRef.current = onAction
    pageRef.current = page
    socketFactory.current = createSocket
  })

  const entries = useRef<TranscriptEntry[]>([])
  const records = useRef<ActionRecord[]>([])
  const nextRecordId = useRef(0)

  // Built outside the state updater, which StrictMode runs twice.
  const record = useCallback((label: string, inverse: AssistantAction | null) => {
    records.current = [...records.current, { id: nextRecordId.current++, label, inverse }].slice(-MAX_ACTION_RECORDS)
    setActions(records.current)
  }, [])

  // Built outside the state updater, which StrictMode runs twice.
  const addCard = useCallback((card: AssistantCard) => {
    openEntry.current = null // the next words start a new line, below the card
    entries.current = [...entries.current, { id: nextId.current++, role: 'card' as const, text: card.title, card }].slice(-MAX_ENTRIES)
    setTranscript(entries.current)
  }, [])

  const addTranscript = useCallback((role: 'user' | 'assistant', text: string) => {
    const open = openEntry.current
    if (open && open.role === role) {
      entries.current = entries.current.map(entry => entry.id === open.id ? { ...entry, text: entry.text + text } : entry)
    } else {
      const id = nextId.current++
      openEntry.current = { role, id }
      entries.current = [...entries.current, { id, role, text: text.trimStart() }].slice(-MAX_ENTRIES)
    }
    setTranscript(entries.current)
  }, [])

  const stopContext = useRef<(() => void) | null>(null)
  const countInterruption = useCallback(() => setInterruptions(n => n + 1), [])
  // Set once interrupt() exists (below); the recorder's frame callback reads it.
  const interruptRef = useRef<() => boolean>(() => false)

  const forwardContext = useCallback((ws: WebSocket) => {
    const send = (update: ContextUpdate) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'context', ...update })) }
    currentContext().forEach(send)
    const pending = new Map<string, { update: ContextUpdate; timer: number }>()
    const unsubscribe = subscribeContext(update => {
      const waiting = pending.get(update.key)
      if (waiting) window.clearTimeout(waiting.timer)
      const merged = { ...update, announce: update.announce ?? waiting?.update.announce }
      pending.set(update.key, { update: merged, timer: window.setTimeout(() => { pending.delete(update.key); send(merged) }, CONTEXT_DEBOUNCE_MS) })
    })
    stopContext.current = () => { unsubscribe(); pending.forEach(item => window.clearTimeout(item.timer)) }
  }, [])

  const clearTimer = (timer: { current: number | undefined }) => {
    window.clearTimeout(timer.current)
    timer.current = undefined
  }

  /** Frames go to the server only while the listener means to talk: Talk pressed, or an open mic that is not muted. */
  const transmitting = useCallback(() => !!recorder.current && live.current
    && (talkModeRef.current === 'open' ? !mutedRef.current : talkingRef.current), [])

  const sendMicOff = () => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'mic_off' }))
  }

  const muteNow = () => {
    mutedRef.current = true
    setMicMuted(true)
    recorder.current?.setMuted(true)
    clearTimer(quietTimer)
    levelRef.current = 0
    sendMicOff()
  }

  /** Starts the 60 seconds of an open mic. Speech moves `lastSound` on, so the timer checks again instead of firing. */
  const armQuiet = useCallback(() => {
    clearTimer(quietTimer)
    if (talkModeRef.current !== 'open' || mutedRef.current || !recorder.current || !live.current) return
    lastSound.current = Date.now()
    const check = () => {
      const left = lastSound.current + OPEN_MIC_QUIET_MS - Date.now()
      if (left > 0) { quietTimer.current = window.setTimeout(check, left); return }
      quietTimer.current = undefined
      muteNow()
      setMicNote(MIC_NOTES.quiet)
    }
    quietTimer.current = window.setTimeout(check, OPEN_MIC_QUIET_MS)
  }, [])

  /** Stops the recorder and keeps the conversation going without it. */
  const stopMic = useCallback(() => {
    const wasSending = transmitting()
    recorder.current?.stop()
    recorder.current = null
    setMicReady(false)
    clearTimer(quietTimer)
    talkingRef.current = false
    setTalking(false)
    levelRef.current = 0
    if (wasSending) sendMicOff()
  }, [transmitting])

  const teardown = useCallback(() => {
    openAttempt.current++
    stopContext.current?.()
    stopContext.current = null
    live.current = false
    clearTimer(quietTimer)
    clearTimer(limitTimer)
    clearTimer(wakeTimer)
    setLimitWarning(false)
    setWaking(false)
    setMicReady(false)
    talkingRef.current = false
    setTalking(false)
    levelRef.current = 0
    recorder.current?.stop()
    recorder.current = null
    player.current?.close()
    player.current = null
    const ws = socket.current
    socket.current = null
    if (ws) {
      ws.onmessage = ws.onclose = ws.onerror = null
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'stop' }))
      ws.close()
    }
    openEntry.current = null
  }, [])

  const fail = useCallback((message: string, code = '') => {
    teardown()
    setError(message)
    setErrorCode(code)
    setStatus('error')
  }, [teardown])

  /**
   * Opens the microphone for the conversation on `ws`. Call from a click: the recorder's AudioContext is made inside the
   * gesture. A refused or missing microphone leaves the conversation open for typing.
   */
  const startMic = useCallback((ws: WebSocket, audio: AudioModule) => {
    setMicNote('')
    setMicSilent(false)
    let quietFrames = 0
    let heard = false
    // Barge-in: frames held back while Otto is audible, and how long the voice has been loud over him.
    const held: ArrayBuffer[] = []
    let loudFor = 0
    audio.startRecorder(frame => {
      if (socket.current !== ws || !live.current) return
      // Frames that are not sent are not counted for the meter or the silence warning either.
      if (!transmitting()) { levelRef.current = 0; held.length = 0; loudFor = 0; return }
      // Browser echo cancellation misses Web Audio playback, so the guide would hear itself and cut itself off: while
      // the guide is audible frames are held back, not sent. Only a voice clearly louder than Otto's echo, for a
      // moment (BARGE_IN), cuts him off; then the held frames go first, so the start of what was said is not lost.
      // While the guide is audible the listener is not "quiet", so the open mic's 60 seconds wait.
      if (player.current?.busy) {
        levelRef.current = 0
        lastSound.current = Date.now()
        if (!BARGE_IN.enabled || !player.current.playing) { held.length = 0; loudFor = 0; return }
        held.push(frame)
        if (held.length > BARGE_IN.keepFrames) held.shift()
        loudFor = audio.frameLevel(frame) >= BARGE_IN.level ? loudFor + FRAME_MS : 0
        if (loudFor < BARGE_IN.holdMs) return
        loudFor = 0
        interruptRef.current()
        if (ws.readyState === WebSocket.OPEN) held.forEach(f => ws.send(f))
        held.length = 0
        return
      }
      held.length = 0
      loudFor = 0
      if (ws.readyState === WebSocket.OPEN) ws.send(frame)
      const peak = audio.frameLevel(frame)
      levelRef.current = peak
      if (peak > MIC_HEARD_LEVEL) {
        lastSound.current = Date.now()
        if (!heard) { heard = true; setMicSilent(false) }
      } else if (!heard && ++quietFrames === SILENT_WARNING_FRAMES) setMicSilent(true)
    }).then(
      created => {
        if (socket.current !== ws) { created.stop(); return }
        recorder.current = created
        created.setMuted(mutedRef.current)
        setMicReady(true)
        armQuiet()
      },
      () => { if (socket.current === ws) setMicNote(MIC_NOTES.refused) },
    )
  }, [transmitting, armQuiet])

  // Must be called from a click: browsers only allow audio and microphone after a user gesture.
  const connect = useCallback((audio: AudioModule, withMic: boolean) => {
    teardown()
    setError('')
    setErrorCode('')
    setEndedMessage('')
    records.current = []
    setActions([])
    mutedRef.current = false
    setMicMuted(false)
    setMicNote('')
    setMicSilent(false)
    setStatus('connecting')
    // Everything that needs the click's user activation happens before the first await.
    const speech = new audio.SpeechPlayer()
    player.current = speech
    speech.onIdle = () => setStatus(current => current === 'speaking' ? 'listening' : current)
    void speech.resume()

    const url = socketUrl(SOCKET_PATH)
    const ws = socketFactory.current ? socketFactory.current(url) : new WebSocket(url)
    ws.binaryType = 'arraybuffer'
    socket.current = ws
    wakeTimer.current = window.setTimeout(() => { wakeTimer.current = undefined; setWaking(true) }, WAKING_AFTER_MS)
    if (withMic) startMic(ws, audio)
    ws.onopen = () => ws.send(JSON.stringify({ type: 'start', language, page: pageRef.current, detail: answerLengthRef.current }))
    ws.onerror = () => fail(MESSAGES.connect, 'connect')
    ws.onclose = () => {
      if (socket.current !== ws) return
      teardown()
      setEndedMessage(MESSAGES.closed)
      setStatus(current => current === 'error' ? current : 'ended')
    }
    ws.onmessage = event => {
      if (event.data instanceof ArrayBuffer) {
        player.current?.play(event.data)
        setStatus(current => current === 'listening' ? 'speaking' : current)
        return
      }
      if (typeof event.data !== 'string') return
      const message = parseServerMessage(event.data)
      if (!message) return
      switch (message.type) {
        case 'ready':
          // Accepted at once: the recorder's result only sets the mic state, so text works while it starts or after it fails.
          if (socket.current === ws) {
            live.current = true
            clearTimer(wakeTimer)
            setWaking(false)
            forwardContext(ws)
            setStatus('listening')
            const limit = message.limitSeconds ?? DEFAULT_LIMIT_SECONDS
            limitTimer.current = window.setTimeout(() => { limitTimer.current = undefined; setLimitWarning(true) },
              Math.max(0, limit - WARNING_SECONDS) * 1000)
            armQuiet()
          }
          break
        case 'transcript':
          addTranscript(message.role, message.text)
          break
        case 'interrupted':
          // The server heard the visitor over Otto (its own voice detection). If Otto was still audible here, that is
          // a barge-in; if this page already cut him off (interrupt()), it is the server catching up.
          if (player.current?.playing) countInterruption()
          player.current?.flush()
          player.current?.endTurn()
          openEntry.current = null
          break
        case 'turn_complete':
          player.current?.endTurn()
          openEntry.current = null
          break
        case 'action':
          {
            const action = toAssistantAction(message, id => findGuideTarget(id) !== null, id => findGuideTask(id) !== null)
            if (action) {
              const { label, inverse } = describeAction(action, pageRef.current)
              record(label, inverse)
              if (action.action === 'card') addCard(action.card)
              actionRef.current(action)
            }
          }
          break
        case 'error':
          {
            fail(errorMessage(message.code, message.message), message.code)
          }
          break
        case 'ended':
          teardown()
          setEndedMessage(message.reason === 'time_limit' || message.reason === 'service_ended' ? MESSAGES[message.reason] : MESSAGES.closed)
          setStatus('ended')
          break
      }
    }
  }, [language, teardown, fail, addTranscript, addCard, forwardContext, record, startMic, armQuiet])

  /**
   * Starts a conversation, from a click. With the audio code loaded (the usual case) everything happens inside the click.
   * A click that comes before the code has arrived shows "connecting" and goes on once it is here.
   */
  const open = useCallback((withMic: boolean) => {
    if (audioModule) { connect(audioModule, withMic); return }
    teardown()
    const attempt = openAttempt.current
    setError('')
    setErrorCode('')
    setEndedMessage('')
    setStatus('connecting')
    loadAssistantAudio().then(
      audio => { if (openAttempt.current === attempt) connect(audio, withMic) },
      () => { if (openAttempt.current === attempt) fail(MESSAGES.connect, 'connect') },
    )
  }, [connect, teardown, fail])

  /** Starts a conversation with the stored choice. With nothing decided, nothing connects: the panel asks first. */
  const start = useCallback(() => {
    if (consent === null) { setConsentAsked(true); return }
    open(consent === 'mic')
  }, [consent, open])

  /**
   * Stores the listener's choice. Call from the consent card's buttons (a click, for the microphone). With no
   * conversation open it starts one; during a text conversation "mic" opens the microphone in it.
   */
  const chooseConsent = useCallback((choice: MicConsent) => {
    saveMicConsent(choice)
    setConsent(choice)
    setConsentAsked(false)
    const ws = socket.current
    if (!ws) { open(choice === 'mic'); return }
    // A conversation is open, so the audio code has loaded.
    if (choice === 'mic' && !recorder.current && audioModule) startMic(ws, audioModule)
  }, [open, startMic])

  /** Forgets the choice and asks again. Any running microphone stops; a conversation keeps going by text. */
  const clearConsent = useCallback(() => {
    stopMic()
    saveMicConsent(null)
    setConsent(null)
    setConsentAsked(true)
  }, [stopMic])

  /** Ends this conversation and starts the next at once, from the warning's Continue (a click). The transcript stays. */
  const continueSession = useCallback(() => { open(consent === 'mic') }, [consent, open])

  const stop = useCallback(() => { teardown(); setStatus('idle') }, [teardown])

  /**
   * Barge-in: cuts Otto off mid-sentence and goes back to listening. What is playing stops at once (queued audio
   * stopped, disconnected and dropped), and the rest of the turn still arriving from the server is not played. The
   * conversation stays open. Called by the visitor's voice (BARGE_IN), Talk, "Stop speaking", or your code.
   */
  const interrupt = useCallback(() => {
    const speech = player.current
    if (!speech || (!speech.playing && status !== 'speaking')) return false
    const wasPlaying = speech.playing
    speech.interrupt()
    openEntry.current = null
    if (wasPlaying) countInterruption()
    setStatus(current => current === 'speaking' ? 'listening' : current)
    return true
  }, [status, countInterruption])
  useEffect(() => { interruptRef.current = interrupt })
  const stopSpeaking = interrupt

  /** Takes back the newest action by sending its inverse the way a server action is sent. Undoing is not itself undoable. */
  const undo = useCallback(() => {
    const latest = records.current[records.current.length - 1]
    if (!latest?.inverse) return
    record(`Undid: ${latest.label}`, null)
    actionRef.current(latest.inverse)
  }, [record])

  /** The open mic's Mute microphone. Unmuting starts its 60 seconds again. */
  const toggleMute = useCallback(() => {
    if (mutedRef.current) {
      mutedRef.current = false
      setMicMuted(false)
      recorder.current?.setMuted(false)
      setMicNote('')
      armQuiet()
    } else muteNow()
  }, [armQuiet])

  /** Push-to-talk's Talk: frames are sent while it is pressed. Releasing it ends the audio stream. Pressing it over Otto cuts him off. */
  const toggleTalk = useCallback(() => {
    const next = !talkingRef.current
    talkingRef.current = next
    setTalking(next)
    if (next) interruptRef.current()
    if (!next) { levelRef.current = 0; sendMicOff() }
  }, [])

  /** Push-to-talk or open mic. A switch mid-conversation starts the new mode with the mic not sending. */
  const setTalkMode = useCallback((mode: MicTalk) => {
    const wasSending = transmitting()
    saveMicTalk(mode)
    talkModeRef.current = mode
    setTalkModeState(mode)
    talkingRef.current = false
    setTalking(false)
    if (mode === 'open') { mutedRef.current = false; setMicMuted(false); recorder.current?.setMuted(false) }
    clearTimer(quietTimer)
    levelRef.current = 0
    if (wasSending) sendMicOff()
    armQuiet()
  }, [transmitting, armQuiet])

  /** Short or detailed answers, sent in the next conversation's `start`. */
  const setAnswerLength = useCallback((length: AnswerLength) => {
    saveAnswerLength(length)
    answerLengthRef.current = length
    setAnswerLengthState(length)
  }, [])

  const sendText = useCallback((text: string) => {
    const ws = socket.current
    if (!text.trim() || ws?.readyState !== WebSocket.OPEN) return false
    openEntry.current = null
    addTranscript('user', text.trim())
    openEntry.current = null
    ws.send(JSON.stringify({ type: 'text', text: text.trim() }))
    return true
  }, [addTranscript])

  useEffect(() => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'page', page }))
  }, [page])

  useEffect(() => teardown, [teardown])

  /** Otto's mouth: five bars (0 to 1) from the voice's speech bands, or null once quiet. Read it every frame; it renders nothing. */
  const mouth = useCallback<MouthSource>(() => player.current?.mouth() ?? null, [])
  /** How far this turn of Otto's speech has played (seconds played and received), for the speech bubble. */
  const speech = useCallback<SpeechClock>(() => player.current?.clock() ?? null, [])

  return {
    mouth, speech, interrupt, interruptions,
    status, transcript, error, errorCode, endedMessage, actions, micMuted, micSilent, micNote, micReady, levelRef,
    consent, consentAsked, talkMode, talking, answerLength, limitWarning, waking,
    start, stop, stopSpeaking, undo, toggleMute, toggleTalk, sendText, chooseConsent, clearConsent, continueSession, setTalkMode, setAnswerLength,
  }
}
