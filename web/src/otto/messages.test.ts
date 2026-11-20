import { describe, expect, it } from 'vitest'
import { parseServerMessage, toAssistantAction } from './messages'

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
