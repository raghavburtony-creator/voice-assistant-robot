import { describe, expect, it } from 'vitest'
import { createGuideTask, type GuideTaskSpec } from './task'

const SPEC: GuideTaskSpec = {
  id: 'theme', title: 'Change the theme',
  steps: [
    { id: 'open', target: 'settings', say: 'Open Settings.' },
    { id: 'pick', target: 'theme', say: 'Pick a theme.' },
    { id: 'save', target: 'save', say: 'Save it.' },
  ],
}
const started = () => { const t = createGuideTask(SPEC); t.start(); return t }

describe('createGuideTask', () => {
  it('rejects a task with no steps or duplicate step ids', () => {
    expect(() => createGuideTask({ ...SPEC, steps: [] })).toThrow()
    expect(() => createGuideTask({ ...SPEC, steps: [SPEC.steps[0], SPEC.steps[0]] })).toThrow()
  })

  it('is idle until started, then shows the first step', () => {
    const t = createGuideTask(SPEC)
    expect(t.status).toBe('idle')
    expect(t.step).toBeNull()
    expect(t.complete()).toEqual([])
    expect(t.start()).toEqual([{ type: 'step', task: 'theme', step: SPEC.steps[0], index: 0, total: 3, via: 'start' }])
    expect(t.status).toBe('active')
    expect(t.step).toBe(SPEC.steps[0])
    expect(t.start()).toEqual([]) // only once
  })

  it('complete() and complete(current id) move to the next step, then done', () => {
    const t = started()
    expect(t.complete()).toMatchObject([{ type: 'step', index: 1, via: 'next' }])
    expect(t.complete('pick')).toMatchObject([{ type: 'step', index: 2, via: 'next' }])
    expect(t.complete()).toEqual([{ type: 'done', task: 'theme' }])
    expect(t.status).toBe('done')
    expect(t.step).toBeNull()
    expect(t.complete()).toEqual([])
  })

  it('completing a later step skips ahead to the one after it, or finishes', () => {
    const t = started()
    expect(t.complete('pick')).toMatchObject([{ type: 'step', step: { id: 'save' }, index: 2, via: 'skip' }])
    const u = started()
    expect(u.complete('save')).toEqual([{ type: 'done', task: 'theme' }])
  })

  it('completing an earlier or unknown step changes nothing', () => {
    const t = started()
    t.complete()
    expect(t.complete('open')).toEqual([])
    expect(t.complete('nope')).toEqual([])
    expect(t.index).toBe(1)
  })

  it('back() goes one step back, never before the first', () => {
    const t = started()
    expect(t.back()).toEqual([])
    t.complete()
    expect(t.back()).toMatchObject([{ type: 'step', index: 0, via: 'back' }])
  })

  it('goTo() jumps to any known step', () => {
    const t = started()
    expect(t.goTo('save')).toMatchObject([{ type: 'step', index: 2, via: 'goto' }])
    expect(t.goTo('open')).toMatchObject([{ type: 'step', index: 0, via: 'goto' }])
    expect(t.goTo('nope')).toEqual([])
  })

  it('cancel() ends an active task once, with a reason', () => {
    const t = started()
    expect(t.cancel()).toEqual([{ type: 'cancelled', task: 'theme', reason: 'user' }])
    expect(t.status).toBe('cancelled')
    expect(t.cancel()).toEqual([])
    expect(t.complete()).toEqual([])
    expect(t.back()).toEqual([])
    expect(t.goTo('open')).toEqual([])
    expect(started().cancel('app')).toEqual([{ type: 'cancelled', task: 'theme', reason: 'app' }])
    expect(createGuideTask(SPEC).cancel()).toEqual([]) // not started
  })
})

describe('progress Otto sees for himself', () => {
  // Open the menu, pick a theme (an app event), save. Closing the menu undoes step 1; leaving the page cancels.
  const spec: GuideTaskSpec = {
    id: 'theme', title: 'Change the theme',
    cancelWhen: [{ on: 'event', type: 'section', topic: 'home' }],
    steps: [
      { id: 'menu', target: 'menu', say: 'Open the menu.', doneWhen: [{ on: 'activate' }], undoneWhen: [{ on: 'event', type: 'complete', topic: 'menu-closed' }] },
      { id: 'pick', target: 'themes', say: 'Pick a theme.', doneWhen: [{ on: 'event', type: 'select', topic: 'theme' }] },
      { id: 'save', target: 'save', say: 'Save it.', doneWhen: [{ on: 'activate' }] },
    ],
  }
  const started = () => { const t = createGuideTask(spec); t.start(); return t }
  const ids = (events: ReturnType<ReturnType<typeof createGuideTask>['observe']>) =>
    events.map(e => (e.type === 'step' ? `${e.via}:${e.step.id}` : e.type === 'cancelled' ? `cancelled:${e.reason}` : e.type))

  it('the visitor doing each step moves the task on, to done', () => {
    const t = started()
    expect(ids(t.observe({ kind: 'activate', target: 'menu' }))).toEqual(['next:pick'])
    expect(ids(t.observe({ kind: 'event', type: 'select', topic: 'theme' }))).toEqual(['next:save'])
    expect(ids(t.observe({ kind: 'activate', target: 'save' }))).toEqual(['done'])
    expect(t.status).toBe('done')
  })

  it('something unrelated changes nothing', () => {
    const t = started()
    expect(t.observe({ kind: 'activate', target: 'elsewhere' })).toEqual([])
    expect(t.observe({ kind: 'input', target: 'menu' })).toEqual([])           // typing is not activating
    expect(t.observe({ kind: 'event', type: 'select', topic: 'font' })).toEqual([]) // another topic
    expect(t.step?.id).toBe('menu')
  })

  it('skipping ahead lands after the step the visitor did', () => {
    const t = started()
    expect(ids(t.observe({ kind: 'event', type: 'select', topic: 'theme' }))).toEqual(['skip:save'])
  })

  it('undoing an earlier step goes back to it', () => {
    const t = started()
    t.observe({ kind: 'activate', target: 'menu' })
    expect(ids(t.observe({ kind: 'event', type: 'complete', topic: 'menu-closed' }))).toEqual(['back:menu'])
  })

  it('the task\'s cancel signal abandons it, and a finished task ignores everything', () => {
    const t = started()
    expect(ids(t.observe({ kind: 'event', type: 'section', topic: 'home' }))).toEqual(['cancelled:user'])
    expect(t.observe({ kind: 'activate', target: 'menu' })).toEqual([])
  })

  it('steps without signals wait for the host, as before', () => {
    const t = createGuideTask({ id: 'x', title: 'X', steps: [{ id: 'a', target: 'a', say: 'A' }] })
    t.start()
    expect(t.observe({ kind: 'activate', target: 'a' })).toEqual([])
    expect(ids(t.complete())).toEqual(['done'])
  })
})
