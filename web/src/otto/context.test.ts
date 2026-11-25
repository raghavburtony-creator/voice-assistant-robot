import { afterEach, describe, expect, it } from 'vitest'
import {
  clearPageContext, currentContext, DESTINATIONS_CONTEXT_FIELD, DESTINATIONS_CONTEXT_KEY, findDestination, publishContext,
} from './context'
import { MAX_CONTEXT_BYTES, contextBytes } from './contextBudget'

afterEach(() => publishContext(DESTINATIONS_CONTEXT_KEY, null))

describe('runtime destinations', () => {
  it('publishes the shared key and fields, cleans page labels, and owns the live browser check', () => {
    publishContext(DESTINATIONS_CONTEXT_KEY, { [DESTINATIONS_CONTEXT_FIELD]: [
      { id: 'project.42', label: ' Project\n42 ' },
      { id: '/settings', label: 'bad id' },
      { id: 'missing-label' },
    ] })
    expect(currentContext()).toContainEqual({ key: 'destinations', data: {
      destinations: [{ id: 'project.42', label: 'Project 42' }],
    } })
    expect(findDestination('project.42')).toEqual({ id: 'project.42', label: 'Project 42' })
    expect(findDestination('/settings')).toBeNull()

    publishContext(DESTINATIONS_CONTEXT_KEY, { destinations: [{ id: 'settings', label: 'Settings' }] })
    expect(findDestination('project.42')).toBeNull()
    expect(findDestination('settings')).toEqual({ id: 'settings', label: 'Settings' })
    publishContext(DESTINATIONS_CONTEXT_KEY, null)
    expect(findDestination('settings')).toBeNull()
  })

  it('caps a long destination list inside the context budget', () => {
    const destinations = Array.from({ length: 400 }, (_, i) => ({ id: `view-${i}`, label: `View ${i} ${'x'.repeat(70)}` }))
    publishContext(DESTINATIONS_CONTEXT_KEY, { destinations })
    const sent = currentContext().find(update => update.key === DESTINATIONS_CONTEXT_KEY)?.data
    expect(sent).toBeDefined()
    expect(contextBytes(sent)).toBeLessThanOrEqual(MAX_CONTEXT_BYTES)
    expect((sent?.destinations as unknown[]).length).toBeLessThan(destinations.length)
    expect(sent?.omitted).toBeGreaterThan(0)
  })
})


describe('page-scoped context', () => {
  it('clears old interface registries without clearing unrelated context', () => {
    publishContext('guide_targets', { targets: [{ id: 'save' }] })
    publishContext('guide_tasks', { tasks: [{ id: 'checkout' }] })
    publishContext(DESTINATIONS_CONTEXT_KEY, { destinations: [{ id: 'project.42', label: 'Project' }] })
    publishContext('app_tasks', { running: [{ id: 'upload' }] })

    clearPageContext()

    expect(currentContext()).not.toContainEqual(expect.objectContaining({ key: 'guide_targets' }))
    expect(currentContext()).not.toContainEqual(expect.objectContaining({ key: 'guide_tasks' }))
    expect(currentContext()).not.toContainEqual(expect.objectContaining({ key: DESTINATIONS_CONTEXT_KEY }))
    expect(currentContext()).toContainEqual({ key: 'app_tasks', data: { running: [{ id: 'upload' }] } })
    expect(findDestination('project.42')).toBeNull()
  })
})
