import { describe, expect, it } from 'vitest'
import { parseServerMessage, toAssistantAction } from './messages'

describe('navigation actions', () => {
  it('accepts a static page or a live reported destination, as an id only', () => {
    const live = (id: string) => id === 'project.42'
    expect(toAssistantAction({ action: 'navigate', page: 'home' })).toEqual({ action: 'navigate', page: 'home' })
    expect(toAssistantAction({ action: 'navigate', page: 'project.42' }, undefined, undefined, live))
      .toEqual({ action: 'navigate', page: 'project.42' })
    expect(toAssistantAction({ action: 'navigate', page: 'old-project' }, undefined, undefined, live)).toBeNull()
    expect(toAssistantAction({ action: 'navigate', page: 'https://example.com' }, undefined, undefined, () => true)).toBeNull()
    expect(toAssistantAction({ action: 'navigate', page: '/settings' }, undefined, undefined, () => true)).toBeNull()
    expect(toAssistantAction({ action: 'navigate', page: 42 }, undefined, undefined, () => true)).toBeNull()
  })
})

describe('guide actions', () => {
  it('passes the target through the schema', () => {
    const m = parseServerMessage('{"type":"action","action":"guide","target":"save"}')
    expect(m).toMatchObject({ type: 'action', action: 'guide', target: 'save' })
  })
  it('accepts only a target the page has', () => {
    const on = (id: string) => id === 'save'
    expect(toAssistantAction({ action: 'guide', target: 'save' }, on)).toEqual({ action: 'guide', target: 'save' })
    expect(toAssistantAction({ action: 'guide', target: 'nope' }, on)).toBeNull()
    expect(toAssistantAction({ action: 'guide', target: 'save' })).toBeNull()
    expect(toAssistantAction({ action: 'guide', target: 5 }, () => true)).toBeNull()
  })
})

describe('task actions', () => {
  it('start only a task the page offered, checked again in the browser', () => {
    const m = parseServerMessage('{"type":"action","action":"task","task":"show-message"}')
    expect(m).toMatchObject({ type: 'action', action: 'task', task: 'show-message' })
    const offered = (id: string) => id === 'show-message'
    expect(toAssistantAction({ action: 'task', task: 'show-message' }, undefined, offered)).toEqual({ action: 'task', task: 'show-message' })
    expect(toAssistantAction({ action: 'task', task: 'nope' }, undefined, offered)).toBeNull()
    expect(toAssistantAction({ action: 'task', task: 'show-message' })).toBeNull() // no check given: refused
    expect(toAssistantAction({ action: 'task', task: 7 }, undefined, () => true)).toBeNull()
  })
})

describe('task moves', () => {
  it('pass only stop, back or next, checked again in the browser', () => {
    const m = parseServerMessage('{"type":"action","action":"task_move","move":"back"}')
    expect(m).toMatchObject({ type: 'action', action: 'task_move', move: 'back' })
    for (const move of ['stop', 'back', 'next'] as const) expect(toAssistantAction({ action: 'task_move', move })).toEqual({ action: 'task_move', move })
    for (const move of ['skip', 'goto', 'STOP', '', 3, null, undefined]) expect(toAssistantAction({ action: 'task_move', move })).toBeNull()
  })
})

describe('avatar messages', () => {
  it('pass the schema; the event inside is checked by parseAvatarEvent, not trusted here', () => {
    expect(parseServerMessage('{"type":"avatar","event":{"kind":"working","id":"r1"}}')).toMatchObject({ type: 'avatar', event: { kind: 'working', id: 'r1' } })
    expect(parseServerMessage('{"type":"avatar","event":"anything"}')).toMatchObject({ type: 'avatar' })
  })
})

describe('card actions', () => {
  it('pass the schema and come out as plain, capped text', () => {
    const m = parseServerMessage(JSON.stringify({ type: 'action', action: 'card', card: { title: 'Steps', body: 'One.' } }))
    expect(m).toMatchObject({ type: 'action', action: 'card' })
    const card = { title: ' Steps\u0000 ', body: 'a\n\nb', code: 'x\n\ty\u0007  \n', follow_ups: ['Next?', 3, '', 'b'.repeat(200), 'c', 'd'] }
    expect(toAssistantAction({ action: 'card', card })).toEqual({ action: 'card', card: {
      title: 'Steps', body: 'a b', code: 'x\n\ty', followUps: ['Next?', 'b'.repeat(80), 'c'],
    } })
    const long = toAssistantAction({ action: 'card', card: { title: 't'.repeat(500), body: 'b'.repeat(5000), code: 'c'.repeat(9000) } })
    expect(long?.action === 'card' && [long.card.title.length, long.card.body.length, long.card.code?.length]).toEqual([80, 600, 2000])
  })
  it('refuse a card with no title or body, or of the wrong shape', () => {
    for (const card of [undefined, null, 'x', {}, { title: 'T' }, { title: '  ', body: 'b' }, { title: 'T', body: 5 }, { title: 'T', body: 'b', follow_ups: 'no' }])
      expect(toAssistantAction({ action: 'card', card })).toBeNull()
  })
})
