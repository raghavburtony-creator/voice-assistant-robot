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
import type { GuideTaskSpec } from './task'
import { isElementHidden, isPrivateElement } from './hidden'
import { isRuntimeId } from '../runtimeId'

type Entry = { place: Element | string; info?: { label?: string; description?: string } }

const registry = new Map<string, Entry>()
const listeners = new Set<() => void>()
const changed = () => listeners.forEach(l => l())

const ATTR = 'data-otto-target'

// An id that breaks the runtime id rule (D-23) is never reported to the model. Its page hears why, once per id.
const warned = new Set<string>()
const fitsRule = (id: string, kind: 'target' | 'task'): boolean => {
  const shown = JSON.stringify(id.slice(0, 80))
  if (isRuntimeId(id)) return true
  if (!warned.has(shown)) {
    warned.add(shown)
    console.warn(`Otto: the guide ${kind} id ${shown} is left out. Use 1 to 64 of A-Z a-z 0-9 _ . : -, starting with a letter or a digit.`)
  }
  return false
}

const resolve = (place: Element | string): Element | null => {
  if (typeof place !== 'string') return place.isConnected ? place : null
  if (typeof document === 'undefined') return null
  try { return document.querySelector(place) } catch { return null } // a bad selector finds nothing
}

// Page text reaches the voice model: no control characters, one space at a time, capped.
// eslint-disable-next-line no-control-regex
const clean = (text: string | null | undefined, max: number) => (text ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

const infoFor = (id: string, element: Element | null, given?: Entry['info']): GuideTargetInfo => {
  const label = clean(given?.label, 60) || clean(element?.getAttribute('data-otto-label'), 60) || clean(element?.getAttribute('aria-label'), 60)
    || clean(element?.textContent, 60) || clean(id, 60)
  const description = clean(given?.description ?? element?.getAttribute('data-otto-description'), 200)
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

/** A target as the voice model is told about it: `hidden` (not drawn: Otto can't show it), `disabled` (shown, but it can't be used now). */
export type ListedGuideTarget = GuideTargetInfo & { hidden?: true; disabled?: true }

const isDisabled = (e: Element) => {
  try { return e.matches(':disabled') || e.closest('[aria-disabled="true"]') !== null } catch { return false }
}
const withState = (info: GuideTargetInfo, e: Element): ListedGuideTarget => {
  const out: ListedGuideTarget = { ...info }
  if (isElementHidden(e)) out.hidden = true
  else if (isDisabled(e)) out.disabled = true
  return out
}

/** Every target: registered first (in order), then marked-up ones, one per id, with whether it is hidden or disabled now. */
export function listGuideTargets(): ListedGuideTarget[] {
  const out = new Map<string, ListedGuideTarget>()
  // A target inside a private area is left out: its label would tell the model what is there.
  const skip = new Set<string>()
  for (const [id, entry] of registry) {
    if (!fitsRule(id, 'target')) { skip.add(id); continue }
    const element = resolve(entry.place)
    if (element && isPrivateElement(element)) skip.add(id)
    else if (element) out.set(id, withState(infoFor(id, element, entry.info), element))
  }
  for (const e of marked()) {
    const id = e.getAttribute(ATTR)
    if (!id || out.has(id) || skip.has(id) || !e.isConnected || !fitsRule(id, 'target')) continue
    if (isPrivateElement(e)) skip.add(id)
    else out.set(id, withState(infoFor(id, e), e))
  }
  return [...out.values()]
}

/** Hear registrations and unregistrations. Returns an unsubscribe function. */
export function onGuideTargetsChange(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The ids of every target that contains `node` (innermost first): what the visitor touched. */
export function guideTargetsAt(node: Node | null): string[] {
  const element = node instanceof Element ? node : node?.parentElement ?? null
  if (!element) return []
  const out: string[] = []
  for (let e: Element | null = element.closest(`[${ATTR}]`); e; e = e.parentElement?.closest(`[${ATTR}]`) ?? null) {
    const id = e.getAttribute(ATTR)
    if (id && !out.includes(id)) out.push(id)
  }
  for (const [id, entry] of registry) {
    const target = resolve(entry.place)
    if (target?.contains(element) && !out.includes(id)) out.push(id)
  }
  return out
}

// Guided tasks the page offers, so the voice can start one ("help me with this") by id, like a target.
const tasks = new Map<string, GuideTaskSpec>()
const taskListeners = new Set<() => void>()

/** Offers a task to the voice (the model sees its id and title; it can only start tasks listed here). */
export function registerGuideTask(spec: GuideTaskSpec): () => void {
  tasks.set(spec.id, spec)
  taskListeners.forEach(l => l())
  return () => { if (tasks.get(spec.id) === spec) { tasks.delete(spec.id); taskListeners.forEach(l => l()) } }
}
export function findGuideTask(id: string): GuideTaskSpec | null { return tasks.get(id) ?? null }
/** What the voice model is told: id, title (cleaned, capped) and how many steps. A task whose id breaks the rule is left out. */
export function listGuideTasks(): { id: string; title: string; steps: number; stepIds: string[] }[] {
  return [...tasks.values()].filter(t => fitsRule(t.id, 'task')).map(t => ({ id: t.id, title: clean(t.title, 80), steps: t.steps.length, stepIds: t.steps.map(step => step.id) }))
}
export function onGuideTasksChange(listener: () => void): () => void {
  taskListeners.add(listener)
  return () => { taskListeners.delete(listener) }
}
