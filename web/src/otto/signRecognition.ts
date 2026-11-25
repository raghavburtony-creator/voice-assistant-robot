// Provider-neutral sign-recognition contract (SIG-02, D-29).
// Text metadata only: no camera, network, storage or model dependency.
export const SIGN_TEXT_MAX_CHARS = 500
const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/
type Base = { sessionId: string; sequence: number; capturedAtMs: number; utteranceId: string; language: string }
export type SignRecognitionUpdate =
  | (Base & { kind: 'partial' | 'final'; text: string })
  | (Base & { kind: 'unrecognized'; reason: 'uncertain' | 'unsupported' | 'not_recognized' })
export type SignUpdateRejection = 'malformed' | 'wrong_session' | 'wrong_language' | 'out_of_order' | 'invalid_time' | 'invalid_text' | 'oversized_text' | 'after_final'
export type SignUpdateResult = { accepted: true; update: SignRecognitionUpdate } | { accepted: false; reason: SignUpdateRejection }
/** Validates untrusted adapter output for one explicitly configured session and language. */
export class SignRecognitionGate {
  private lastSequence = -1
  private lastCapturedAt = -1
  private readonly finalized = new Set<string>()
  readonly sessionId: string
  readonly language: string
  constructor(sessionId: string, language: string) {
    this.sessionId = sessionId
    this.language = language
    if (!ID.test(sessionId)) throw new TypeError('Invalid sign-recognition session id')
    if (!LANGUAGE.test(language)) throw new TypeError('Invalid sign-recognition language tag')
  }
  accept(value: unknown): SignUpdateResult {
    if (!record(value)) return { accepted: false, reason: 'malformed' }
    const { sessionId, sequence, capturedAtMs, utteranceId, language, kind } = value
    if (typeof sessionId !== 'string' || !ID.test(sessionId) || typeof utteranceId !== 'string' || !ID.test(utteranceId) ||
      typeof language !== 'string' || !LANGUAGE.test(language) || typeof sequence !== 'number' || !Number.isSafeInteger(sequence) ||
      typeof capturedAtMs !== 'number' || !Number.isFinite(capturedAtMs) || capturedAtMs < 0) return { accepted: false, reason: 'malformed' }
    if (sessionId !== this.sessionId) return { accepted: false, reason: 'wrong_session' }
    if (language !== this.language) return { accepted: false, reason: 'wrong_language' }
    if (sequence <= this.lastSequence) return { accepted: false, reason: 'out_of_order' }
    if (capturedAtMs < this.lastCapturedAt) return { accepted: false, reason: 'invalid_time' }
    if (this.finalized.has(utteranceId)) return { accepted: false, reason: 'after_final' }
    let update: SignRecognitionUpdate
    if (kind === 'partial' || kind === 'final') {
      if (typeof value.text !== 'string' || !value.text.trim()) return { accepted: false, reason: 'invalid_text' }
      if (value.text.length > SIGN_TEXT_MAX_CHARS) return { accepted: false, reason: 'oversized_text' }
      // eslint-disable-next-line no-control-regex
      if (/[\u0000-\u001F\u007F]/.test(value.text)) return { accepted: false, reason: 'invalid_text' }
      update = { sessionId, sequence, capturedAtMs, utteranceId, language, kind, text: value.text.trim() }
      if (kind === 'final') this.finalized.add(utteranceId)
    } else if (kind === 'unrecognized' && (value.reason === 'uncertain' || value.reason === 'unsupported' || value.reason === 'not_recognized')) {
      update = { sessionId, sequence, capturedAtMs, utteranceId, language, kind, reason: value.reason }
    } else return { accepted: false, reason: 'malformed' }
    this.lastSequence = sequence
    this.lastCapturedAt = capturedAtMs
    return { accepted: true, update }
  }
}
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
/** Only final results may enter the existing conversation input path. */
export function confirmedTextForConversation(update: SignRecognitionUpdate): string | null {
  return update.kind === 'final' ? update.text : null
}
export interface SignRecognitionAdapter { run(onUpdate: (update: unknown) => void): void; stop(): void }
/** Deterministic fixture adapter for tests; it has no capture or provider implementation. */
export class FakeSignRecognitionAdapter implements SignRecognitionAdapter {
  private stopped = false
  private readonly fixtures: readonly unknown[]
  constructor(fixtures: readonly unknown[]) { this.fixtures = fixtures }
  run(onUpdate: (update: unknown) => void): void {
    if (this.stopped) return
    for (const fixture of this.fixtures) { if (this.stopped) break; onUpdate(fixture) }
  }
  stop(): void { this.stopped = true }
}
