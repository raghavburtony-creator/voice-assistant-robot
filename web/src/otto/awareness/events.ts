// What happens around Otto, in the app's words. The app says WHAT happened (and where, and what it was about); Otto
// decides whether and how to react (reactions.ts). Nothing here names a face, a gesture or a move.
//
//   const events = useMemo(createOttoEvents, [])
//   <Otto events={events} ... />
//   events.notify({ type: 'success', where: '#save', topic: 'upload' })
//   const job = events.task('render', { topic: 'image generation', where: '#preview' })   // a long operation starts
//   job.succeed()   // or job.fail('The render failed'), job.done()
//
// Otto notices some things by himself, with no code: the visitor leaving and coming back, and coming over or clicking
// him. <Otto> also reports page changes as 'section'.

import type { StagePlace } from '../movement/stage'

export type OttoEventType =
  /** Something worked: saved, sent, generated. */
  | 'success'
  /** Something went wrong. */
  | 'failure'
  /** Something needs the visitor: a warning, a required field, an approval. */
  | 'attention'
  /** A long operation started (pair it with success / failure / complete by `task`). */
  | 'task'
  /** Something finished, neither good nor bad news. */
  | 'complete'
  /** A new screen, section or panel opened. */
  | 'section'
  /** The visitor picked something (a card, a row, an option). */
  | 'select'
  /** The app is waiting for the visitor (an empty form to fill, a choice to make). */
  | 'waiting'
  /** The visitor came (back) to the page / left it. Otto notices these himself. */
  | 'arrive'
  | 'leave'
  /** The visitor is interacting with Otto himself. Otto notices hover and clicks himself. */
  | 'interact'
  /** The visitor has gone quiet (Otto's own idle clock notices this too). */
  | 'idle'

export const OTTO_EVENT_TYPES: readonly OttoEventType[] = [
  'success', 'failure', 'attention', 'task', 'complete', 'section', 'select', 'waiting', 'arrive', 'leave', 'interact', 'idle',
]

/** How much it matters: a minor event gets a glance at most, a major one may get the full reaction. */
export type Importance = 'minor' | 'normal' | 'major'

export type OttoEvent = {
  type: OttoEventType
  /** Default: by type (success, failure and attention are normal; the rest minor). */
  importance?: Importance
  /** Where on the page it happened: a selector, an element, a rect, or an x. Otto may look or walk there. */
  where?: StagePlace
  /** What it is about ('image generation', 'upload'...): repeats are counted per type and topic, and rules can key on it. */
  topic?: string
  /** Pairs a 'task' with the success / failure / complete that ends it. */
  task?: string
  /** A few words for screen readers (and the bubble, for a major event). */
  message?: string
  /**
   * A guidance target (its id: data-otto-target or registerGuideTarget) that would help with this. With it, Otto may
   * offer to show the visitor where to go (guidance/help.ts decides when); without it, he only reacts.
   */
  help?: string
  /** Anything else your rules want to know. */
  data?: Readonly<Record<string, unknown>>
}

export type TaskHandle = {
  succeed(message?: string, importance?: Importance): void
  fail(message?: string, importance?: Importance): void
  done(): void
}

export type OttoEvents = {
  /** Tell Otto something happened. */
  notify(event: OttoEvent): void
  /** A long operation starts now; end it with the handle. */
  task(id: string, details?: Omit<OttoEvent, 'type' | 'task'>): TaskHandle
  /** For Otto: receive events. Returns an unsubscribe function. */
  subscribe(listener: (event: OttoEvent) => void): () => void
}

export function createOttoEvents(): OttoEvents {
  const listeners = new Set<(event: OttoEvent) => void>()
  const notify = (event: OttoEvent) => listeners.forEach(l => l(event))
  return {
    notify,
    task(id, details = {}) {
      notify({ ...details, type: 'task', task: id })
      let ended = false
      const end = (event: OttoEvent) => { if (!ended) { ended = true; notify({ ...details, ...event, task: id }) } }
      return {
        succeed: (message, importance) => end({ type: 'success', message, importance }),
        fail: (message, importance) => end({ type: 'failure', message, importance }),
        done: () => end({ type: 'complete' }),
      }
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
  }
}
