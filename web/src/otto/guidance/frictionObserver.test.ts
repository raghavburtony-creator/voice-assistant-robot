// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOttoGuide, type GuideCommand, type GuideSettings } from './guide'
import { FRICTION_OFFER } from './friction'
import { observeFriction } from './frictionObserver'

const SETTINGS: GuideSettings = { cooldownMs: 20_000, offerFirst: true, approachMinDistance: 0.25, lookSeconds: 2.5, helpAfterFailures: 2, helpWindowMs: 60_000, proactiveHelpEnabled: true, frictionCooldownMs: 60_000, stallMs: 50 }
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

afterEach(() => { document.body.innerHTML = '' })

function setup(settings: Partial<GuideSettings> = {}) {
  document.body.innerHTML = `<form id="f" novalidate data-otto-target="signup">
    <div data-otto-target="email"><input id="email" aria-label="Email"></div>
    <input id="pw" type="password" aria-label="Password">
  </form>
  <form id="p" data-otto-private novalidate><input id="secret" aria-invalid="true"></form>`
  const guide = createOttoGuide()
  const shows: GuideCommand[] = []
  guide.subscribe(c => { if (c.type === 'show') shows.push(c) })
  let clock = 0
  const stop = observeFriction(guide, { settings: () => ({ ...SETTINGS, ...settings }), now: () => (clock += 1000) })
  return { guide, shows, stop, form: document.getElementById('f') as HTMLFormElement }
}
const submit = (form: HTMLFormElement) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))

describe('observeFriction', () => {
  it('two refused submits (the app marks the field invalid) offer help on that field, quietly', async () => {
    const { shows, form, stop } = setup()
    document.getElementById('email')!.setAttribute('aria-invalid', 'true')
    submit(form); await tick()
    expect(shows).toHaveLength(0)
    submit(form); await tick()
    expect(shows).toEqual([{ type: 'show', request: { target: 'email', reason: 'app', importance: 'normal', mode: 'offer', offer: FRICTION_OFFER } }])
    stop()
  })

  it('on "Show me", Otto says the app\'s own error text', async () => {
    const { shows, form, stop } = setup()
    const email = document.getElementById('email')!
    email.setAttribute('aria-invalid', 'true')
    email.setAttribute('aria-errormessage', 'email-error')
    email.insertAdjacentHTML('afterend', '<span id="email-error">Use name@example.com.</span>')
    submit(form); await tick(); submit(form); await tick()
    expect(shows[0]).toMatchObject({ request: { target: 'email', say: 'Use name@example.com.' } })
    stop()
  })

  it('the browser\'s own validation: many invalid events in one submit count once', async () => {
    const { shows, stop } = setup()
    const email = document.getElementById('email')!
    for (let i = 0; i < 3; i++) email.dispatchEvent(new Event('invalid', { bubbles: false }))
    await tick()
    expect(shows).toHaveLength(0)
    email.dispatchEvent(new Event('invalid')); await tick()
    expect(shows).toHaveLength(1)
    stop()
  })

  it('a submit that goes through forgets the failures', async () => {
    const { shows, form, stop } = setup()
    const email = document.getElementById('email')!
    email.setAttribute('aria-invalid', 'true'); submit(form); await tick()
    email.removeAttribute('aria-invalid'); submit(form); await tick()
    email.setAttribute('aria-invalid', 'true'); submit(form); await tick()
    expect(shows).toHaveLength(0)
    stop()
  })

  it('a stall on an invalid field offers help; typing ends the stall', async () => {
    const { shows, stop } = setup()
    const email = document.getElementById('email') as HTMLInputElement
    email.setAttribute('aria-invalid', 'true')
    email.focus()
    email.dispatchEvent(new Event('input', { bubbles: true }))
    await tick(80)
    expect(shows).toHaveLength(0)
    email.blur(); email.focus()
    await tick(80)
    expect(shows).toHaveLength(1)
    stop()
  })

  it('private forms, a running task, and the setting off: nothing', async () => {
    const off = setup({ proactiveHelpEnabled: false })
    document.getElementById('email')!.setAttribute('aria-invalid', 'true')
    submit(off.form); await tick(); submit(off.form); await tick()
    expect(off.shows).toHaveLength(0)
    off.stop()

    const priv = setup()
    const p = document.getElementById('p') as HTMLFormElement
    submit(p); await tick(); submit(p); await tick()
    expect(priv.shows).toHaveLength(0)
    priv.guide.startTask({ id: 't', title: 'T', steps: [{ id: 's', target: 'email', say: 'x' }] })
    priv.shows.length = 0
    document.getElementById('email')!.setAttribute('aria-invalid', 'true')
    submit(priv.form); await tick(); submit(priv.form); await tick()
    expect(priv.shows).toHaveLength(0)
    priv.stop()
  })

  it('stop() removes every listener and timer', () => {
    const add = vi.spyOn(document, 'addEventListener')
    const remove = vi.spyOn(document, 'removeEventListener')
    const { stop } = setup()
    stop()
    expect(remove.mock.calls.map(c => c[0]).sort()).toEqual(add.mock.calls.map(c => c[0]).sort())
    vi.restoreAllMocks()
  })
})
