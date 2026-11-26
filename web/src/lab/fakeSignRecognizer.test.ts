import { describe, expect, it, vi } from 'vitest'
import { SignRecognitionGate } from '../otto/signRecognition'
import { FAKE_SIGN_SCRIPTS, FakeSignRecognizer } from './fakeSignRecognizer'

// Ported from the removed FakeSignRecognitionAdapter tests: deterministic fixtures, and stopping is immediate.
describe('FakeSignRecognizer', () => {
  it('emits deterministic updates that pass the gate for the session it was started with', () => {
    vi.useFakeTimers()
    try {
      for (const steps of Object.values(FAKE_SIGN_SCRIPTS)) {
        const fake = new FakeSignRecognizer(steps)
        const gate = new SignRecognitionGate('sign-1', fake.language)
        const results: boolean[] = []
        fake.start('sign-1', raw => results.push(gate.accept(raw).accepted))
        vi.advanceTimersByTime(10_000)
        expect(results).toEqual(steps.map(() => true))
      }
    } finally { vi.useRealTimers() }
  })
  it('emits exactly the scripted fixtures, in order, tagged with its session and language', () => {
    vi.useFakeTimers()
    try {
      for (const steps of Object.values(FAKE_SIGN_SCRIPTS)) {
        const fake = new FakeSignRecognizer(steps)
        const received: unknown[] = []
        fake.start('sign-7', v => received.push(v))
        vi.advanceTimersByTime(10_000)
        expect(received).toEqual(steps.map((step, i) => ({
          ...step.update, sessionId: 'sign-7', sequence: i, capturedAtMs: steps.slice(0, i + 1).reduce((t, x) => t + x.afterMs, 0),
          utteranceId: 'utterance-1', language: 'und',
        })))
      }
    } finally { vi.useRealTimers() }
  })
  it('emits nothing more after it is stopped, even before its timers would fire', () => {
    vi.useFakeTimers()
    try {
      const fake = new FakeSignRecognizer()
      const received: unknown[] = []
      fake.start('sign-1', v => received.push(v))
      fake.stop()
      vi.advanceTimersByTime(10_000)
      expect(received).toEqual([])
    } finally { vi.useRealTimers() }
  })
  it('stops emitting immediately when stopped', () => {
    vi.useFakeTimers()
    try {
      const fake = new FakeSignRecognizer()
      const received: unknown[] = []
      fake.start('sign-1', v => { received.push(v); fake.stop() })
      vi.advanceTimersByTime(10_000)
      expect(received).toHaveLength(1)
      expect(fake.stops).toBe(1)
    } finally { vi.useRealTimers() }
  })
})
