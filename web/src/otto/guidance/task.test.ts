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
