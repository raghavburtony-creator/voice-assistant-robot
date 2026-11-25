import { describe, expect, it } from 'vitest'
import { confirmedTextForConversation, FakeSignRecognitionAdapter, SIGN_TEXT_MAX_CHARS, SignRecognitionGate } from './signRecognition'
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
describe('FakeSignRecognitionAdapter', () => {
  it('emits deterministic partial, correction, final and unrecognized fixtures', () => {
    const fixtures = [update(), update({ sequence: 2, text: 'corrected' }), update({ sequence: 3, kind: 'final', text: 'final' }), update({ sequence: 4, utteranceId: 'utterance-b', kind: 'unrecognized', reason: 'uncertain' })]
    const received: unknown[] = []
    new FakeSignRecognitionAdapter(fixtures).run(value => received.push(value))
    expect(received).toEqual(fixtures)
  })
  it('stops emitting immediately when stopped by a consumer', () => {
    const adapter = new FakeSignRecognitionAdapter([update(), update({ sequence: 2 })])
    const received: unknown[] = []
    adapter.run(value => { received.push(value); adapter.stop() })
    expect(received).toHaveLength(1)
    adapter.run(value => received.push(value))
    expect(received).toHaveLength(1)
  })
})
