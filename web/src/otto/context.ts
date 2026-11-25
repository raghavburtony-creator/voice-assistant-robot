// What each screen tells Otto about itself. A page publishes a small JSON object under a key of its choosing; while a voice
// conversation is open it is forwarded to the server, where Otto reads it with get_screen_context. Nothing is sent otherwise.
//
//   useAssistantContext('cart', { items: 3, total: 'Rs 450' })
//   useAssistantContext('form', { step: 2 }, 'message_shown')   // the third argument names an event in app_config.py EVENTS

import { useEffect, useRef } from 'react'
import { capList } from './contextBudget'
import { isRuntimeId } from './runtimeId'

export type ContextUpdate = { key: string; data: Record<string, unknown> | null; announce?: string }
type Listener = (update: ContextUpdate) => void

const current = new Map<string, Record<string, unknown>>()
const listeners = new Set<Listener>()

/** The runtime destination contract shared with the server (D-23). */
export const DESTINATIONS_CONTEXT_KEY = 'destinations'
export const DESTINATIONS_CONTEXT_FIELD = 'destinations'
export type Destination = { id: string; label: string }

// Page data reaches the model: keep labels plain, single-line and small.
// eslint-disable-next-line no-control-regex
const cleanDestinationLabel = (label: string) => label.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80)

const destinationContext = (data: Record<string, unknown>): Record<string, unknown> => {
  const raw = data[DESTINATIONS_CONTEXT_FIELD]
  const destinations = Array.isArray(raw) ? raw.flatMap((entry): Destination[] => {
    if (!entry || typeof entry !== 'object') return []
    const { id, label } = entry as { id?: unknown; label?: unknown }
    if (!isRuntimeId(id) || typeof label !== 'string') return []
    const clean = cleanDestinationLabel(label)
    return clean ? [{ id, label: clean }] : []
  }) : []
  return capList(DESTINATIONS_CONTEXT_FIELD, destinations)
}

export function publishContext(key: string, data: Record<string, unknown> | null, announce?: string) {
  if (key === DESTINATIONS_CONTEXT_KEY && data !== null) data = destinationContext(data)
  if (data === null) current.delete(key); else current.set(key, data)
  listeners.forEach(listener => listener({ key, data, announce }))
}

/** Context keys whose allow-lists belong to the page currently mounted, not the page just left. */
const PAGE_CONTEXT_KEYS = ['guide_targets', 'guide_tasks', DESTINATIONS_CONTEXT_KEY] as const

/** Clear the previous interface's registries before its replacement publishes fresh ones. */
export function clearPageContext() {
  PAGE_CONTEXT_KEYS.forEach(key => publishContext(key, null))
}

/** A destination the page is still reporting, or null. Runtime navigation is checked against this immediately before use. */
export function findDestination(id: string): Destination | null {
  if (!isRuntimeId(id)) return null
  const entries = current.get(DESTINATIONS_CONTEXT_KEY)?.[DESTINATIONS_CONTEXT_FIELD]
  if (!Array.isArray(entries)) return null
  const found = entries.find(entry => entry && typeof entry === 'object' && (entry as { id?: unknown }).id === id)
  if (!found || typeof (found as { label?: unknown }).label !== 'string') return null
  return found as Destination
}

export function currentContext(): ContextUpdate[] {
  return [...current].map(([key, data]) => ({ key, data }))
}

export function subscribeContext(listener: Listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/**
 * Publishes `data` whenever its content changes, and clears it when the component unmounts.
 * `announce` is sent only when it changes, so each event prompts Otto once.
 */
export function useAssistantContext(key: string, data: Record<string, unknown> | null, announce?: string, enabled = true) {
  const serialized = JSON.stringify(data ?? null)
  const lastAnnounce = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!enabled) return
    const fresh = announce && announce !== lastAnnounce.current ? announce : undefined
    lastAnnounce.current = announce
    publishContext(key, data ?? null, fresh)
    // `serialized` stands in for `data`, so a new object with the same content does not republish.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, serialized, announce, enabled])
  useEffect(() => () => publishContext(key, null), [key])
}
