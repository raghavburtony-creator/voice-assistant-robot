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
