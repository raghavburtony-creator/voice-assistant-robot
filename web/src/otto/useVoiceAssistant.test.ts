import { afterEach, describe, expect, it } from 'vitest'
import { DESTINATIONS_CONTEXT_KEY, publishContext } from './context'
import { applyMemoryResult, currentPageInfo, pageMessage, startMessage, type MemoryProposalEntry } from './useVoiceAssistant'

afterEach(() => publishContext(DESTINATIONS_CONTEXT_KEY, null))

describe('the current page on the voice protocol', () => {
  it('keeps configured pages and reported runtime destination ids in start and page updates', () => {
    publishContext(DESTINATIONS_CONTEXT_KEY, { destinations: [{ id: 'project.42', label: 'Project 42' }] })
    expect(startMessage('en', 'home', 'short')).toEqual({
      type: 'start', language: 'en', page: 'home', title: 'Home', detail: 'short',
    })
    expect(startMessage('en', 'project.42', 'detailed')).toEqual({
      type: 'start', language: 'en', page: 'project.42', title: 'Project 42', detail: 'detailed',
    })
    expect(pageMessage('project.42')).toEqual({ type: 'page', page: 'project.42', title: 'Project 42' })
  })

  it('uses the runtime id as title when the current destination has no live label', () => {
    expect(pageMessage('settings:team')).toEqual({ type: 'page', page: 'settings:team', title: 'settings:team' })
  })

  it('never sends a route, URL, sentence, or malformed runtime id as the current page', () => {
    for (const unsafe of ['/settings', 'https://example.com/project/42', 'project 42', '-project', 'x'.repeat(65)]) {
      expect(currentPageInfo(unsafe)).toEqual({ page: 'home', title: 'Home' })
      expect(pageMessage(unsafe)).toEqual({ type: 'page', page: 'home', title: 'Home' })
      expect(startMessage('en', unsafe, 'short').page).toBe('home')
    }
  })
})

describe('the server\'s answer to a memory proposal', () => {
  const id = 'a'.repeat(32)
  const entry = (status: MemoryProposalEntry['status']): MemoryProposalEntry =>
    ({ type: 'memory_proposal', request_id: id, content: 'Prefers short answers', kind: 'semantic', redacted: false, status })

  it('moves an open proposal to the answered status', () => {
    for (const open of ['pending', 'saving', 'discarding'] as const) {
      expect(applyMemoryResult([entry(open)], id, 'saved')[0].status).toBe('saved')
    }
    expect(applyMemoryResult([entry('saving')], id, 'expired')[0].status).toBe('expired')
  })

  it('never changes a proposal that already has its answer', () => {
    for (const done of ['saved', 'discarded', 'expired', 'unavailable', 'failed'] as const) {
      expect(applyMemoryResult([entry(done)], id, 'expired')[0].status).toBe(done)
    }
  })

  it('leaves other proposals alone', () => {
    const other = { ...entry('pending'), request_id: 'b'.repeat(32) }
    const [first, second] = applyMemoryResult([entry('saving'), other], id, 'saved')
    expect([first.status, second.status]).toEqual(['saved', 'pending'])
  })
})
