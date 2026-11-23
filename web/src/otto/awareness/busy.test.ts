import { describe, expect, it } from 'vitest'
import { BUSY_ENDED_MAX, BUSY_RUNNING_MAX, BUSY_TEXT_CHARS, busyContext, EMPTY_BUSY, nextBusy, type BusyState } from './busy'
import { createOttoEvents, type OttoEvent } from './events'

/** A real event channel whose events are folded into `state`. */
const tracked = () => {
  const events = createOttoEvents()
  const out = { events, state: EMPTY_BUSY as BusyState }
  events.subscribe(e => { out.state = nextBusy(out.state, e) })
  return out
}

describe('nextBusy', () => {
  it('tracks a task from open to succeeded, failed or done', () => {
    const t = tracked()
    const upload = t.events.task('up', { topic: 'upload' })
    expect(t.state).toEqual({ running: [{ id: 'up', topic: 'upload', outcome: 'running' }], ended: [] })
    upload.succeed('Uploaded 3 files.')
    expect(t.state).toEqual({ running: [], ended: [{ id: 'up', topic: 'upload', outcome: 'succeeded', message: 'Uploaded 3 files.' }] })
    upload.fail('late') // a handle ends once
    expect(t.state.ended).toHaveLength(1)

    t.events.task('render', { topic: 'render' }).fail('Out of memory.')
    t.events.task('sync').done()
    expect(t.state.ended.map(e => [e.id, e.outcome])).toEqual([['sync', 'complete'], ['render', 'failed'], ['up', 'succeeded']])
    expect(t.state.ended[1].message).toBe('Out of memory.')
  })

  it('ignores events that are not about a task handle, and endings for a handle that is not open', () => {
    const notTask: OttoEvent = { type: 'success', topic: 'save' }
    expect(nextBusy(EMPTY_BUSY, notTask)).toBe(EMPTY_BUSY)
    expect(nextBusy(EMPTY_BUSY, { type: 'failure', task: 'ghost' })).toBe(EMPTY_BUSY)
    expect(busyContext(EMPTY_BUSY)).toBeNull()
  })

  it('drops old entries at the caps and cuts long text', () => {
    const open = tracked()
    for (let i = 0; i < BUSY_RUNNING_MAX + 2; i++) open.events.task(`open${i}`)
    expect(open.state.running.map(e => e.id)).toEqual(['open2', 'open3', 'open4', 'open5', 'open6']) // the oldest open ones drop

    const t = tracked()
    for (let i = 0; i < BUSY_ENDED_MAX + 2; i++) t.events.task(`job${i}`, { message: 'm'.repeat(500) }).done()
    expect(t.state.ended).toHaveLength(BUSY_ENDED_MAX)
    expect(t.state.ended[0].id).toBe(`job${BUSY_ENDED_MAX + 1}`) // newest first
    expect(t.state.ended[0].message).toHaveLength(BUSY_TEXT_CHARS)
    expect(t.state.ended[0].message!.endsWith('…')).toBe(true)
  })
})
