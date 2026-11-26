// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeSignRecognizer } from '../../lab/fakeSignRecognizer'
import type { SignRecognizer } from './sign'
import SignInput from './SignInput'
import { SignRecognizerProvider } from './useSignRecognizer'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { document.body.innerHTML = '' })

function mount(recognizer: FakeSignRecognizer | null) {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  act(() => root.render(createElement(SignRecognizerProvider, { recognizer }, createElement(SignInput, { open: true, sendText: () => true }))))
  return { el, root }
}

describe('SignInput', () => {
  it('renders nothing when no recognizer is plugged in (the kit ships none)', () => {
    const { el, root } = mount(null)
    expect(el.innerHTML).toBe('')
    act(() => root.unmount())
  })

  it('offers the button, then a notice that names the recipient, where it runs, the limits and no retention', () => {
    const { el, root } = mount(new FakeSignRecognizer())
    const button = [...el.querySelectorAll('button')].find(b => b.textContent?.startsWith('Sign to'))!
    act(() => button.click())
    const text = el.textContent ?? ''
    expect(text).toContain('the lab simulator')
    expect(text).toContain('on this device')
    expect(text).toContain('saves no video')
    expect(text).toContain('you will be asked again next time')
    expect(el.textContent).not.toContain('Signing is on')
    act(() => root.unmount())
  })
})

// ---- behaviour: announcement, focus, "Not sent", replaced readings, recognizer loss ---------------------------------------


type Reader = SignRecognizer & { session: string; emit: (u: unknown) => void; stopped: number }
function reader(): Reader {
  let emit: (u: unknown) => void = () => {}
  const r: Reader = {
    processing: 'local', recipient: 'a test reader', language: 'xx', session: '', stopped: 0,
    start(id, cb) { r.session = id; emit = cb },
    stop() { r.stopped++ },
    emit: u => emit(u),
  }
  return r
}
let seq = 0
const say = (r: Reader, kind: 'partial' | 'final', text: string) =>
  act(() => r.emit({ sessionId: r.session, sequence: seq++, capturedAtMs: seq, utteranceId: `u${seq}`, language: 'xx', kind, text }))

function setup(props: { open?: boolean; sendText?: (t: string) => boolean; recognizer?: Reader | null } = {}) {
  const el = document.createElement('div')
  document.body.append(el)
  const root = createRoot(el)
  const state = { open: true, sendText: (() => true) as (t: string) => boolean, recognizer: reader() as Reader | null, ...props }
  const draw = () => act(() => root.render(createElement(SignRecognizerProvider, { recognizer: state.recognizer },
    createElement('h2', { id: 'voice-assistant-title', tabIndex: -1 }, 'panel'),
    createElement(SignInput, { open: state.open, sendText: state.sendText }))))
  draw()
  const button = (name: string) => [...el.querySelectorAll('button')].find(b => b.textContent?.includes(name)) as HTMLButtonElement | undefined
  const click = (name: string) => { const b = button(name); expect(b, name).toBeTruthy(); act(() => b!.click()) }
  const status = () => el.querySelector('[role="status"].ui-visually-hidden')?.textContent ?? ''
  const rerender = (next: Partial<typeof state>) => { Object.assign(state, next); draw() }
  return { el, root, state, button, click, status, rerender }
}
const startSigning = (t: ReturnType<typeof setup>) => { t.click('Sign to'); t.click('Start signing') }

describe('SignInput behaviour', () => {
  it('moves focus through the visitor-started steps', () => {
    const t = setup()
    t.click('Sign to')
    expect(document.activeElement?.id).toBe('voice-sign-title')
    t.click('Start signing')
    expect(document.activeElement?.id).toBe('voice-sign-stop')
    t.click('Stop signing')
    expect(document.activeElement?.id).toBe('voice-sign-button')
    expect(t.status()).toBe('Signing stopped.')
    act(() => t.root.unmount())
  })

  it('announces a reading to check in the status line, and the line is there before the text changes', () => {
    const r = reader()
    const t = setup({ recognizer: r })
    const line = t.el.querySelector('[role="status"].ui-visually-hidden')
    expect(line).toBeTruthy()
    startSigning(t)
    expect(t.status()).toBe('Signing is on.')
    say(r, 'partial', 'where')
    expect(t.status()).toBe('Signing is on.') // a partial is never announced
    say(r, 'final', 'where is billing')
    expect(t.status()).toBe('Signing is on. A reading is ready to check: where is billing. Confirm, correct or discard it.')
    expect(t.el.querySelector('[role="status"].ui-visually-hidden')).toBe(line) // same node: a screen reader sees a change, not a new region
    act(() => t.root.unmount())
  })

  it('a stop in the background does not pull focus out of the correction field', () => {
    const r = reader()
    const t = setup({ recognizer: r })
    startSigning(t)
    say(r, 'final', 'where is billing')
    t.click('Correct')
    const input = t.el.querySelector<HTMLInputElement>('#voice-sign-edit')!
    expect(document.activeElement).toBe(input)
    t.rerender({ recognizer: null }) // the capture ends by itself (a failure)
    expect(t.el.textContent).toContain('Signing stopped because the sign reader failed')
    expect(document.activeElement).toBe(input)
    act(() => t.root.unmount())
  })

  it('a background stop moves focus only when the focused control went away with it', () => {
    const r = reader()
    const t = setup({ recognizer: r })
    startSigning(t)
    expect(document.activeElement?.id).toBe('voice-sign-stop')
    t.rerender({ recognizer: r, open: false })
    // the conversation ended: no sign button is left, so focus lands on the panel title, not the page body
    expect(document.activeElement?.id).toBe('voice-assistant-title')
    act(() => t.root.unmount())
  })

  it('focus does not stay on the page body when the conversation ends during the notice', () => {
    const t = setup()
    t.click('Sign to')
    expect(document.activeElement?.id).toBe('voice-sign-title')
    t.rerender({ open: false })
    expect(t.el.textContent).not.toContain('Sign to Otto?')
    expect(document.activeElement?.id).toBe('voice-assistant-title')
    act(() => t.root.unmount())
  })

  it('never hides "Signing is on" and Stop while a capture runs, even if the app drops the recognizer', () => {
    const r = reader()
    const t = setup({ recognizer: r })
    startSigning(t)
    t.rerender({ recognizer: null })
    // the hook ended the capture in the same pass: it is not left running with no indicator
    expect(r.stopped).toBe(1)
    expect(t.el.textContent).not.toContain('Signing is on')
    expect(t.el.textContent).toContain('Signing stopped because the sign reader failed')
    expect(t.status()).toContain('failed')
    act(() => t.root.unmount())
  })

  it('shows "Not sent, try again" when sendText refuses, keeps the reading pending, and sends on retry', () => {
    const r = reader()
    let accept = false
    const sent: string[] = []
    const t = setup({ recognizer: r, sendText: text => { if (accept) sent.push(text); return accept } })
    startSigning(t)
    say(r, 'final', 'where is billing')
    t.click('Confirm and send')
    expect(t.el.textContent).toContain('Not sent, try again')
    expect(t.el.textContent).toContain('where is billing')
    expect(t.button('Confirm and send')).toBeTruthy()
    accept = true
    t.click('Confirm and send')
    expect(sent).toEqual(['[Signed, confirmed by visitor] where is billing'])
    expect(t.el.textContent).not.toContain('Not sent')
    act(() => t.root.unmount())
  })

  it('shows "Not sent, try again" for a refused correction and stays in the edit', () => {
    const r = reader()
    const t = setup({ recognizer: r, sendText: () => false })
    startSigning(t)
    say(r, 'final', 'wear is billing')
    t.click('Correct')
    t.click('Send correction')
    expect(t.el.textContent).toContain('Not sent, try again')
    expect(t.el.querySelector('#voice-sign-edit')).toBeTruthy()
    act(() => t.root.unmount())
  })

  it('a newer final replaces the reading and ends the edit: the new reading is shown, the old draft is gone', () => {
    const r = reader()
    const t = setup({ recognizer: r })
    startSigning(t)
    say(r, 'final', 'first reading')
    t.click('Correct')
    expect(t.el.querySelector<HTMLInputElement>('#voice-sign-edit')!.value).toBe('first reading')
    say(r, 'final', 'second reading')
    expect(t.el.querySelector('#voice-sign-edit')).toBeNull()
    expect(t.el.textContent).toContain('second reading')
    expect(t.status()).toContain('second reading')
    t.click('Correct')
    expect(t.el.querySelector<HTMLInputElement>('#voice-sign-edit')!.value).toBe('second reading')
    act(() => t.root.unmount())
  })

  it('Back and Discard hand focus to the next useful control', () => {
    const r = reader()
    const t = setup({ recognizer: r })
    startSigning(t)
    say(r, 'final', 'x y')
    t.click('Correct')
    t.click('Back')
    expect(document.activeElement?.id).toBe('voice-sign-correct')
    t.click('Discard')
    expect(document.activeElement?.id).toBe('voice-sign-stop')
    act(() => t.root.unmount())
  })
})
