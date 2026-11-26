// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeSignRecognizer } from '../../lab/fakeSignRecognizer'
import { SIGN_MAX_SECONDS, SIGN_PREFIX, type SignRecognizer } from './sign'
import { useSign } from './useSign'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type Sign = ReturnType<typeof useSign>
let current: Sign
let root: Root
let container: HTMLElement

function Probe({ open, recognizer, sendText }: { open: boolean; recognizer: SignRecognizer | null; sendText: (t: string) => boolean }): ReactElement | null {
  current = useSign({ open, recognizer, sendText })
  return null
}
const render = (props: { open: boolean; recognizer: SignRecognizer | null; sendText: (t: string) => boolean }) =>
  act(() => { root.render(createElement(Probe, props)) })
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  act(() => { document.dispatchEvent(new Event('visibilitychange')) })
}
const tick = (ms: number) => act(() => { vi.advanceTimersByTime(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  setVisibility('visible')
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.useRealTimers()
})

/** A hand-driven reader: tests push raw updates as it would. */
function stub(overrides: Partial<SignRecognizer> = {}): SignRecognizer & { session: string; emit: (u: unknown) => void; stopped: number; pushed: unknown[] } {
  let emit: (u: unknown) => void = () => {}
  const r = {
    processing: 'local' as const, recipient: 'test', language: 'xx', session: '', stopped: 0, pushed: [] as unknown[],
    start(sessionId: string, cb: (u: unknown) => void) { r.session = sessionId; emit = cb },
    push(f: unknown) { r.pushed.push(f) },
    stop() { r.stopped++ },
    emit: (u: unknown) => emit(u),
    ...overrides,
  }
  return r
}
const raw = (r: { session: string }, over: Record<string, unknown> = {}) =>
  ({ sessionId: r.session, sequence: 1, capturedAtMs: 10, utteranceId: 'u1', language: 'xx', kind: 'partial', text: 'hi', ...over })

async function startActive(recognizer: FakeSignRecognizer, sendText = vi.fn(() => true)) {
  render({ open: true, recognizer, sendText })
  act(() => current.ask())
  expect(current.state.phase).toBe('consenting')
  expect(recognizer.starts).toBe(0) // nothing runs before the visitor accepts the notice
  act(() => current.consent())
  expect(current.state.phase).toBe('active')
  return sendText
}

describe('useSign (D-29)', () => {
  it('does nothing without a recognizer', () => {
    render({ open: true, recognizer: null, sendText: () => true })
    act(() => current.ask())
    expect(current.state.phase).toBe('idle')
    expect(current.available).toBe(false)
  })

  it('does not ask while no conversation is open', () => {
    render({ open: false, recognizer: new FakeSignRecognizer(), sendText: () => true })
    act(() => current.ask())
    expect(current.state.phase).toBe('idle')
  })

  it('declining starts nothing', () => {
    const r = new FakeSignRecognizer()
    render({ open: true, recognizer: r, sendText: () => true })
    act(() => current.ask())
    act(() => current.decline())
    expect(current.state.phase).toBe('idle')
    expect(r.starts).toBe(0)
  })

  it('shows partial then pending, and sends only after confirm, tagged, through sendText', async () => {
    const r = new FakeSignRecognizer()
    const sendText = await startActive(r)
    tick(400)
    expect(current.text.partial?.text).toBe('where')
    tick(400)
    expect(current.text.partial?.text).toBe('where is billing')
    tick(400)
    expect(current.text.pending?.text).toBe('where is billing')
    expect(sendText).not.toHaveBeenCalled()
    act(() => { current.confirm() })
    expect(sendText).toHaveBeenCalledWith(`${SIGN_PREFIX.confirmed}where is billing`)
    expect(current.text.pending).toBeNull()
  })

  it('sends the corrected text, and nothing on discard', async () => {
    const r = new FakeSignRecognizer()
    const sendText = await startActive(r)
    tick(1200)
    act(() => { current.correct('where is the invoice page') })
    expect(sendText).toHaveBeenCalledWith(`${SIGN_PREFIX.corrected}where is the invoice page`)
    const r2 = new FakeSignRecognizer()
    const send2 = vi.fn(() => true)
    act(() => root.unmount())
    root = createRoot(container)
    render({ open: true, recognizer: r2, sendText: send2 })
    act(() => current.ask())
    act(() => current.consent())
    tick(1200)
    act(() => current.discard())
    act(() => { current.confirm() })
    expect(send2).not.toHaveBeenCalled()
  })

  it('keeps a result pending when the message cannot be sent', async () => {
    const r = new FakeSignRecognizer()
    await startActive(r, vi.fn(() => false))
    tick(1200)
    act(() => { current.confirm() })
    expect(current.text.pending?.text).toBe('where is billing')
  })

  it('runs updates through a gate for this capture: wrong session, language, order and after-final are dropped', () => {
    const r = stub()
    render({ open: true, recognizer: r, sendText: () => true })
    act(() => current.ask())
    act(() => current.consent())
    expect(r.session).toMatch(/^sign-\d+$/)
    act(() => r.emit(raw(r, { sequence: 1 })))
    expect(current.text.partial?.text).toBe('hi')
    act(() => r.emit(raw(r, { sequence: 2, text: 'other session', sessionId: 'sign-999' })))
    act(() => r.emit(raw(r, { sequence: 2, text: 'other language', language: 'yy' })))
    act(() => r.emit(raw(r, { sequence: 1, text: 'replayed' })))
    expect(current.text.partial?.text).toBe('hi')
    act(() => r.emit(raw(r, { sequence: 2, kind: 'final', text: 'done', confidence: 0.9 })))
    expect(current.text.pending).toEqual({ text: 'done', confidence: 0.9 })
    act(() => r.emit(raw(r, { sequence: 3, kind: 'final', text: 'after final' })))
    expect(current.text.pending?.text).toBe('done')
  })

  it('a new capture gets a new session id, and the old one is not accepted', () => {
    const r = stub()
    render({ open: true, recognizer: r, sendText: () => true })
    act(() => current.ask()); act(() => current.consent())
    const first = r.session
    act(() => current.stop())
    act(() => current.ask()); act(() => current.consent())
    expect(r.session).not.toBe(first)
    act(() => r.emit(raw({ session: first })))
    expect(current.text.partial).toBeNull()
    act(() => r.emit(raw(r)))
    expect(current.text.partial?.text).toBe('hi')
  })

  it('drops malformed updates', async () => {
    const r = stub()
    render({ open: true, recognizer: r, sendText: () => true })
    act(() => current.ask())
    act(() => current.consent())
    act(() => r.emit(raw(r, { kind: 'final', text: 'x', confidence: 7 })))
    act(() => r.emit('nope'))
    expect(current.text.pending).toBeNull()
  })

  it('ends the capture as a failure when the recognizer goes away mid-capture, and stops the adapter that started', () => {
    const a = stub()
    render({ open: true, recognizer: a, sendText: () => true })
    act(() => current.ask()); act(() => current.consent())
    act(() => a.emit(raw(a)))
    expect(current.text.partial).not.toBeNull()
    expect(current.recognizer).toBe(a)
    render({ open: true, recognizer: null, sendText: () => true })
    expect(current.state).toEqual({ phase: 'stopped', reason: 'failure' })
    expect(a.stopped).toBe(1)
    expect(current.text.partial).toBeNull()
    expect(current.pushFrame('late', 1)).toBe(false)
    act(() => a.emit(raw(a, { sequence: 2, kind: 'final', text: 'late' })))
    expect(current.text.pending).toBeNull()
  })

  it('ends the capture when the recognizer is swapped; frames never reach the new one', () => {
    const a = stub()
    const b = stub()
    render({ open: true, recognizer: a, sendText: () => true })
    act(() => current.ask()); act(() => current.consent())
    act(() => { current.pushFrame('one', 1) })
    render({ open: true, recognizer: b, sendText: () => true })
    expect(current.state).toEqual({ phase: 'stopped', reason: 'failure' })
    expect(a.stopped).toBe(1)
    expect(b.stopped).toBe(0)
    expect(current.pushFrame('two', 1)).toBe(false)
    expect(a.pushed).toEqual(['one'])
    expect(b.pushed).toEqual([])
    expect(b.session).toBe('') // the new reader was never started
  })

  it('keeps reporting the started recognizer while the capture runs, so the indicator cannot be hidden', () => {
    const a = stub()
    render({ open: true, recognizer: a, sendText: () => true })
    act(() => current.ask()); act(() => current.consent())
    expect(current.recognizer).toBe(a)
    render({ open: true, recognizer: null, sendText: () => true })
    expect(current.recognizer).toBeNull() // once ended there is nothing to show as running
  })

  it('an open notice goes away if the recognizer changes before the visitor accepts it', () => {
    const a = stub()
    const b = stub()
    render({ open: true, recognizer: a, sendText: () => true })
    act(() => current.ask())
    render({ open: true, recognizer: b, sendText: () => true })
    expect(current.state.phase).toBe('idle')
    act(() => current.consent())
    expect(current.state.phase).toBe('idle')
    expect(b.session).toBe('')
  })

  it('stops with a failure when the language tag is invalid (the gate cannot be built)', () => {
    const r = stub({ language: '' })
    render({ open: true, recognizer: r, sendText: () => true })
    act(() => current.ask()); act(() => current.consent())
    expect(current.state).toEqual({ phase: 'stopped', reason: 'failure' })
    expect(r.session).toBe('')
    expect(r.stopped).toBe(1)
  })

  it('Stop stops the recognizer, ignores late updates and never restarts by itself', async () => {
    const r = new FakeSignRecognizer()
    await startActive(r)
    tick(400)
    act(() => current.stop())
    expect(current.state).toEqual({ phase: 'stopped', reason: 'visitor_stop' })
    expect(r.stops).toBe(1)
    expect(current.text.partial).toBeNull()
    tick(5000)
    expect(current.text.pending).toBeNull()
    expect(r.starts).toBe(1)
    act(() => current.consent()) // a stale Start press does not restart it
    expect(current.state.phase).toBe('stopped')
    act(() => current.ask())
    expect(current.state.phase).toBe('consenting') // a new start needs a new notice
  })

  it('stops when the tab is hidden', async () => {
    const r = new FakeSignRecognizer()
    await startActive(r)
    setVisibility('hidden')
    expect(current.state).toEqual({ phase: 'stopped', reason: 'hidden_tab' })
    expect(r.stops).toBe(1)
    setVisibility('visible')
    expect(current.state.phase).toBe('stopped')
  })

  it('stops when the conversation ends and clears the words', async () => {
    const r = new FakeSignRecognizer()
    await startActive(r)
    tick(1200)
    render({ open: false, recognizer: r, sendText: () => true })
    expect(current.state).toEqual({ phase: 'stopped', reason: 'conversation_end' })
    expect(current.text.pending).toBeNull()
    expect(r.stops).toBe(1)
  })

  it('an unanswered notice goes away when the conversation ends', () => {
    const r = new FakeSignRecognizer()
    render({ open: true, recognizer: r, sendText: () => true })
    act(() => current.ask())
    render({ open: false, recognizer: r, sendText: () => true })
    expect(current.state.phase).toBe('idle')
  })

  it('stops at the session limit', async () => {
    const r = new FakeSignRecognizer([])
    await startActive(r)
    tick(SIGN_MAX_SECONDS * 1000 - 1)
    expect(current.state.phase).toBe('active')
    tick(1)
    expect(current.state).toEqual({ phase: 'stopped', reason: 'session_limit' })
  })

  it('stops with a failure when the recognizer throws on start, and when push throws', () => {
    const bad: SignRecognizer = stub({ processing: 'remote', start: () => { throw new Error('boom') } })
    render({ open: true, recognizer: bad, sendText: () => true })
    act(() => current.ask())
    act(() => current.consent())
    expect(current.state).toEqual({ phase: 'stopped', reason: 'failure' })
    const pushes: SignRecognizer = stub({ push: () => { throw new Error('boom') } })
    render({ open: true, recognizer: pushes, sendText: () => true })
    act(() => current.ask())
    act(() => current.consent())
    act(() => { current.pushFrame('frame', 10) })
    expect(current.state).toEqual({ phase: 'stopped', reason: 'failure' })
  })

  it('hands frames to the recognizer only while active', async () => {
    const pushed: unknown[] = []
    const r: SignRecognizer = stub({ push: f => { pushed.push(f) } })
    render({ open: true, recognizer: r, sendText: () => true })
    expect(current.pushFrame('early', 1)).toBe(false)
    act(() => current.ask())
    act(() => current.consent())
    act(() => { current.pushFrame('a', 1) })
    act(() => current.stop())
    expect(current.pushFrame('late', 1)).toBe(false)
    expect(pushed).toEqual(['a'])
  })

  it('removes its listener and stops the recognizer on unmount', async () => {
    const r = new FakeSignRecognizer()
    await startActive(r)
    const remove = vi.spyOn(document, 'removeEventListener')
    act(() => root.unmount())
    expect(r.stops).toBe(1)
    expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    root = createRoot(container)
  })
})
