// What the app is busy with, for the voice model: the `events.task(...)` handles still open, and the last few that ended
// and how. Pure: fold the event stream through nextBusy; <Otto> publishes the result as context (key app_tasks).
// (reactions.ts keeps its own open-task map for its rules, on a clock; this one keeps endings and messages, for words.)
//
//   let busy = EMPTY_BUSY
//   events.subscribe(e => { const next = nextBusy(busy, e); if (next !== busy) publish(busy = next) })

import type { OttoEvent } from './events'

export type BusyOutcome = 'running' | 'succeeded' | 'failed' | 'complete'
export type BusyEntry = { id: string; topic?: string; outcome: BusyOutcome; message?: string }
export type BusyState = { running: readonly BusyEntry[]; ended: readonly BusyEntry[] }

export const EMPTY_BUSY: BusyState = { running: [], ended: [] }
export const BUSY_RUNNING_MAX = 5
export const BUSY_ENDED_MAX = 5
export const BUSY_TEXT_CHARS = 160
const BUSY_ID_CHARS = 64
const BUSY_ID_KEPT = 50

const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)
/** Short ids pass through. A long one keeps its start plus a hash of the whole, so two long ids that share a start stay apart. */
function capId(id: string): string {
  if (id.length <= BUSY_ID_CHARS) return id
  let h = 0x811c9dc5 // FNV-1a
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193)
  return `${id.slice(0, BUSY_ID_KEPT)}…#${(h >>> 0).toString(16).padStart(8, '0')}`
}

const ENDS: Partial<Record<OttoEvent['type'], BusyOutcome>> = { success: 'succeeded', failure: 'failed', complete: 'complete' }

/** The state after `event`; the same object when nothing changed, so callers can skip a publish. */
export function nextBusy(state: BusyState, event: OttoEvent): BusyState {
  if (event.task === undefined) return state
  const id = capId(event.task)
  const entry = (outcome: BusyOutcome): BusyEntry => {
    const e: BusyEntry = { id, outcome }
    if (event.topic !== undefined) e.topic = cap(event.topic, BUSY_TEXT_CHARS)
    if (event.message !== undefined) e.message = cap(event.message, BUSY_TEXT_CHARS)
    return e
  }
  const others = state.running.filter(e => e.id !== id)
  if (event.type === 'task') return { running: [...others, entry('running')].slice(-BUSY_RUNNING_MAX), ended: state.ended }
  const outcome = ENDS[event.type]
  // An end for a handle that isn't open (already ended, or dropped at the cap) changes nothing.
  if (!outcome || others.length === state.running.length) return state
  return { running: others, ended: [entry(outcome), ...state.ended].slice(0, BUSY_ENDED_MAX) }
}

/** The context to publish: null when there is nothing to tell. */
export const busyContext = (state: BusyState) => (state.running.length || state.ended.length ? { ...state } : null)
