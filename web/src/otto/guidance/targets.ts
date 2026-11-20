// Guidance targets: the things on the host page Otto can show. Shell (reads the DOM, only when called: SSR-safe).
//
// In markup:
//   <button data-otto-target="save" data-otto-label="the Save button" data-otto-description="Saves your draft.">Save</button>
// The label falls back to aria-label, then the trimmed text (at most 60 characters).
//
// In code (wins over markup with the same id):
//   const off = registerGuideTarget('save', '#save', { label: 'the Save button' })
//   findGuideTarget('save')  // { element, info } or null

import type { GuideTargetInfo } from './guide'

type Entry = { place: Element | string; info?: { label?: string; description?: string } }

const registry = new Map<string, Entry>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach(l => l())

const ATTR = 'data-otto-target'

const resolve = (place: Element | string): Element | null => {
  if (typeof place !== 'string') return place.isConnected ? place : null
  if (typeof document === 'undefined') return null
  try { return document.querySelector(place) } catch { return null } // a bad selector finds nothing
}

const infoFor = (id: string, element: Element | null, given?: Entry['info']): GuideTargetInfo => {
  const text = (element?.textContent ?? '').replace(/\s+/g, ' ').trim()
  const label = given?.label ?? element?.getAttribute('data-otto-label') ?? element?.getAttribute('aria-label')
    ?? (text ? text.slice(0, 60) : id)
  const description = given?.description ?? element?.getAttribute('data-otto-description') ?? undefined
  return description ? { id, label, description } : { id, label }
}

const marked = (): Element[] => (typeof document === 'undefined' ? [] : Array.from(document.querySelectorAll(`[${ATTR}]`)))

/** Registers a target by element or selector. Returns an unregister function. */
export function registerGuideTarget(id: string, elementOrSelector: Element | string, info?: { label?: string; description?: string }): () => void {
  const entry: Entry = { place: elementOrSelector, info }
  registry.set(id, entry)
  changed()
  return () => { if (registry.get(id) === entry) { registry.delete(id); changed() } }
}

/** The target's element (connected) and what to call it, or null. */
export function findGuideTarget(id: string): { element: Element; info: GuideTargetInfo } | null {
  const entry = registry.get(id)
  const element = entry ? resolve(entry.place) : marked().find(e => e.getAttribute(ATTR) === id && e.isConnected) ?? null
  return element ? { element, info: infoFor(id, element, entry?.info) } : null
}

/** Every target: registered first (in order), then marked-up ones, one per id. */
export function listGuideTargets(): GuideTargetInfo[] {
  const out = new Map<string, GuideTargetInfo>()
  for (const [id, entry] of registry) {
    const element = resolve(entry.place)
    if (element) out.set(id, infoFor(id, element, entry.info))
  }
  for (const e of marked()) {
    const id = e.getAttribute(ATTR)
    if (id && !out.has(id) && e.isConnected) out.set(id, infoFor(id, e))
  }
  return [...out.values()]
}

/** Hear registrations and unregistrations. Returns an unsubscribe function. */
export function onGuideTargetsChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
