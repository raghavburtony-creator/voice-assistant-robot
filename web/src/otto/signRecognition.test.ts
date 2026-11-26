import { describe, expect, it } from 'vitest'
import { confirmedTextForConversation, SIGN_TEXT_MAX_CHARS, SignRecognitionGate } from './signRecognition'
const update = (overrides: Record<string, unknown> = {}) => ({
  sessionId: 'session-a', sequence: 1, capturedAtMs: 100, utteranceId: 'utterance-a', language: 'xx',
  kind: 'partial', text: 'hello', ...overrides,
})
describe('SignRecognitionGate', () => {
  it('accepts partial then final updates and hands off final text only', () => {
    const gate = new SignRecognitionGate('session-a', 'xx')
    const partial = gate.accept(update())
    expect(partial.accepted).toBe(true)
    if (partial.accepted) expect(confirmedTextForConversation(partial.update)).toBeNull()
    const final = gate.accept(update({ sequence: 2, capturedAtMs: 120, kind: 'final', text: ' hello ' }))
    expect(final).toMatchObject({ accepted: true, update: { kind: 'final', text: 'hello' } })
    if (final.accepted) expect(confirmedTextForConversation(final.update)).toBe('hello')
  })
  it('rejects duplicate and out-of-order sequence numbers', () => {
    const gate = new SignRecognitionGate('session-a', 'xx')
    expect(gate.accept(update({ sequence: 3 })).accepted).toBe(true)
    expect(gate.accept(update({ sequence: 2 }))).toEqual({ accepted: false, reason: 'out_of_order' })
    expect(gate.accept(update({ sequence: 3 }))).toEqual({ accepted: false, reason: 'out_of_order' })
  })
  it('rejects cross-session and cross-language updates without advancing sequence', () => {
    const gate = new SignRecognitionGate('session-a', 'xx')
    expect(gate.accept(update({ sessionId: 'session-b' }))).toEqual({ accepted: false, reason: 'wrong_session' })
    expect(gate.accept(update({ language: 'yy' }))).toEqual({ accepted: false, reason: 'wrong_language' })
    expect(gate.accept(update()).accepted).toBe(true)
  })
  it('rejects backwards timestamps, malformed metadata and invalid text', () => {
    const gate = new SignRecognitionGate('session-a', 'xx')
    expect(gate.accept(update({ capturedAtMs: -1 }))).toMatchObject({ accepted: false, reason: 'malformed' })
    expect(gate.accept(update()).accepted).toBe(true)
    expect(gate.accept(update({ sequence: 2, capturedAtMs: 99 }))).toEqual({ accepted: false, reason: 'invalid_time' })
    expect(gate.accept(update({ sequence: 2, text: '  ' }))).toEqual({ accepted: false, reason: 'invalid_text' })
    expect(gate.accept(update({ sequence: 2, text: 'bad\ntext' }))).toEqual({ accepted: false, reason: 'invalid_text' })
  })
  it('rejects oversized text instead of truncating it', () => {
    const gate = new SignRecognitionGate('session-a', 'xx')
    expect(gate.accept(update({ text: 'x'.repeat(SIGN_TEXT_MAX_CHARS + 1) }))).toEqual({ accepted: false, reason: 'oversized_text' })
  })
  it('keeps final utterances terminal while allowing later utterances', () => {
    const gate = new SignRecognitionGate('session-a', 'xx')
    expect(gate.accept(update({ kind: 'final' })).accepted).toBe(true)
    expect(gate.accept(update({ sequence: 2, capturedAtMs: 110 }))).toEqual({ accepted: false, reason: 'after_final' })
    expect(gate.accept(update({ sequence: 2, capturedAtMs: 110, utteranceId: 'utterance-b' })).accepted).toBe(true)
  })
  it('represents unrecognized input without inventing text', () => {
    const gate = new SignRecognitionGate('session-a', 'xx')
    const result = gate.accept(update({ kind: 'unrecognized', reason: 'unsupported' }))
    expect(result).toMatchObject({ accepted: true, update: { kind: 'unrecognized', reason: 'unsupported' } })
    if (result.accepted) expect(confirmedTextForConversation(result.update)).toBeNull()
  })
  it('requires explicit configurable language identity', () => {
    expect(() => new SignRecognitionGate('session-a', '')).toThrow()
    expect(() => new SignRecognitionGate('../session', 'xx')).toThrow()
    expect(new SignRecognitionGate('session-a', 'ms-MU')).toBeInstanceOf(SignRecognitionGate)
  })
})
describe('confidence', () => {
  it('is kept when valid and makes the update malformed when not', () => {
    const gate = new SignRecognitionGate('session-a', 'xx')
    expect(gate.accept(update({ confidence: 0.4 }))).toMatchObject({ accepted: true, update: { confidence: 0.4 } })
    for (const [i, confidence] of [-0.1, 1.1, NaN, Infinity, '0.5', null].entries()) {
      expect(gate.accept(update({ sequence: 2 + i, capturedAtMs: 110 + i, confidence }))).toEqual({ accepted: false, reason: 'malformed' })
    }
    expect(gate.accept(update({ sequence: 20, capturedAtMs: 200, confidence: 0 }))).toMatchObject({ accepted: true, update: { confidence: 0 } })
  })
  it('never lets unrecognized carry text or confidence', () => {
    const gate = new SignRecognitionGate('session-a', 'xx')
    const r = gate.accept(update({ kind: 'unrecognized', reason: 'uncertain', text: 'fluent words', confidence: 0.1 }))
    expect(r.accepted && r.update).toEqual({ sessionId: 'session-a', sequence: 1, capturedAtMs: 100, utteranceId: 'utterance-a', language: 'xx', kind: 'unrecognized', reason: 'uncertain' })
  })
  it('rejects unknown kinds and non-objects', () => {
    const gate = new SignRecognitionGate('session-a', 'xx')
    for (const v of [null, undefined, 'x', 3, [], {}, update({ kind: 'other' }), update({ kind: 'unrecognized', reason: 'made-up' }), update({ text: 7 })]) {
      expect(gate.accept(v).accepted).toBe(false)
    }
  })
})
