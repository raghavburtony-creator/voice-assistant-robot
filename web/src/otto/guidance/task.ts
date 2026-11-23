// A multi-step guided task: "first open Settings, then pick a theme, then save". Pure state machine; every call returns
// the events it caused (createOttoGuide in guide.ts sends them on). No DOM, no clock.
//
//   const t = createGuideTask({ id: 'theme', title: 'Change the theme', steps: [...] })
//   t.start()          // [{ type: 'step', step: steps[0], via: 'start', ... }]
//   t.complete()       // the current step is done: the next one, or { type: 'done' }
//   t.complete('save') // the visitor skipped ahead: the step after 'save', or done
//   t.observe(seen)    // what the visitor just did: Otto works out progress from the steps' signals
//
// Progress Otto can see for himself: a step may say what finishes it (`doneWhen`) and what undoes it (`undoneWhen`), and
// the task what abandons it (`cancelWhen`). A signal is the visitor using a target (a click or press), typing in one, or
// an app event (the awareness vocabulary). observe() then moves the task on:
//   the current step's doneWhen      -> the next step
//   a later step's doneWhen          -> skipped ahead, past that step
//   an earlier step's undoneWhen     -> back to that step (the visitor undid it)
//   the task's cancelWhen            -> cancelled
// Steps without signals wait for complete(), as before: the host stays in charge of what counts as done.

/** Something the visitor did, as a step can name it. `target` defaults to the step's own target. */
export type GuideSignal =
  | { on: 'activate'; target?: string }
  | { on: 'input'; target?: string }
  | { on: 'event'; type: string; topic?: string }
/** What Otto saw: the visitor used or typed in a target (by id), or an app event arrived. */
export type GuideObservation = { kind: 'activate' | 'input'; target: string } | { kind: 'event'; type: string; topic?: string }

export type GuideTaskStep = {
  id: string
  target: string
  say: string
  doneWhen?: readonly GuideSignal[]
  undoneWhen?: readonly GuideSignal[]
}
export type GuideTaskSpec = {
  id: string
  title: string
  steps: GuideTaskStep[]
  intro?: string
  doneSay?: string
  cancelWhen?: readonly GuideSignal[]
}

/** Whether `seen` is `signal`, for a step whose target is `stepTarget`. */
export function signalMatches(signal: GuideSignal, seen: GuideObservation, stepTarget: string): boolean {
  if (signal.on === 'event') return seen.kind === 'event' && seen.type === signal.type && (signal.topic === undefined || seen.topic === signal.topic)
  return seen.kind === signal.on && seen.target === (signal.target ?? stepTarget)
}
const any = (signals: readonly GuideSignal[] | undefined, seen: GuideObservation, target: string) =>
  !!signals?.some(s => signalMatches(s, seen, target))
export type GuideTaskStatus = 'idle' | 'active' | 'done' | 'cancelled'
export type GuideTaskEvent =
  | { type: 'step'; task: string; step: GuideTaskStep; index: number; total: number; via: 'start' | 'next' | 'skip' | 'back' | 'goto' }
  | { type: 'done'; task: string }
  | { type: 'cancelled'; task: string; reason: 'user' | 'app' | 'replaced' }

export type GuideTask = {
  readonly status: GuideTaskStatus
  /** The current step's index, -1 before start. */
  readonly index: number
  /** The current step while active, else null. */
  readonly step: GuideTaskStep | null
  start(): GuideTaskEvent[]
  complete(stepId?: string): GuideTaskEvent[]
  back(): GuideTaskEvent[]
  goTo(stepId: string): GuideTaskEvent[]
  cancel(reason?: 'user' | 'app' | 'replaced'): GuideTaskEvent[]
  /** Moves the task on from what the visitor did (see the signals above); [] when it changes nothing. */
  observe(seen: GuideObservation): GuideTaskEvent[]
}

/** What the voice model is told about the running task (context key guide_task_running). `step` is 1-based. */
export type GuideTaskProgress = { id: string; title: string; step: number; total: number; say: string }
export const PROGRESS_TITLE_CHARS = 80
export const PROGRESS_SAY_CHARS = 200
const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** The summary after `event`: null once the task is done or cancelled, so the model never sees a stale step. */
export function taskProgress(event: GuideTaskEvent, spec: GuideTaskSpec): GuideTaskProgress | null {
  if (event.type !== 'step') return null
  return { id: spec.id, title: cap(spec.title, PROGRESS_TITLE_CHARS), step: event.index + 1, total: event.total, say: cap(event.step.say, PROGRESS_SAY_CHARS) }
}

export function createGuideTask(spec: GuideTaskSpec): GuideTask {
  const { steps } = spec
  if (steps.length === 0) throw new Error(`Guide task "${spec.id}" needs at least one step`)
  const ids = steps.map(s => s.id)
  if (new Set(ids).size !== ids.length) throw new Error(`Guide task "${spec.id}" has duplicate step ids`)

  let status: GuideTaskStatus = 'idle'
  let index = -1
  const active = () => status === 'active'
  const go = (i: number, via: Extract<GuideTaskEvent, { type: 'step' }>['via']): GuideTaskEvent[] => {
    if (i >= steps.length) { status = 'done'; return [{ type: 'done', task: spec.id }] }
    index = i
    return [{ type: 'step', task: spec.id, step: steps[i], index: i, total: steps.length, via }]
  }

  return {
    get status() { return status },
    get index() { return index },
    get step() { return active() ? steps[index] : null },
    start() {
      if (status !== 'idle') return []
      status = 'active'
      return go(0, 'start')
    },
    complete(stepId) {
      if (!active()) return []
      if (stepId === undefined || stepId === steps[index].id) return go(index + 1, 'next')
      const j = ids.indexOf(stepId)
      return j > index ? go(j + 1, 'skip') : [] // an earlier or unknown step: nothing changes
    },
    back() {
      return active() && index > 0 ? go(index - 1, 'back') : []
    },
    goTo(stepId) {
      const j = ids.indexOf(stepId)
      return active() && j >= 0 ? go(j, 'goto') : []
    },
    cancel(reason = 'user') {
      if (!active()) return []
      status = 'cancelled'
      return [{ type: 'cancelled', task: spec.id, reason }]
    },
    observe(seen) {
      if (!active()) return []
      if (spec.cancelWhen?.some(s => signalMatches(s, seen, steps[index].target))) {
        status = 'cancelled'
        return [{ type: 'cancelled', task: spec.id, reason: 'user' }]
      }
      // Undone first: going back wins over a coincidental match ahead.
      for (let j = 0; j < index; j++) if (any(steps[j].undoneWhen, seen, steps[j].target)) return go(j, 'back')
      if (any(steps[index].doneWhen, seen, steps[index].target)) return go(index + 1, 'next')
      for (let j = steps.length - 1; j > index; j--) if (any(steps[j].doneWhen, seen, steps[j].target)) return go(j + 1, 'skip')
      return []
    },
  }
}
