// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_CONTEXT_BYTES, capList, contextBytes } from './contextBudget'
import { listGuideTargets, registerGuideTask, listGuideTasks } from './guidance/targets'

afterEach(() => { document.body.innerHTML = '' })

describe('contextBytes', () => {
  // The same values are checked against the server's context_bytes in server/tests/test_voice.py.
  it('counts the UTF-8 bytes of compact JSON', () => {
    expect(contextBytes({ a: 1, b: [true, null] })).toBe(23)
    expect(contextBytes({ t: 'é' })).toBe(10)
    expect(contextBytes({ t: 'नमस्ते' })).toBe(26)
    expect(contextBytes({ t: '🤖' })).toBe(12)
    // A lone surrogate counts as its escape, \ud800, on both ends.
    expect(contextBytes({ t: '\ud800' })).toBe(14)
    expect(contextBytes({ t: 'a\nb' })).toBe(12)
  })
})

describe('capList', () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ id: `item-${i}`, label: 'x'.repeat(100) }))

  it('passes a list that fits as it is, with nothing omitted', () => {
    expect(capList('targets', items.slice(0, 3))).toEqual({ targets: items.slice(0, 3) })
  })

  it('keeps as many leading entries as fit, whole, and says how many were left out', () => {
    const budget = 2000
    const out = capList('targets', items, budget) as { targets: typeof items; omitted: number }
    expect(contextBytes(out)).toBeLessThanOrEqual(budget)
    expect(out.targets).toEqual(items.slice(0, out.targets.length))
    expect(out.targets.length + out.omitted).toBe(items.length)
    // One more entry would not have fitted.
    const more = { targets: items.slice(0, out.targets.length + 1), omitted: out.omitted - 1 }
    expect(contextBytes(more)).toBeGreaterThan(budget)
  })

  it('keeps nothing when no entry fits', () => {
    expect(capList('targets', [{ id: 'x'.repeat(500) }], 100)).toEqual({ targets: [], omitted: 1 })
  })
})

describe('the lists Otto publishes', () => {
  it('a page with 60 long-described targets stays inside the budget, first targets first', () => {
    for (let i = 0; i < 60; i++) {
      const button = document.createElement('button')
      button.setAttribute('data-otto-target', `target-${i}`)
      button.setAttribute('data-otto-label', `The ${i}th button, with a fairly long label for it`)
      button.setAttribute('data-otto-description', 'd'.repeat(200))
      document.body.appendChild(button)
    }
    const all = listGuideTargets()
    expect(contextBytes({ targets: all })).toBeGreaterThan(MAX_CONTEXT_BYTES) // the bug in #61: this used to be sent as it is
    const sent = capList('targets', all) as { targets: { id: string }[]; omitted: number }
    expect(contextBytes(sent)).toBeLessThanOrEqual(MAX_CONTEXT_BYTES)
    expect(sent.targets[0].id).toBe('target-0')
    expect(sent.targets.length + sent.omitted).toBe(60)
  })

  it('caps the guided tasks the same way', () => {
    const offs = Array.from({ length: 400 }, (_, i) => registerGuideTask({ id: `task-${i}`, title: 't'.repeat(80), steps: [] }))
    try {
      const sent = capList('tasks', listGuideTasks())
      expect(contextBytes(sent)).toBeLessThanOrEqual(MAX_CONTEXT_BYTES)
      expect(sent.omitted).toBeGreaterThan(0)
    } finally {
      offs.forEach(off => off())
    }
  })
})
