// Friction on the page's forms, as signals for the friction judge (friction.ts). Shell (listens to the document).
//
//   const stop = observeFriction(guide, { settings: () => config.guidance })
//
// What it sees, passively (the host wires nothing):
//   - a refused submit: the browser's own validation (`invalid` events, one per field: counted once per form), or a
//     submit after which the form has a field marked aria-invalid="true" (the app's own validation);
//   - a submit that went through: the form's failures are forgotten;
//   - a stall: focus on a field marked invalid, with no typing for `stallMs`.
// The target offered is the first invalid field's guidance target ([data-otto-target] around it), else the form's own.
// Private fields and forms ([data-otto-private], passwords, payment) are never looked at. While a guided task runs, its
// steps are the guidance: no offers. Off unless `proactiveHelpEnabled`: then nothing is even looked at.

import type { GuideSettings, OttoGuide } from './guide'
import { createFrictionJudge, type FrictionSignal } from './friction'
import { isPrivateElement } from './hidden'

export type FrictionObserverOptions = {
  settings: () => GuideSettings
  now?: () => number
  /** Hear why help was offered (the lab). */
  onHelp?: (why: string, target: string) => void
}

const FIELD = 'input, select, textarea'
const isInvalid = (e: Element) => {
  if (e.getAttribute('aria-invalid') === 'true') return true
  try { return e.matches(':user-invalid') } catch { return false }
}
const targetOf = (e: Element | null) => e?.closest('[data-otto-target]')?.getAttribute('data-otto-target') ?? undefined
/** What Otto says on "Show me": the app's own error text (aria-errormessage), else the browser's. */
const messageOf = (e: Element) => {
  const ids = (e.getAttribute('aria-errormessage') ?? '').split(/\s+/).filter(Boolean)
  const own = ids.map(id => document.getElementById(id)).filter((x): x is HTMLElement => !!x && !isPrivateElement(x)).map(x => x.textContent ?? '').join(' ')
  const text = own.trim() || (e as HTMLInputElement).validationMessage || ''
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, 160) : undefined
}

export function observeFriction(guide: OttoGuide, options: FrictionObserverOptions): () => void {
  if (typeof document === 'undefined') return () => {}
  const now = options.now ?? (() => performance.now())
  const judge = createFrictionJudge(options.settings)
  const keys = new WeakMap<Element, string>()
  let next = 0
  const keyOf = (form: Element) => { let k = keys.get(form); if (!k) { k = `form-${next++}`; keys.set(form, k) } return k }
  const on = () => options.settings().proactiveHelpEnabled
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const later = (fn: () => void, ms: number) => { const t = setTimeout(() => { timers.delete(t); fn() }, ms); timers.add(t); return t }

  const send = (signal: FrictionSignal) => {
    const help = judge.consider(signal, now())
    if (!help || guide.task) return
    options.onHelp?.(help.why, help.target)
    const { why: _why, ...request } = help
    guide.show(request)
  }
  const failed = (form: Element, field: Element | null) => {
    const signal: FrictionSignal = { kind: 'failedSubmit', form: keyOf(form), target: targetOf(field) ?? targetOf(form) }
    const message = field ? messageOf(field) : undefined
    send(message ? { ...signal, message } : signal)
  }

  // Native validation: one `invalid` per bad field, all in the same task. Count the form once, with its first field.
  const pending = new Map<Element, Element>()
  const onInvalid = (e: Event) => {
    const field = e.target as Element
    const form = (field as HTMLInputElement).form ?? field.closest('form')
    if (!on() || !form || isPrivateElement(form) || isPrivateElement(field) || pending.has(form)) return
    pending.set(form, field)
    later(() => { pending.delete(form); failed(form, field) }, 0)
  }
  // The app's own validation: look once it has had its turn to mark fields.
  const onSubmit = (e: Event) => {
    const form = e.target as Element
    if (!on() || !(form instanceof HTMLFormElement) || isPrivateElement(form)) return
    later(() => {
      const bad = [...form.querySelectorAll(FIELD)].find(f => !isPrivateElement(f) && f.getAttribute('aria-invalid') === 'true') ?? null
      if (bad) failed(form, bad)
      else send({ kind: 'fixed', form: keyOf(form) })
    }, 0)
  }
  // A stall: sitting on a field marked invalid without typing.
  let stall: ReturnType<typeof setTimeout> | null = null
  const endStall = () => { if (stall) { clearTimeout(stall); timers.delete(stall); stall = null } }
  const onFocus = (e: Event) => {
    endStall()
    const field = e.target as Element
    if (!on() || !(field instanceof Element) || !field.matches(FIELD) || isPrivateElement(field) || !isInvalid(field)) return
    const form = (field as HTMLInputElement).form ?? field.closest('form') ?? field
    stall = later(() => {
      stall = null
      if (document.activeElement !== field || !isInvalid(field)) return
      const message = messageOf(field)
      const signal: FrictionSignal = { kind: 'stalled', form: keyOf(form), target: targetOf(field) ?? targetOf(form) }
      send(message ? { ...signal, message } : signal)
    }, options.settings().stallMs)
  }

  document.addEventListener('invalid', onInvalid, true)
  document.addEventListener('submit', onSubmit, true)
  document.addEventListener('focusin', onFocus, true)
  document.addEventListener('input', endStall, true)
  document.addEventListener('focusout', endStall, true)
  return () => {
    document.removeEventListener('invalid', onInvalid, true)
    document.removeEventListener('submit', onSubmit, true)
    document.removeEventListener('focusin', onFocus, true)
    document.removeEventListener('input', endStall, true)
    document.removeEventListener('focusout', endStall, true)
    timers.forEach(t => clearTimeout(t))
    timers.clear()
    pending.clear()
  }
}
