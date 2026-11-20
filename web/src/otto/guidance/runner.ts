// The guide runner: Otto carries out what the guide channel asks (guide.ts decides how much; this does it). Shell: reads
// the target's rect, scrolls, and marks the target while he shows it.
//
//   const detach = attachGuide(guide, { stage, playGesture, setFace, speak, settings, situation, ottoRect })
//
// While a plan runs, its target carries `data-otto-guiding` (removed when it ends or is cancelled), for a subtle highlight
// in the host's CSS:   [data-otto-guiding] { outline: 2px solid #8ab4ff; outline-offset: 4px }
//
// A new command (show, a task step, stop) cancels the one in flight between steps; the face it set is restored at once.

import type { IdleState } from '../idle'
import type { GestureName } from '../robot/gestures'
import type { RobotExpression } from '../robot/robot'
import { planGuide, type GuideCommand, type GuideEvent, type GuideRequest, type GuideSettings, type GuideStep, type OttoGuide } from './guide'
import { findGuideTarget } from './targets'

type RectLike = { left: number; top: number; right: number; bottom: number }

export type GuideRunnerDeps = {
  stage: { moveToElement(element: Element): Promise<unknown>; lookAt(element: Element | null, seconds?: number): void; stop?(): void; goHome?(): Promise<unknown> }
  playGesture(name: GestureName): void
  setFace(face: RobotExpression | null): void
  /** The face held before guiding (restored after). Default null. */
  face?(): RobotExpression | null
  /** Says the text (bubble and screen-reader text). The runner waits for it, but not for ever. */
  speak(text: string): Promise<unknown> | void
  settings(): GuideSettings
  situation(): { idle: IdleState; conversing: boolean; movementEnabled: boolean }
  /** Otto's box in viewport px, or null when unknown. */
  ottoRect(): RectLike | null
  find?(id: string): { element: Element; info: { id: string; label: string; description?: string } } | null
  now?(): number
  emit?(event: GuideEvent): void
  /** Default: the viewport (innerWidth, innerHeight). */
  viewport?(): { width: number; height: number }
  /** Default: prefers-reduced-motion. */
  reducedMotion?(): boolean
}

const DEAD_ZONE_PX = 48
const SETTLE_MS = { smooth: 450, auto: 60 }
const SAY_CAP_MS = 12_000
const GUIDING = 'data-otto-guiding'

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export function attachGuide(guide: OttoGuide, deps: GuideRunnerDeps): () => void {
  const find = deps.find ?? findGuideTarget
  const now = deps.now ?? (() => performance.now())
  const emit = deps.emit ?? guide.emit
  const viewport = deps.viewport ?? (() => (typeof window === 'undefined' ? { width: 1024, height: 768 } : { width: window.innerWidth, height: window.innerHeight }))
  const reduced = deps.reducedMotion ?? (() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)

  type Run = { cancelled: boolean; element: Element | null; faceSet: boolean; moving: boolean; before: RobotExpression | null }
  let current: Run | null = null
  let lastAppGuideAt: number | null = null

  const end = (run: Run) => {
    run.element?.removeAttribute(GUIDING)
    if (run.faceSet) deps.setFace(run.before)
    if (current === run) current = null
  }
  const cancel = () => {
    if (!current) return
    current.cancelled = true
    if (current.moving) deps.stage.stop?.() // a walk toward the old target would carry on
    end(current)
  }

  const say = async (text: string) => {
    const spoken = deps.speak(text)
    if (!spoken) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const cap = new Promise<void>(resolve => { timer = setTimeout(resolve, Math.min(SAY_CAP_MS, 1500 + (text.length / 15) * 1000)) })
    try { await Promise.race([Promise.resolve(spoken).catch(() => {}), cap]) } finally { clearTimeout(timer) }
  }

  async function execute(steps: GuideStep[], element: Element | null): Promise<boolean> {
    cancel()
    const run: Run = { cancelled: false, element, faceSet: false, moving: false, before: deps.face?.() ?? null }
    current = run
    element?.setAttribute(GUIDING, '')
    try {
      for (const step of steps) {
        if (run.cancelled) return false
        if (step.do === 'face') { run.faceSet = true; deps.setFace(step.face) }
        else if (step.do === 'say') await say(step.text)
        else if (step.do === 'gesture') deps.playGesture(step.name)
        else if (step.do === 'wait') await sleep(step.ms)
        else if (!element) continue
        else if (step.do === 'scroll') {
          const behavior = reduced() ? 'auto' : 'smooth'
          element.scrollIntoView({ block: 'center', behavior })
          await sleep(SETTLE_MS[behavior])
        } else if (step.do === 'move') {
          run.moving = true
          await deps.stage.moveToElement(element)
          run.moving = false
        }
        else if (step.do === 'look') deps.stage.lookAt(element, step.seconds)
      }
      return !run.cancelled
    } catch {
      return false // a failed step (a rejected move) ends the plan quietly
    } finally {
      if (!run.cancelled) end(run)
    }
  }

  function situationFor(element: Element) {
    const r = element.getBoundingClientRect()
    const { width, height } = viewport()
    const otto = deps.ottoRect()
    const dx = otto ? (r.left + r.right) / 2 - (otto.left + otto.right) / 2 : 0
    return {
      side: dx > DEAD_ZONE_PX ? 'right' as const : dx < -DEAD_ZONE_PX ? 'left' as const : 'center' as const,
      distance: Math.min(1, Math.max(0, Math.abs(dx) / Math.max(1, width))),
      visible: r.bottom > 0 && r.top < height && r.right > 0 && r.left < width,
    }
  }

  async function show(request: GuideRequest, prefix: GuideStep[] = []) {
    const found = find(request.target)
    const s = deps.situation()
    const situation = {
      ...(found ? situationFor(found.element) : { side: 'center' as const, distance: 0, visible: true }),
      tabVisible: typeof document === 'undefined' || document.visibilityState !== 'hidden',
      idle: s.idle, conversing: s.conversing, movementEnabled: s.movementEnabled,
      now: now(), lastAppGuideAt,
    }
    const plan = planGuide(request, found?.info ?? null, situation, deps.settings())
    if (!found) {
      emit({ type: 'missing', target: request.target })
      if (plan.steps.length || prefix.length) await execute([...prefix, ...plan.steps], null)
      return
    }
    // A skipped suggestion leaves whatever is in flight alone.
    if (plan.size === 'skip') { if (prefix.length) await execute(prefix, null); return }
    if ((request.reason ?? 'app') === 'app') lastAppGuideAt = situation.now
    // An offer is a question: 'offered' carries the request so the host can answer yes (reason 'asked').
    if (await execute([...prefix, ...plan.steps], found.element)) {
      emit(plan.size === 'offer' ? { type: 'offered', target: request.target, request } : { type: 'shown', target: request.target, size: plan.size })
    }
  }

  function onCommand(command: GuideCommand) {
    if (command.type === 'show') { void show(command.request); return }
    if (command.type === 'stop') { cancel(); deps.stage.stop?.(); deps.stage.lookAt(null); return }
    const { event, spec } = command
    if (event.type === 'step') {
      const intro: GuideStep[] = event.via === 'start' && spec.intro ? [{ do: 'say', text: spec.intro }] : []
      void show({ target: event.step.target, reason: 'task', say: event.step.say }, intro)
    } else if (event.type === 'done') {
      void execute([{ do: 'face', face: 'happy' }, { do: 'gesture', name: 'celebrate' }, { do: 'say', text: spec.doneSay ?? 'All done!' }], null)
    } else {
      cancel()
      deps.stage.stop?.()
      deps.stage.lookAt(null)
      if (event.reason !== 'replaced') void deps.stage.goHome?.()
    }
  }

  const unsubscribe = guide.subscribe(onCommand)
  return () => { unsubscribe(); cancel() }
}
