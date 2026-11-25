// The words a backend uses to tell Otto's character how things are going (issue #58). Presentation only: an avatar event
// says what is happening ("a permission request is open", "a task is running"), never what Otto should decide. The
// orchestrator, the task engine and the policy layer (#44, #49, #47) decide; Otto only shows it.
//
// There is one event path, not a second one (D-19): `toOttoEvents` turns an avatar event into the events Otto already
// understands (events.ts), and reactions.ts decides how big a reaction each one gets. Nothing here names React, a socket
// or a DOM node, so the same events can come from the voice server, a test or the host app.
//
//   avatar event                 Otto event(s)                       what the visitor sees
//   thinking / working           task (paired by id)                 searching face, then the thinking pose when it runs long
//   waiting                      waiting                             a curious look
//   permission asking            permission (paired by id)           an alert face held until answered, and a nod
//   permission granted / denied  complete (data.permission)          the hold ends; a small nod, or just a look when denied
//   success / failure            success / failure (paired by id)    the same celebration or head shake as any app event
//   emotion / gesture / movement express                             that face, gesture, or a look at the visitor
//   listening / speaking /       (none)                              the voice session's own status already drives these
//   interruption                                                     (useGestureTriggers); mapping them again would double them
//
// The browser checks every avatar event it is sent (`parseAvatarEvent`), like every other server message (D-02).

import type { Importance, OttoEvent } from './events'
import { isGestureName, type GestureName } from '../robot/gestures'
import { isRobotExpression, type RobotExpression } from '../robot/robot'

/** The kinds, in the order the issue lists them. server/app/voice/avatar.py keeps the same list (a test checks they match). */
export const AVATAR_KINDS = [
  'thinking', 'listening', 'speaking', 'working', 'waiting', 'permission', 'success', 'failure', 'interruption',
  'emotion', 'gesture', 'movement',
] as const
export type AvatarKind = (typeof AVATAR_KINDS)[number]

export type PermissionState = 'asking' | 'granted' | 'denied'
export const PERMISSION_STATES: readonly PermissionState[] = ['asking', 'granted', 'denied']

export type AvatarEvent =
  /** The voice turn's own states. The voice session already shows them (see the table above). */
  | { kind: 'listening' | 'speaking' | 'interruption' }
  /** The backend is working out an answer / running something. `id` pairs it with the success or failure that ends it. */
  | { kind: 'thinking' | 'working'; id: string; topic?: string; message?: string }
  | { kind: 'waiting'; message?: string }
  | { kind: 'permission'; id: string; state: PermissionState; topic?: string; message?: string }
  | { kind: 'success' | 'failure'; id?: string; topic?: string; message?: string }
  | { kind: 'emotion'; expression: RobotExpression }
  | { kind: 'gesture'; gesture: GestureName; intensity?: number }
  /** Look at the visitor. (Walking somewhere is the page's decision, not a backend's: it needs a place on the page.) */
  | { kind: 'movement'; to: 'visitor' }

/** The longest `id`, `topic` and `message` a backend may send; longer ones are cut. */
export const AVATAR_ID_CHARS = 64
export const AVATAR_TOPIC_CHARS = 60
export const AVATAR_MESSAGE_CHARS = 140

const isKind = (value: unknown): value is AvatarKind => typeof value === 'string' && (AVATAR_KINDS as readonly string[]).includes(value)

/** Plain single-line text, capped; undefined when nothing is left. Never HTML, never a link (D-18). */
function text(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
  return clean || undefined
}

/** An id as the pairing key: letters, digits and a few separators (the runtime id rule's alphabet), at most 64. */
function id(value: unknown): string | undefined {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(value) ? value : undefined
}

/** The avatar event in an untrusted value, or null when it is unknown or does not fit. Extra fields are dropped. */
export function parseAvatarEvent(value: unknown): AvatarEvent | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (!isKind(v.kind)) return null
  const topic = text(v.topic, AVATAR_TOPIC_CHARS)
  const message = text(v.message, AVATAR_MESSAGE_CHARS)
  const pairs = (rest: object) => ({ ...(topic ? { topic } : {}), ...(message ? { message } : {}), ...rest })
  switch (v.kind) {
    case 'listening': case 'speaking': case 'interruption':
      return { kind: v.kind }
    case 'thinking': case 'working': {
      const key = id(v.id)
      return key ? { kind: v.kind, id: key, ...pairs({}) } : null
    }
    case 'waiting':
      return { kind: 'waiting', ...(message ? { message } : {}) }
    case 'permission': {
      const key = id(v.id)
      const state = PERMISSION_STATES.find(s => s === v.state)
      return key && state ? { kind: 'permission', id: key, state, ...pairs({}) } : null
    }
    case 'success': case 'failure': {
      const key = v.id === undefined ? undefined : id(v.id)
      if (v.id !== undefined && !key) return null
      return { kind: v.kind, ...(key ? { id: key } : {}), ...pairs({}) }
    }
    case 'emotion':
      return isRobotExpression(v.expression) ? { kind: 'emotion', expression: v.expression } : null
    case 'gesture': {
      if (!isGestureName(v.gesture)) return null
      const intensity = typeof v.intensity === 'number' && Number.isFinite(v.intensity) ? Math.min(1, Math.max(0, v.intensity)) : undefined
      return { kind: 'gesture', gesture: v.gesture, ...(intensity !== undefined ? { intensity } : {}) }
    }
    case 'movement':
      return v.to === 'visitor' ? { kind: 'movement', to: 'visitor' } : null
  }
}

/** The Otto events for an avatar event: none, one, or an ending. Feed each to `events.notify`. */
export function toOttoEvents(event: AvatarEvent): OttoEvent[] {
  const named = (e: { topic?: string; message?: string }) => ({
    ...(e.topic ? { topic: e.topic } : {}), ...(e.message ? { message: e.message } : {}),
  })
  switch (event.kind) {
    case 'listening': case 'speaking': case 'interruption':
      return [] // the voice session's status drives these
    case 'thinking': case 'working':
      return [{ type: 'task', task: event.id, ...named(event) }]
    case 'waiting':
      return [{ type: 'waiting', ...named(event) }]
    case 'permission':
      return [event.state === 'asking'
        ? { type: 'permission', task: event.id, ...named(event) }
        : { type: 'complete', task: event.id, importance: 'minor', data: { permission: event.state }, ...named(event) }]
    case 'success': case 'failure': {
      const importance: Importance = 'normal'
      return [{ type: event.kind, importance, ...(event.id ? { task: event.id } : {}), ...named(event) }]
    }
    case 'emotion':
      return [{ type: 'express', importance: 'minor', data: { expression: event.expression } }]
    case 'gesture':
      return [{ type: 'express', importance: 'normal', data: { gesture: event.gesture, gestureIntensity: event.intensity } }]
    case 'movement':
      return [{ type: 'express', importance: 'minor', data: { look: 'user' } }]
  }
}
