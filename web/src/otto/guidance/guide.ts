// Otto's judgement on guiding the visitor's attention to something on the page: whether to, and how much. Pure: no
// DOM, no React, the clock and the situation passed in; the plan is carried out by the shell runner.
//
// A guide has a size, and an unrequested one gets the smallest that says enough:
//   skip      nothing (tab hidden, asleep, too soon after the last unrequested one)
//   offer     a curious look and "Want me to show you X?" (no movement); the runner emits 'offered', and the host's
//             yes is guide.show({ ...request, reason: 'asked' })
//   glance    a look toward it
//   point     look and point (nod when it is straight ahead)
//   approach  walk over, look and point
//   explain   look and say what it is
//
// The visitor asking (or a task step) gets point or approach; the app suggesting ('app') respects attention first, and
// its explicit mode is capped at point unless it is major.
// Each decision says so in `why`.
//
//   const guide = createOttoGuide()
//   guide.show('save')                          // or { target: 'save', mode: 'point', say: 'Press here.' }
//   const t = guide.startTask({ id: 'theme', title: 'Change the theme', steps: [...] })
//   guide.onEvent(e => ...)                     // shown / offered / missing / step / done / cancelled

import type { OttoConfig } from '../config'
import type { Importance } from '../awareness/events'
import type { IdleState } from '../idle'
import type { GestureName } from '../robot/gestures'
import type { RobotExpression } from '../robot/robot'
import { createGuideTask, type GuideObservation, type GuideTask, type GuideTaskEvent, type GuideTaskSpec, type GuideTaskStatus, type GuideTaskStep } from './task'

export type GuideSettings = OttoConfig['guidance']

/** asked: the visitor asked (voice or click); task: a task step; app: the host suggests. */
export type GuideReason = 'asked' | 'task' | 'app'
export type GuideMode = 'auto' | 'glance' | 'point' | 'approach' | 'explain'
export type GuideTargetInfo = { id: string; label: string; description?: string }
export type GuideRequest = {
  target: string
  mode?: GuideMode
  /** What Otto says. null: say nothing (the voice model speaks). */
  say?: string | null
  /** Default 'app'. */
  reason?: GuideReason
  /** Default 'normal'. */
  importance?: Importance
}
export type GuideSituation = {
  /** Where the target is, from Otto's (the viewer's) point of view. */
  side: 'left' | 'right' | 'center'
  /** How far it is from Otto, 0..1 of the viewport width. */
  distance: number
  /** The target is on screen (else scroll to it first). */
  visible: boolean
  tabVisible: boolean
  idle: IdleState
  /** In a voice conversation. */
  conversing: boolean
  movementEnabled: boolean
  now: number
  /** When the last unrequested ('app') guide was shown, or null. */
  lastAppGuideAt: number | null
}
export type GuideStep =
  | { do: 'scroll' }
  | { do: 'face'; face: RobotExpression }
  | { do: 'move' }
  | { do: 'look'; seconds: number }
  | { do: 'gesture'; name: GestureName }
  | { do: 'say'; text: string }
  | { do: 'wait'; ms: number }
export type GuideSize = 'skip' | 'offer' | 'glance' | 'point' | 'approach' | 'explain'
export type GuidePlan = { size: GuideSize; steps: GuideStep[]; why: string[] }

export const MISSING_SAY = "I can't find that on this page."

export function planGuide(request: GuideRequest, target: GuideTargetInfo | null, situation: GuideSituation, settings: GuideSettings): GuidePlan {
  const reason = request.reason ?? 'app'
  const importance = request.importance ?? 'normal'
  const mode = request.mode ?? 'auto'
  const why: string[] = [`${reason} (${importance}), ${mode}`]
  const skip = (because: string): GuidePlan => { why.push(`${because}: skip`); return { size: 'skip', steps: [], why } }

  if (!situation.tabVisible) return skip('nobody watching')
  if (!target) {
    if (reason === 'app') return skip('target not on this page')
    why.push('target not on this page: explain')
    const steps: GuideStep[] = [{ do: 'face', face: 'sad' }]
    if (request.say !== null) steps.push({ do: 'say', text: MISSING_SAY })
    return { size: 'explain', steps, why }
  }

  const auto = (): GuideSize => {
    const near = situation.distance < settings.approachMinDistance
    if (!situation.movementEnabled) why.push('movement off')
    else if (near) why.push('close by')
    return situation.movementEnabled && !near ? 'approach' : 'point'
  }

  let size: GuideSize
  if (reason === 'app') {
    const since = situation.lastAppGuideAt === null ? Infinity : situation.now - situation.lastAppGuideAt
    if (since < settings.cooldownMs) return skip('too soon after the last suggestion')
    if (situation.idle === 'asleep' && importance !== 'major') return skip('asleep')
    if (mode !== 'auto') {
      size = mode
      if (importance !== 'major' && (size === 'approach' || size === 'explain')) { size = 'point'; why.push('unrequested and not major: at most point') }
    }
    else if (importance === 'minor') size = 'glance'
    else if (importance === 'normal') size = settings.offerFirst ? 'offer' : 'point'
    else size = auto()
    why.push(`unrequested: ${size}`)
    if (situation.conversing && size !== 'glance') { size = 'glance'; why.push('in a conversation: glance') }
  } else {
    size = mode === 'auto' ? auto() : mode
    why.push(`${reason === 'asked' ? 'asked' : 'task step'}: ${size}`)
  }
  if (size === 'approach' && !situation.movementEnabled) { size = 'point'; why.push('movement off: point') }

  const steps: GuideStep[] = []
  if (!situation.visible) { steps.push({ do: 'scroll' }); why.push('off screen: scroll first') }
  steps.push({ do: 'face', face: size === 'offer' || size === 'glance' ? 'curious' : 'happy' })
  if (size === 'approach') steps.push({ do: 'move' })
  steps.push({ do: 'look', seconds: settings.lookSeconds })
  if (size === 'point' || size === 'approach') {
    steps.push({ do: 'gesture', name: situation.side === 'left' ? 'pointLeft' : situation.side === 'right' ? 'pointRight' : 'nod' })
  }
  if (size !== 'glance' && request.say !== null) {
    const text = size === 'offer' ? `Want me to show you ${target.label}?` : request.say ?? target.description ?? `Here's ${target.label}.`
    steps.push({ do: 'say', text })
  }
  if (request.say === null && size !== 'glance') why.push('the voice speaks')
  return { size, steps, why }
}

export type GuideCommand = { type: 'show'; request: GuideRequest } | { type: 'task'; event: GuideTaskEvent; spec: GuideTaskSpec } | { type: 'stop' }
/** shown: a plan ran to its end (an offer emits 'offered' instead: answer yes with guide.show({ ...request, reason: 'asked' })). */
export type GuideEvent =
  | { type: 'shown'; target: string; size: GuideSize }
  | { type: 'offered'; target: string; request: GuideRequest }
  | { type: 'missing'; target: string }
  | GuideTaskEvent
export type GuideTaskHandle = {
  readonly status: GuideTaskStatus
  readonly step: GuideTaskStep | null
  complete(stepId?: string): void
  back(): void
  goTo(stepId: string): void
  cancel(): void
}
export type OttoGuide = {
  /** Point the visitor to a target (a string is the target id). */
  show(request: string | GuideRequest): void
  /** Start a task; an active one is cancelled (reason 'replaced'). */
  startTask(spec: GuideTaskSpec): GuideTaskHandle
  /** Cancel the active task (reason 'user') and stop guiding. */
  stop(): void
  /** What the visitor just did (the shell's observer calls this): the active task moves on if a step's signal matches. */
  observe(seen: GuideObservation): void
  /** The active task's spec while it runs, else null. */
  readonly task: GuideTaskSpec | null
  /** For Otto (the runner): receive commands. Returns an unsubscribe function. */
  subscribe(listener: (command: GuideCommand) => void): () => void
  /** For the host: what Otto did. Returns an unsubscribe function. */
  onEvent(listener: (event: GuideEvent) => void): () => void
  /** For Otto: report shown / missing. */
  emit(event: GuideEvent): void
}

export function createOttoGuide(): OttoGuide {
  const commands = new Set<(command: GuideCommand) => void>()
  const events = new Set<(event: GuideEvent) => void>()
  const send = (command: GuideCommand) => commands.forEach(l => l(command))
  const emit = (event: GuideEvent) => events.forEach(l => l(event))
  let active: { task: GuideTask; spec: GuideTaskSpec } | null = null
  const run = (spec: GuideTaskSpec, out: GuideTaskEvent[]) => {
    for (const event of out) { send({ type: 'task', event, spec }); emit(event) }
  }

  return {
    show(request) { send({ type: 'show', request: typeof request === 'string' ? { target: request } : request }) },
    startTask(spec) {
      const task = createGuideTask(spec) // throws on a bad spec before touching the active task
      if (active) run(active.spec, active.task.cancel('replaced'))
      active = { task, spec }
      run(spec, task.start())
      return {
        get status() { return task.status },
        get step() { return task.step },
        complete: stepId => run(spec, task.complete(stepId)),
        back: () => run(spec, task.back()),
        goTo: stepId => run(spec, task.goTo(stepId)),
        cancel: () => run(spec, task.cancel('user')),
      }
    },
    stop() {
      if (active) run(active.spec, active.task.cancel('user'))
      active = null
      send({ type: 'stop' })
    },
    observe(seen) {
      if (!active || active.task.status !== 'active') return
      run(active.spec, active.task.observe(seen))
    },
    get task() { return active && active.task.status === 'active' ? active.spec : null },
    subscribe(listener) { commands.add(listener); return () => { commands.delete(listener) } },
    onEvent(listener) { events.add(listener); return () => { events.delete(listener) } },
    emit,
  }
}
