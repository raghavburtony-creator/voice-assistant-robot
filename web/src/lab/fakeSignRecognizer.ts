// A scripted sign reader for the lab and tests ONLY (D-29, Q-09). It reads no video and calls no model: after start() it
// plays a fixed list of updates on timers, so the whole sign-input flow (notice, indicator, provisional text, confirm,
// correct, discard, Stop) can be tried without a recognizer. It lives under src/lab so no package entry point can reach it.

import type { SignRecognizer } from '../otto/sign/sign'

/** What a script says; the fake adds the session id, sequence, time, utterance and language the gate needs. */
export type FakeSignStep = { afterMs: number; update: { kind: 'partial' | 'final'; text: string; confidence?: number } | { kind: 'unrecognized'; reason?: 'uncertain' | 'unsupported' | 'not_recognized' } }
export type FakeSignScriptName = 'reads' | 'low-confidence' | 'unrecognized'

export const FAKE_SIGN_SCRIPTS: Record<FakeSignScriptName, readonly FakeSignStep[]> = {
  reads: [
    { afterMs: 400, update: { kind: 'partial', text: 'where', confidence: 0.4 } },
    { afterMs: 400, update: { kind: 'partial', text: 'where is billing', confidence: 0.6 } },
    { afterMs: 400, update: { kind: 'final', text: 'where is billing', confidence: 0.92 } },
  ],
  'low-confidence': [
    { afterMs: 400, update: { kind: 'partial', text: 'show me prices' } },
    { afterMs: 400, update: { kind: 'final', text: 'show me prices', confidence: 0.3 } },
  ],
  unrecognized: [
    { afterMs: 400, update: { kind: 'partial', text: 'something' } },
    { afterMs: 400, update: { kind: 'unrecognized', reason: 'uncertain' } },
  ],
}

export class FakeSignRecognizer implements SignRecognizer {
  readonly processing: 'local' | 'remote' = 'local'
  readonly recipient = 'the lab simulator (no camera is used)'
  /** 'und' is the BCP 47 tag for "undetermined": the lab claims no sign language (Q-09). */
  readonly language = 'und'
  /** How many times start and stop were called, for tests. */
  starts = 0
  stops = 0
  private timers: ReturnType<typeof setTimeout>[] = []
  private readonly steps: readonly FakeSignStep[]

  constructor(steps: readonly FakeSignStep[] = FAKE_SIGN_SCRIPTS.reads) { this.steps = steps }

  start(sessionId: string, onUpdate: (update: unknown) => void): void {
    this.starts++
    let at = 0
    let sequence = 0
    for (const step of this.steps) {
      at += step.afterMs
      const capturedAtMs = at
      const update = { ...step.update, sessionId, sequence: sequence++, capturedAtMs, utteranceId: 'utterance-1', language: this.language }
      this.timers.push(setTimeout(() => onUpdate(update), at))
    }
  }

  stop(): void {
    this.stops++
    this.timers.forEach(clearTimeout)
    this.timers = []
  }
}
