// A multi-step guided task: "first open Settings, then pick a theme, then save". Pure state machine; every call returns
// the events it caused (createOttoGuide in guide.ts sends them on). No DOM, no clock.
//
//   const t = createGuideTask({ id: 'theme', title: 'Change the theme', steps: [...] })
//   t.start()          // [{ type: 'step', step: steps[0], via: 'start', ... }]
//   t.complete()       // the current step is done: the next one, or { type: 'done' }
//   t.complete('save') // the visitor skipped ahead: the step after 'save', or done

export type GuideTaskStep = { id: string; target: string; say: string }
export type GuideTaskSpec = { id: string; title: string; steps: GuideTaskStep[]; intro?: string; doneSay?: string }
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
  }
}
