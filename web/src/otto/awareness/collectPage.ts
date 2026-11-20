// The page, as the voice model may see it. Shell (reads the DOM, only when called: SSR-safe). The shape, the text
// cleaning and the budget are core (page.ts).
//
//   const snapshot = collectPageContext({ maxChars: 3000, maxNodes: 60 })
//   // { path: '/#features', title, headings: ['h1: Features'], landmarks, open, errors: [{ field, message, target }], targets }
//
// Privacy, always (no option turns these off):
//   - nothing under [data-otto-private], or under Otto's own panel (the conversation is the visitor's own words);
//   - no password, hidden or payment (autocomplete="cc-*") field, not even its label or its error;
//   - no typed value from any field, ever: a field is its label and its error text;
//   - no query string, and the hash only when it looks like a route.
// The selected text is left out unless `includeSelection` (it can be anything, and it goes to a third party).

import { findGuideTarget, listGuideTargets } from '../guidance/targets'
import { isElementHidden, isPrivateElement } from '../guidance/hidden'
import { cleanPageText, fitPageSnapshot, PAGE_TEXT, routeHash, type PageBudget, type PageError, type PageSnapshot, type PageTarget } from './page'

export type CollectPageOptions = Partial<PageBudget> & {
  /** Default document. */
  root?: ParentNode
  /** Default false. */
  includeSelection?: boolean
  /** The page's guidance targets, with role, visibility and state. Default true. */
  includeTargets?: boolean
}

const FIELDS = 'input, select, textarea'
const HEADINGS = 'h1, h2, h3, [role="heading"]'
const LANDMARKS = 'nav, main, aside, header, footer, form[aria-label], form[aria-labelledby], section[aria-label], section[aria-labelledby], '
  + '[role="navigation"], [role="main"], [role="complementary"], [role="search"], [role="region"], [role="form"], [role="banner"], [role="contentinfo"]'
const OPEN = 'dialog[open], [role="dialog"], [role="alertdialog"], [aria-modal="true"], [aria-expanded="true"]'

const LANDMARK_ROLE: Record<string, string> = {
  nav: 'navigation', main: 'main', aside: 'complementary', header: 'banner', footer: 'contentinfo', form: 'form', section: 'region',
}

const isPrivate = isPrivateElement

/** Fields whose very presence is sensitive: left out whole, label and error too. */
export function isSensitiveField(e: Element): boolean {
  if (!(e instanceof HTMLInputElement || e instanceof HTMLSelectElement || e instanceof HTMLTextAreaElement)) return false
  if (e instanceof HTMLInputElement && (e.type === 'password' || e.type === 'hidden')) return true
  const tokens = (e.getAttribute('autocomplete') ?? '').toLowerCase().split(/\s+/)
  return tokens.some(t => t.startsWith('cc-') || t === 'one-time-code' || t === 'new-password' || t === 'current-password')
}

const textOf = (ids: string | null, doc: Document) =>
  (ids ?? '').split(/\s+/).filter(Boolean).map(id => doc.getElementById(id)).filter((e): e is HTMLElement => !!e && !isPrivate(e))
    .map(e => e.textContent ?? '').join(' ')

function nameOf(e: Element, doc: Document): string {
  return cleanPageText(e.getAttribute('aria-label'), 80) || cleanPageText(textOf(e.getAttribute('aria-labelledby'), doc), 80)
}

function fieldLabel(e: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, doc: Document): string {
  const label = nameOf(e, doc) || cleanPageText(e.labels?.[0]?.textContent, PAGE_TEXT.field)
    || cleanPageText(e.getAttribute('placeholder'), PAGE_TEXT.field) || cleanPageText(e.getAttribute('name'), PAGE_TEXT.field)
  return cleanPageText(label, PAGE_TEXT.field) || 'a field'
}

/** Invalid as the visitor would see it: aria-invalid, or :user-invalid (after they touched it or tried to submit). */
function isInvalid(e: Element): boolean {
  if (e.getAttribute('aria-invalid') === 'true') return true
  try { return e.matches(':user-invalid') } catch { return false }
}

const hostTarget = (e: Element) => e.closest('[data-otto-target]')?.getAttribute('data-otto-target') ?? undefined

function collectErrors(root: ParentNode, doc: Document): PageError[] {
  const out: PageError[] = []
  for (const e of root.querySelectorAll(FIELDS)) {
    const field = e as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    if (isPrivate(field) || isSensitiveField(field) || isElementHidden(field) || !isInvalid(field)) continue
    const message = cleanPageText(textOf(field.getAttribute('aria-errormessage'), doc), PAGE_TEXT.message)
      || cleanPageText(field.validationMessage, PAGE_TEXT.message)
      || cleanPageText(textOf(field.getAttribute('aria-describedby'), doc), PAGE_TEXT.message) || 'Not valid.'
    const target = hostTarget(field)
    out.push(target ? { field: fieldLabel(field, doc), message, target } : { field: fieldLabel(field, doc), message })
  }
  return out
}

function collectHeadings(root: ParentNode): string[] {
  const out: string[] = []
  for (const e of root.querySelectorAll(HEADINGS)) {
    if (isPrivate(e) || isElementHidden(e) || e.closest('[aria-hidden="true"]')) continue
    const level = /^H[1-3]$/.test(e.tagName) ? Number(e.tagName[1]) : Number(e.getAttribute('aria-level') ?? 2)
    if (!(level >= 1 && level <= 3)) continue
    const text = cleanPageText(e.textContent, PAGE_TEXT.heading)
    if (text) out.push(`h${level}: ${text}`)
  }
  return out
}

function collectLandmarks(root: ParentNode, doc: Document): string[] {
  const out: string[] = []
  for (const e of root.querySelectorAll(LANDMARKS)) {
    if (isPrivate(e) || isElementHidden(e)) continue
    const role = e.getAttribute('role') ?? LANDMARK_ROLE[e.tagName.toLowerCase()] ?? e.tagName.toLowerCase()
    const name = nameOf(e, doc)
    // Unnamed regions and forms are not landmarks; an unnamed main, nav, header or footer still is.
    if (!name && (role === 'region' || role === 'form')) continue
    out.push(cleanPageText(name ? `${role}: ${name}` : role, PAGE_TEXT.landmark))
  }
  return [...new Set(out)]
}

function collectOpen(root: ParentNode, doc: Document): string[] {
  const out: string[] = []
  for (const e of root.querySelectorAll(OPEN)) {
    if (isPrivate(e) || isElementHidden(e)) continue
    if (e.getAttribute('aria-expanded') === 'true') {
      const name = nameOf(e, doc) || cleanPageText(e.textContent, 60)
      if (name) out.push(cleanPageText(`expanded: ${name}`, PAGE_TEXT.open))
      continue
    }
    const name = nameOf(e, doc) || cleanPageText(e.querySelector(HEADINGS)?.textContent, 60)
    out.push(cleanPageText(name ? `dialog: ${name}` : 'dialog', PAGE_TEXT.open))
  }
  return [...new Set(out)]
}

function collectTargets(): PageTarget[] {
  const height = typeof window === 'undefined' ? 0 : window.innerHeight
  const width = typeof window === 'undefined' ? 0 : window.innerWidth
  const out: PageTarget[] = []
  for (const info of listGuideTargets()) {
    if (info.hidden) continue
    const element = findGuideTarget(info.id)?.element
    const r = element?.getBoundingClientRect()
    const visible = !!r && r.bottom > 0 && r.top < height && r.right > 0 && r.left < width
    const role = element ? cleanPageText(element.getAttribute('role') ?? element.tagName.toLowerCase(), 20) : undefined
    const t: PageTarget = { id: info.id, label: info.label, visible }
    if (role) t.role = role
    if (info.disabled) t.disabled = true
    out.push(t)
  }
  return out
}

function collectSelection(doc: Document): string | undefined {
  const selection = doc.getSelection?.()
  if (!selection || selection.isCollapsed) return undefined
  // Inside a private area, or a field (whose text is a value), the selection is the visitor's: never sent.
  for (const node of [selection.anchorNode, selection.focusNode]) {
    const e = node instanceof Element ? node : node?.parentElement
    if (e && (isPrivate(e) || e.closest(FIELDS) || e.closest('[contenteditable=""], [contenteditable="true"]'))) return undefined
  }
  return cleanPageText(selection.toString(), PAGE_TEXT.selection) || undefined
}

/** A privacy-filtered, budgeted snapshot of the page for the voice model. */
export function collectPageContext(options: CollectPageOptions = {}): PageSnapshot {
  if (typeof document === 'undefined') return { path: '', title: '', headings: [], landmarks: [], open: [], errors: [] }
  const doc = document
  const root = options.root ?? doc
  const snapshot: PageSnapshot = {
    path: cleanPageText(`${location.pathname}${routeHash(location.hash)}`, 120),
    title: cleanPageText(doc.title, PAGE_TEXT.title),
    headings: collectHeadings(root),
    landmarks: collectLandmarks(root, doc),
    open: collectOpen(root, doc),
    errors: collectErrors(root, doc),
  }
  if (options.includeTargets !== false) snapshot.targets = collectTargets()
  if (options.includeSelection) {
    const selection = collectSelection(doc)
    if (selection) snapshot.selection = selection
  }
  return fitPageSnapshot(snapshot, { maxChars: options.maxChars ?? 3000, maxNodes: options.maxNodes ?? 60 })
}

/**
 * Keeps a snapshot fresh while it matters: one now, then one after the visitor's activity settles (clicks, focus, typing,
 * submits, invalid fields, dialogs, scrolling). Returns a stop function that removes every listener and timer.
 */
export function watchPageContext(onSnapshot: (snapshot: PageSnapshot) => void, options: () => CollectPageOptions, debounceMs = 600): () => void {
  if (typeof document === 'undefined') return () => {}
  let timer: ReturnType<typeof setTimeout> | undefined
  const publish = () => { timer = undefined; onSnapshot(collectPageContext(options())) }
  const soon = () => { if (timer === undefined) timer = setTimeout(publish, debounceMs) }
  const EVENTS = ['click', 'focusin', 'input', 'change', 'submit', 'invalid', 'toggle', 'scroll', 'hashchange'] as const
  for (const type of EVENTS) (type === 'hashchange' ? window : document).addEventListener(type, soon, { capture: true, passive: true })
  publish()
  return () => {
    clearTimeout(timer)
    for (const type of EVENTS) (type === 'hashchange' ? window : document).removeEventListener(type, soon, { capture: true })
  }
}
