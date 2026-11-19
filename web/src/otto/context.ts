// What each screen tells Otto about itself. A page publishes a small JSON object under a key of its choosing; while a voice
// conversation is open it is forwarded to the server, where Otto reads it with get_screen_context. Nothing is sent otherwise.
//
//   useAssistantContext('cart', { items: 3, total: 'Rs 450' })
//   useAssistantContext('form', { step: 2 }, 'message_shown')   // the third argument names an event in app_config.py EVENTS

import { useEffect, useRef } from 'react'

export type ContextUpdate = { key: string; data: Record<string, unknown> | null; announce?: string }
type Listener = (update: ContextUpdate) => void

const current = new Map<string, Record<string, unknown>>()
const listeners = new Set<Listener>()

export function publishContext(key: string, data: Record<string, unknown> | null, announce?: string) {
  if (data === null) current.delete(key); else current.set(key, data)
  listeners.forEach(listener => listener({ key, data, announce }))
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
