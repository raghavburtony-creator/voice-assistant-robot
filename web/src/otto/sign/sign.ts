// Sign-language input slice (D-29): the pure rules. No camera, no model, no network: what an update may look like, when a
// capture may run and when it must stop, how much video may sit in memory, and how a recognized result becomes text the
// visitor has confirmed. The shell is useSign.ts; the panel is SignInput.tsx. Q-09 stays open: no language or model is chosen.
//
//   idle|stopped --start()--> consenting --consent()--> active --any stop reason--> stopped (never restarts by itself)
//                                 \--decline()--> idle

import { SIGN_TEXT_MAX_CHARS, type SignRecognitionUpdate } from '../signRecognition'

/** Longest sign text kept, in characters (one limit, defined with the provider-neutral contract in ../signRecognition.ts). */
export { SIGN_TEXT_MAX_CHARS }
/** A result becomes a message only after the visitor confirms or corrects it. The prefix tells Otto, and the transcript, how it came in. */
export const SIGN_PREFIX = { confirmed: '[Signed, confirmed by visitor] ', corrected: '[Signed, corrected by visitor] ' } as const
/** A confidence below this is shown as low. The adapter's number is a hint, never a reason to skip the visitor's check. */
export const SIGN_LOW_CONFIDENCE = 0.5

// ---- updates ----------------------------------------------------------------------------------------------------------
// The update type and its validator are ../signRecognition.ts (SignRecognitionUpdate, SignRecognitionGate): one of each (D-19).

/** Control characters out, whitespace collapsed, cut to the limit. May return ''. Used for the visitor's own correction. */
export function cleanSignText(value: unknown): string {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, SIGN_TEXT_MAX_CHARS).trim()
}

// ---- capture lifecycle ------------------------------------------------------------------------------------------------

export type SignStopReason = 'visitor_stop' | 'conversation_end' | 'hidden_tab' | 'failure' | 'session_limit'
export type SignState =
  | { phase: 'idle' }
  | { phase: 'consenting' }
  | { phase: 'active' }
  | { phase: 'stopped'; reason: SignStopReason }

export const SIGN_IDLE: SignState = { phase: 'idle' }
/** One capture runs at most this long; the visitor starts a new one (with a new notice) to go on. */
export const SIGN_MAX_SECONDS = 120

/** The visitor asked to sign. Only while a conversation is open, and always through the notice: a stopped capture never goes straight back to active. */
export function signStart(state: SignState, conversationOpen: boolean): SignState {
  return conversationOpen && (state.phase === 'idle' || state.phase === 'stopped') ? { phase: 'consenting' } : state
}
/** The visitor accepted the notice. Consent is for this one capture: nothing is remembered. */
export function signConsent(state: SignState): SignState {
  return state.phase === 'consenting' ? { phase: 'active' } : state
}
export function signDecline(state: SignState): SignState {
  return state.phase === 'consenting' ? SIGN_IDLE : state
}
/** Stops a running capture; an unanswered notice simply goes away when the conversation ends. */
export function signStop(state: SignState, reason: SignStopReason): SignState {
  if (state.phase === 'active') return { phase: 'stopped', reason }
  if (state.phase === 'consenting' && reason === 'conversation_end') return SIGN_IDLE
  return state
}

export interface SignCheck {
  /** A conversation is open. */
  open: boolean
  /** The tab is visible. */
  visible: boolean
  /** Milliseconds since the capture became active. */
  elapsedMs: number
  /** The adapter failed. */
  failed: boolean
}
/** Why a running capture must stop now, or null while it may go on. */
export function signStopReason(check: SignCheck): SignStopReason | null {
  if (!check.open) return 'conversation_end'
  if (check.failed) return 'failure'
  if (check.elapsedMs >= SIGN_MAX_SECONDS * 1000) return 'session_limit'
  if (!check.visible) return 'hidden_tab'
  return null
}

// ---- the in-memory frame buffer ---------------------------------------------------------------------------------------

export interface SignBufferLimits { maxFrames: number; maxSeconds: number; maxBytes: number }
/** Bounds on video held in memory at once. The oldest goes first. Nothing here is ever written anywhere. */
export const SIGN_BUFFER_LIMITS: SignBufferLimits = { maxFrames: 150, maxSeconds: 10, maxBytes: 16 * 1024 * 1024 }
export interface SignFrame<T = unknown> { atMs: number; bytes: number; data: T }

/** Adds a frame and drops the oldest until the buffer fits every limit. `discarded` counts what was dropped (the new frame too, if it alone is too big or invalid). */
export function pushSignFrame<T>(frames: readonly SignFrame<T>[], frame: SignFrame<T>, limits: SignBufferLimits = SIGN_BUFFER_LIMITS): { frames: SignFrame<T>[]; discarded: number } {
  if (!Number.isFinite(frame.atMs) || !Number.isFinite(frame.bytes) || frame.bytes < 0 || frame.bytes > limits.maxBytes) return { frames: [...frames], discarded: 1 }
  const next = [...frames, frame]
  let bytes = next.reduce((sum, f) => sum + f.bytes, 0)
  let drop = 0
  while (drop < next.length - 1 && (next.length - drop > limits.maxFrames || bytes > limits.maxBytes || frame.atMs - next[drop].atMs > limits.maxSeconds * 1000)) {
    bytes -= next[drop].bytes
    drop++
  }
  return { frames: next.slice(drop), discarded: drop }
}

// ---- provisional text -------------------------------------------------------------------------------------------------

export interface SignDraft { text: string; confidence?: number }
export interface SignText {
  /** The latest partial: replaced by the next one, never sent. */
  partial: SignDraft | null
  /** A final result waiting for the visitor to confirm, correct or discard it. */
  pending: SignDraft | null
  /** The last update could not be read. Shown as a plain notice; no words are made up. */
  unrecognized: boolean
}
export const SIGN_TEXT_EMPTY: SignText = { partial: null, pending: null, unrecognized: false }

/** `update` has already passed the SignRecognitionGate. */
export function applySignUpdate(state: SignText, update: SignRecognitionUpdate): SignText {
  if (update.kind === 'unrecognized') return { ...state, partial: null, unrecognized: true }
  const draft: SignDraft = update.confidence === undefined ? { text: update.text } : { text: update.text, confidence: update.confidence }
  // A later final replaces one the visitor has not answered yet: only the latest reading is ever offered.
  return update.kind === 'partial' ? { ...state, partial: draft, unrecognized: false } : { partial: null, pending: draft, unrecognized: false }
}

export const isLowConfidence = (draft: SignDraft) => draft.confidence !== undefined && draft.confidence < SIGN_LOW_CONFIDENCE

/** The visitor confirmed the pending result as read. `outgoing` is null when nothing was pending. */
export function confirmSign(state: SignText): { state: SignText; outgoing: string | null } {
  return state.pending ? { state: { ...state, pending: null }, outgoing: SIGN_PREFIX.confirmed + state.pending.text } : { state, outgoing: null }
}
/** The visitor edited the pending result. An empty edit sends nothing and keeps the result pending. */
export function correctSign(state: SignText, text: string): { state: SignText; outgoing: string | null } {
  const clean = cleanSignText(text)
  return state.pending && clean ? { state: { ...state, pending: null }, outgoing: SIGN_PREFIX.corrected + clean } : { state, outgoing: null }
}
/** The visitor threw the pending result away. Nothing is sent. */
export function discardSign(state: SignText): SignText {
  return { ...state, pending: null }
}

// ---- the recognizer an app plugs in -----------------------------------------------------------------------------------

/** A frame a host hands the adapter; opaque to the kit. */
export type SignFrameData = unknown
/**
 * The provider-neutral adapter (D-29). The kit ships none. `processing` and `recipient` are read by the notice, so they
 * must be true: a remote adapter names who receives the video. `language` is the tag it reads, set by the app (the kit
 * picks none: Q-09). `start` receives the capture's session id, which every update must carry; `onUpdate` takes
 * untrusted values and useSign runs each through a SignRecognitionGate for that session and language.
 */
export interface SignRecognizer {
  readonly processing: 'local' | 'remote'
  /** Who receives the video (or the visitor's device, for local processing), in words for the notice. */
  readonly recipient: string
  /** The language tag the adapter reads (for example a BCP 47 tag). Updates in another language are dropped. */
  readonly language: string
  start(sessionId: string, onUpdate: (update: unknown) => void): void
  push?(frame: SignFrameData): void
  stop(): void
}
