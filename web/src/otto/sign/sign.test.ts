import { describe, expect, it } from 'vitest'
import {
  SIGN_BUFFER_LIMITS, SIGN_IDLE, SIGN_MAX_SECONDS, SIGN_PREFIX, SIGN_TEXT_EMPTY, SIGN_TEXT_MAX_CHARS,
  applySignUpdate, cleanSignText, confirmSign, correctSign, discardSign, isLowConfidence, pushSignFrame,
  signConsent, signDecline, signStart, signStop, signStopReason, type SignFrame, type SignState, type SignStopReason,
} from './sign'
import type { SignRecognitionUpdate } from '../signRecognition'

// An update as the gate hands it over (the gate's own tests are in ../signRecognition.test.ts).
let seq = 0
const upd = (kind: 'partial' | 'final' | 'unrecognized', text = '', confidence?: number): SignRecognitionUpdate => {
  const base = { sessionId: 's', sequence: seq++, capturedAtMs: seq, utteranceId: 'u', language: 'xx' }
  return kind === 'unrecognized' ? { ...base, kind, reason: 'uncertain' } : { ...base, kind, text, ...(confidence === undefined ? {} : { confidence }) }
}

describe('cleanSignText', () => {
  it('strips control characters, collapses whitespace and bounds the text', () => {
    expect(cleanSignText('a\u0000b\nc\u0007\td')).toBe('a b c d')
    expect(cleanSignText('\u0001\u0002')).toBe('')
    expect(cleanSignText(7)).toBe('')
    expect(cleanSignText('x'.repeat(SIGN_TEXT_MAX_CHARS + 50)).length).toBe(SIGN_TEXT_MAX_CHARS)
  })
})

describe('capture lifecycle', () => {
  const active: SignState = { phase: 'active' }
  it('goes idle -> consenting -> active only through the notice', () => {
    expect(signStart(SIGN_IDLE, true)).toEqual({ phase: 'consenting' })
    expect(signConsent({ phase: 'consenting' })).toEqual({ phase: 'active' })
  })
  it('cannot start without a conversation, or consent from idle or stopped', () => {
    expect(signStart(SIGN_IDLE, false)).toEqual(SIGN_IDLE)
    expect(signConsent(SIGN_IDLE)).toEqual(SIGN_IDLE)
    const stopped: SignState = { phase: 'stopped', reason: 'failure' }
    expect(signConsent(stopped)).toEqual(stopped)
  })
  it('ignores start while consenting or active', () => {
    expect(signStart(active, true)).toEqual(active)
    expect(signStart({ phase: 'consenting' }, true)).toEqual({ phase: 'consenting' })
  })
  it('declining returns to idle', () => {
    expect(signDecline({ phase: 'consenting' })).toEqual(SIGN_IDLE)
    expect(signDecline(active)).toEqual(active)
  })
  it.each<SignStopReason>(['visitor_stop', 'conversation_end', 'hidden_tab', 'failure', 'session_limit'])('stops an active capture for %s', reason => {
    expect(signStop(active, reason)).toEqual({ phase: 'stopped', reason })
  })
  it('does not stop what is not running, except an unanswered notice at conversation end', () => {
    expect(signStop(SIGN_IDLE, 'visitor_stop')).toEqual(SIGN_IDLE)
    expect(signStop({ phase: 'consenting' }, 'hidden_tab')).toEqual({ phase: 'consenting' })
    expect(signStop({ phase: 'consenting' }, 'conversation_end')).toEqual(SIGN_IDLE)
    const stopped: SignState = { phase: 'stopped', reason: 'failure' }
    expect(signStop(stopped, 'visitor_stop')).toEqual(stopped)
  })
  it('never restarts by itself: stopped needs a new start and a new consent', () => {
    const stopped = signStop(active, 'hidden_tab')
    expect(signConsent(stopped).phase).toBe('stopped')
    const again = signStart(stopped, true)
    expect(again).toEqual({ phase: 'consenting' })
    expect(signStart(stopped, false)).toEqual(stopped)
  })
  it('picks the stop reason', () => {
    const ok = { open: true, visible: true, elapsedMs: 1000, failed: false }
    expect(signStopReason(ok)).toBeNull()
    expect(signStopReason({ ...ok, open: false })).toBe('conversation_end')
    expect(signStopReason({ ...ok, failed: true })).toBe('failure')
    expect(signStopReason({ ...ok, visible: false })).toBe('hidden_tab')
    expect(signStopReason({ ...ok, elapsedMs: SIGN_MAX_SECONDS * 1000 - 1 })).toBeNull()
    expect(signStopReason({ ...ok, elapsedMs: SIGN_MAX_SECONDS * 1000 })).toBe('session_limit')
    expect(signStopReason({ ...ok, open: false, failed: true })).toBe('conversation_end')
  })
})

describe('frame buffer', () => {
  const limits = { maxFrames: 3, maxSeconds: 2, maxBytes: 100 }
  const frame = (atMs: number, bytes = 10): SignFrame => ({ atMs, bytes, data: null })
  it('keeps frames within every limit and reports nothing discarded', () => {
    const r = pushSignFrame([frame(0), frame(100)], frame(200), limits)
    expect(r.frames).toHaveLength(3)
    expect(r.discarded).toBe(0)
  })
  it('drops the oldest past maxFrames', () => {
    const r = pushSignFrame([frame(0), frame(100), frame(200)], frame(300), limits)
    expect(r.frames.map(f => f.atMs)).toEqual([100, 200, 300])
    expect(r.discarded).toBe(1)
  })
  it('drops the oldest past maxSeconds', () => {
    const r = pushSignFrame([frame(0), frame(1000)], frame(2500), limits)
    expect(r.frames.map(f => f.atMs)).toEqual([1000, 2500])
    expect(r.discarded).toBe(1)
  })
  it('drops the oldest past maxBytes', () => {
    const r = pushSignFrame([frame(0, 50), frame(10, 40)], frame(20, 40), limits)
    expect(r.frames.map(f => f.atMs)).toEqual([10, 20])
    expect(r.discarded).toBe(1)
  })
  it('refuses a frame that alone is too big or invalid, and keeps the rest', () => {
    const held = [frame(0)]
    expect(pushSignFrame(held, frame(1, 101), limits)).toEqual({ frames: held, discarded: 1 })
    expect(pushSignFrame(held, frame(NaN), limits).discarded).toBe(1)
    expect(pushSignFrame(held, frame(1, -1), limits).discarded).toBe(1)
  })
  it('does not change its input', () => {
    const held = [frame(0), frame(100), frame(200)]
    pushSignFrame(held, frame(300), limits)
    expect(held).toHaveLength(3)
  })
  it('has default limits that are finite and bounded', () => {
    expect(SIGN_BUFFER_LIMITS.maxFrames).toBeGreaterThan(0)
    expect(SIGN_BUFFER_LIMITS.maxSeconds).toBeLessThanOrEqual(30)
    expect(SIGN_BUFFER_LIMITS.maxBytes).toBeLessThanOrEqual(64 * 1024 * 1024)
  })
})

describe('provisional text', () => {
  const partial = (text: string) => upd('partial', text)
  it('lets a partial replace a partial and never send it', () => {
    let s = applySignUpdate(SIGN_TEXT_EMPTY, partial('he'))
    s = applySignUpdate(s, partial('hello'))
    expect(s.partial?.text).toBe('hello')
    expect(s.pending).toBeNull()
    expect(confirmSign(s).outgoing).toBeNull()
  })
  it('turns a final into a pending result', () => {
    const s = applySignUpdate(applySignUpdate(SIGN_TEXT_EMPTY, partial('hel')), upd('final', 'hello', 0.3))
    expect(s.partial).toBeNull()
    expect(s.pending).toEqual({ text: 'hello', confidence: 0.3 })
    expect(isLowConfidence(s.pending!)).toBe(true)
    expect(isLowConfidence({ text: 'x', confidence: 0.9 })).toBe(false)
    expect(isLowConfidence({ text: 'x' })).toBe(false)
  })
  it('a later final replaces an unanswered one', () => {
    let s = applySignUpdate(SIGN_TEXT_EMPTY, upd('final', 'one'))
    s = applySignUpdate(s, upd('final', 'two'))
    expect(s.pending?.text).toBe('two')
  })
  it('confirm yields tagged text and clears the result', () => {
    const s = applySignUpdate(SIGN_TEXT_EMPTY, upd('final', 'where is billing'))
    const r = confirmSign(s)
    expect(r.outgoing).toBe(`${SIGN_PREFIX.confirmed}where is billing`)
    expect(r.state.pending).toBeNull()
    expect(confirmSign(r.state).outgoing).toBeNull()
  })
  it('correct yields tagged, cleaned text; an empty edit sends nothing and keeps the result', () => {
    const s = applySignUpdate(SIGN_TEXT_EMPTY, upd('final', 'wear is billing'))
    const r = correctSign(s, 'where is\u0000 billing')
    expect(r.outgoing).toBe(`${SIGN_PREFIX.corrected}where is billing`)
    expect(r.state.pending).toBeNull()
    const empty = correctSign(s, '  \u0001 ')
    expect(empty.outgoing).toBeNull()
    expect(empty.state.pending?.text).toBe('wear is billing')
    expect(correctSign(SIGN_TEXT_EMPTY, 'x').outgoing).toBeNull()
  })
  it('discard sends nothing', () => {
    const s = discardSign(applySignUpdate(SIGN_TEXT_EMPTY, upd('final', 'x')))
    expect(s.pending).toBeNull()
    expect(confirmSign(s).outgoing).toBeNull()
  })
  it('unrecognized clears the partial, keeps no words and never becomes text', () => {
    let s = applySignUpdate(SIGN_TEXT_EMPTY, partial('hel'))
    s = applySignUpdate(s, upd('unrecognized'))
    expect(s).toEqual({ partial: null, pending: null, unrecognized: true })
    expect(confirmSign(s).outgoing).toBeNull()
    expect(applySignUpdate(s, partial('hi')).unrecognized).toBe(false)
  })
  it('an unrecognized update leaves an earlier pending result for the visitor to answer', () => {
    const s = applySignUpdate(applySignUpdate(SIGN_TEXT_EMPTY, upd('final', 'a')), upd('unrecognized'))
    expect(s.pending?.text).toBe('a')
  })
})
