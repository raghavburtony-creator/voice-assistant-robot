// What the visitor does, for guidance. Shell (listens to the page): turns clicks and typing on guidance targets, and the
// app's events, into observations for the active task (task.ts decides what they mean), and passes events that name a
// `help` target to the help judge (help.ts), whose requests go to the guide (guide.ts decides how much to show).
//
//   const detach = observeGuidance(guide, { events, settings: () => config.guidance })
//
// With `proactiveHelpEnabled`, it also watches forms for friction (frictionObserver.ts): repeated refused submits, or sitting
// on an invalid field, get a quiet offer of help.
//
// Listens only while attached; nothing runs between events.

import type { OttoEvents } from '../awareness/events'
import type { GuideSettings, OttoGuide } from './guide'
import { observeFriction } from './frictionObserver'
import { createHelpJudge } from './help'
import { guideTargetsAt } from './targets'

export type GuidanceObserverOptions = {
  /** The app's events (awareness): progress signals for tasks, and help offers. */
  events?: OttoEvents
  settings: () => GuideSettings
  /** Hear why help was (or was not) offered (the lab). */
  onHelp?: (why: string, target: string) => void
  now?: () => number
}

export function observeGuidance(guide: OttoGuide, options: GuidanceObserverOptions): () => void {
  if (typeof document === 'undefined') return () => {}
  const now = options.now ?? (() => performance.now())
  const report = (kind: 'activate' | 'input', node: EventTarget | null) => {
    if (!guide.task) return // nothing to follow: no work at all
    for (const target of guideTargetsAt(node as Node | null)) guide.observe({ kind, target })
  }
  const onClick = (e: Event) => report('activate', e.target)
  const onInput = (e: Event) => report('input', e.target)
  document.addEventListener('click', onClick, true)
  document.addEventListener('input', onInput, true)
  document.addEventListener('change', onInput, true)

  const judge = createHelpJudge(options.settings)
  const off = options.events?.subscribe(event => {
    guide.observe({ kind: 'event', type: event.type, topic: event.topic })
    const help = judge.consider(event, now())
    if (!help) return
    options.onHelp?.(help.why, help.target)
    // While a task runs, it is the guidance: its own steps already point the way.
    if (guide.task) return
    const { why: _why, ...request } = help
    guide.show(request)
  })

  const offFriction = observeFriction(guide, { settings: options.settings, now, onHelp: options.onHelp })

  return () => {
    offFriction()
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('input', onInput, true)
    document.removeEventListener('change', onInput, true)
    off?.()
  }
}
