import { afterEach, describe, expect, it } from 'vitest'
import { DESTINATIONS_CONTEXT_KEY, publishContext } from './context'
import {
  applyBackgroundTask, applyMemoryResult, cancelTaskMessage, currentPageInfo, MAX_BACKGROUND_TASKS, pageMessage, startMessage,
  type BackgroundTask, type MemoryProposalEntry,
} from './useVoiceAssistant'

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

describe('the background tasks the panel lets the visitor stop', () => {
  const job: BackgroundTask = { id: 'task-1', label: 'Search the project docs' }

  it('lists a task when the server says it is working, and drops it when it succeeds, fails or is cancelled', () => {
    const listed = applyBackgroundTask([], { kind: 'working', id: 'task-1', topic: 'Search the project docs' })
    expect(listed).toEqual([job])
    expect(applyBackgroundTask(listed, { kind: 'success', id: 'task-1' })).toEqual([])
    expect(applyBackgroundTask(listed, { kind: 'failure', id: 'task-1', message: 'Cancelled.' })).toEqual([])
  })

  it('labels a task with no topic, and lists each task once', () => {
    expect(applyBackgroundTask([], { kind: 'working', id: 'task-2' })).toEqual([{ id: 'task-2', label: 'Background task' }])
    const once = applyBackgroundTask([job], { kind: 'working', id: 'task-1', topic: 'Again' })
    expect(once).toEqual([job])
  })

  it('leaves the list alone for other events, an end with no id or another id, and an id the server would refuse', () => {
    for (const event of [
      { kind: 'success' as const }, { kind: 'failure' as const, id: 'task-9' }, { kind: 'thinking' as const, id: 'task-1' },
      { kind: 'waiting' as const, message: 'x' }, { kind: 'working' as const, id: 'bad id' }, { kind: 'working' as const, id: '/etc' },
    ]) {
      expect(applyBackgroundTask([job], event)).toEqual([job])
    }
  })

  it('never lists more than the cap', () => {
    let tasks: BackgroundTask[] = []
    for (let n = 0; n < MAX_BACKGROUND_TASKS + 3; n++) tasks = applyBackgroundTask(tasks, { kind: 'working', id: `task-${n}` })
    expect(tasks).toHaveLength(MAX_BACKGROUND_TASKS)
  })

  it('stops one task with a message that holds only its id', () => {
    expect(cancelTaskMessage('task-1')).toEqual({ type: 'cancel_task', id: 'task-1' })
  })
})
