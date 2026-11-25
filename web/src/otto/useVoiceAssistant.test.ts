import { afterEach, describe, expect, it } from 'vitest'
import { DESTINATIONS_CONTEXT_KEY, publishContext } from './context'
import { currentPageInfo, pageMessage, startMessage } from './useVoiceAssistant'

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
