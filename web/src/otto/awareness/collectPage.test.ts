// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { collectPageContext, isSensitiveField, watchPageContext } from './collectPage'
import { cleanPageText, fitPageSnapshot, routeHash, type PageSnapshot } from './page'
import { listGuideTargets } from '../guidance/targets'

// happy-dom has no layout: give every element a box so nothing counts as hidden, except what a test hides itself.
const proto = Element.prototype as Element & { checkVisibility?: () => boolean }
proto.checkVisibility = function (this: Element) { return !this.closest('[hidden], [style*="display: none"]') }

afterEach(() => { document.body.innerHTML = ''; document.title = '' })

const page = (html: string) => { document.body.innerHTML = html }
const json = () => JSON.stringify(collectPageContext({ includeSelection: true }))

describe('collectPageContext: privacy', () => {
  it('never reads a typed value, from any field', () => {
    page(`<form aria-label="Sign up">
      <label for="e">Email</label><input id="e" name="email" value="ada@example.com" aria-invalid="true" aria-errormessage="ee">
      <p id="ee">Check the email address.</p>
      <textarea aria-label="Notes" aria-invalid="true">my secret note</textarea>
    </form>`)
    const out = json()
    expect(out).not.toContain('ada@example.com')
    expect(out).not.toContain('my secret note')
    expect(collectPageContext().errors).toEqual([
      { field: 'Email', message: 'Check the email address.' },
      { field: 'Notes', message: 'Not valid.' },
    ])
  })

  it('leaves out password, hidden and payment fields whole: label and error too', () => {
    page(`<form aria-label="Pay">
      <label for="p">Password hint-label</label><input id="p" type="password" value="hunter2" aria-invalid="true">
      <input type="hidden" name="csrf" value="tok123" aria-invalid="true">
      <label for="c">Card number label</label><input id="c" autocomplete="cc-number" value="4111111111111111" aria-invalid="true">
      <input aria-label="Expiry" autocomplete="billing cc-exp" aria-invalid="true">
      <input aria-label="City" aria-invalid="true">
    </form>`)
    const out = collectPageContext()
    expect(out.errors).toEqual([{ field: 'City', message: 'Not valid.' }])
    for (const secret of ['hunter2', 'tok123', '4111', 'Password hint-label', 'Card number label', 'Expiry']) expect(JSON.stringify(out)).not.toContain(secret)
    expect(isSensitiveField(document.querySelector('[autocomplete="billing cc-exp"]')!)).toBe(true)
  })

  it('nothing under data-otto-private, or Otto\'s own panel, reaches the snapshot', () => {
    page(`<main><h1>Account</h1>
      <section data-otto-private aria-label="Medical history"><h2>Diagnosis: private</h2><input aria-label="Allergy" aria-invalid="true">
        <button data-otto-target="secret-btn">Reveal</button></section>
      <section class="voice-assistant" aria-label="Voice guide"><h2>You said: my address is 1 Main St</h2></section>
      <button data-otto-target="save" data-otto-label="the Save button">Save</button>
    </main>`)
    const out = json()
    expect(out).toContain('h1: Account')
    for (const secret of ['Diagnosis', 'Medical history', 'Allergy', 'secret-btn', 'Reveal', '1 Main St', 'Voice guide']) expect(out).not.toContain(secret)
    expect(listGuideTargets().map(t => t.id)).toEqual(['save'])
  })

  it('the selection only when asked, and never from inside a field or a private area', () => {
    page('<p id="a">Shipping takes three days.</p><div data-otto-private><p id="b">Private words</p></div>')
    const select = (id: string) => {
      const range = document.createRange()
      range.selectNodeContents(document.getElementById(id)!)
      document.getSelection()!.removeAllRanges()
      document.getSelection()!.addRange(range)
    }
    select('a')
    expect(collectPageContext().selection).toBeUndefined()
    expect(collectPageContext({ includeSelection: true }).selection).toBe('Shipping takes three days.')
    select('b')
    expect(collectPageContext({ includeSelection: true }).selection).toBeUndefined()
  })

  it('no query string, and the hash only when it is a route', () => {
    expect(routeHash('#features')).toBe('#features')
    expect(routeHash('#/settings/billing')).toBe('#/settings/billing')
    expect(routeHash('#access_token=abc.def&state=1')).toBe('')
    expect(routeHash('#hello there')).toBe('')
  })
})

describe('collectPageContext: what it reads', () => {
  it('headings, named landmarks, open dialogs and expanded panels, targets with state', () => {
    document.title = 'Shop · Checkout'
    page(`<header><nav aria-label="Pages"><a href="#">Home</a></nav></header>
      <main><h1>Checkout</h1><h2 hidden>Gone</h2><h4>Too deep</h4><section><h2>Delivery</h2></section>
        <button aria-expanded="true" aria-label="Filters">Filters</button>
        <dialog open aria-label="Confirm order"><h2>Sure?</h2></dialog>
        <button data-otto-target="pay" data-otto-label="the Pay button" disabled>Pay</button>
        <button data-otto-target="menu" style="display: none">Menu</button>
      </main>`)
    const out = collectPageContext()
    expect(out.title).toBe('Shop · Checkout')
    expect(out.headings).toEqual(['h1: Checkout', 'h2: Delivery', 'h2: Sure?'])
    expect(out.landmarks).toEqual(['banner', 'navigation: Pages', 'main'])
    expect(out.open).toEqual(['expanded: Filters', 'dialog: Confirm order'])
    expect(out.targets).toEqual([{ id: 'pay', label: 'the Pay button', role: 'button', visible: expect.any(Boolean), disabled: true }])
    expect(listGuideTargets()).toEqual([{ id: 'pay', label: 'the Pay button', disabled: true }, { id: 'menu', label: 'Menu', hidden: true }])
  })

  it('an error inside a target names it, so the model can show where to fix it', () => {
    page('<div data-otto-target="email-row"><input aria-label="Email" aria-invalid="true" aria-describedby="h"><span id="h">Use name@site.</span></div>')
    expect(collectPageContext().errors).toEqual([{ field: 'Email', message: 'Use name@site.', target: 'email-row' }])
  })

  it('page text is cleaned: no control characters, one space, capped', () => {
    expect(cleanPageText('a\u0000b\n\n  c', 10)).toBe('a b c')
    expect(cleanPageText('x'.repeat(50), 8)).toBe('xxxxxxxx')
  })
})

describe('fitPageSnapshot: the budget', () => {
  const big: PageSnapshot = {
    path: '/', title: 'T',
    errors: [{ field: 'f', message: 'm' }, { field: 'g', message: 'n' }],
    open: ['dialog: A'],
    targets: Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, label: `target ${i}`, visible: true })),
    headings: Array.from({ length: 30 }, (_, i) => `h2: Section ${i}`),
    landmarks: ['main', 'navigation: Pages'],
    selection: 'some text',
  }
  it('keeps the most useful items: errors, then open, targets, headings, landmarks', () => {
    const out = fitPageSnapshot(big, { maxChars: 100_000, maxNodes: 14 })
    expect(out.errors).toHaveLength(2)
    expect(out.open).toHaveLength(1)
    expect(out.targets).toHaveLength(10)
    expect(out.headings).toHaveLength(1)
    expect(out.landmarks).toHaveLength(0)
    expect(out.selection).toBeUndefined()
    expect(out.truncated).toBe(true)
    expect(big.headings).toHaveLength(30) // not changed
  })
  it('cuts to the character budget from the bottom up, selection first', () => {
    const out = fitPageSnapshot(big, { maxChars: 400, maxNodes: 1000 })
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(400)
    expect(out.selection).toBeUndefined()
    expect(out.errors).toHaveLength(2)
    expect(out.truncated).toBe(true)
  })
  it('a snapshot within budget is untouched and not marked', () => {
    const small: PageSnapshot = { path: '/', title: 'T', headings: ['h1: A'], landmarks: [], open: [], errors: [] }
    expect(fitPageSnapshot(small, { maxChars: 3000, maxNodes: 60 })).toEqual(small)
  })
  it('the collector applies the config budget', () => {
    page(Array.from({ length: 80 }, (_, i) => `<h2>Heading number ${i}</h2>`).join(''))
    const out = collectPageContext({ maxNodes: 60, maxChars: 600 })
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(600)
    expect(out.truncated).toBe(true)
  })
})

describe('watchPageContext', () => {
  it('publishes now and after activity settles; stop() removes its listeners and timer', async () => {
    page('<h1>A</h1>')
    const seen: PageSnapshot[] = []
    const stop = watchPageContext(s => seen.push(s), () => ({}), 10)
    expect(seen).toHaveLength(1)
    document.body.dispatchEvent(new Event('click', { bubbles: true }))
    document.body.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise(r => setTimeout(r, 30))
    expect(seen).toHaveLength(2)
    stop()
    document.body.dispatchEvent(new Event('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 30))
    expect(seen).toHaveLength(2)
  })
})
