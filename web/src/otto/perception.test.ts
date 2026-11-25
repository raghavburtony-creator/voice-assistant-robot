import { describe, expect, it } from 'vitest'
import { canPublishPerception, perceptionEvent } from './perception'

describe('perception contracts', () => {
  it('creates provider-independent observation metadata', () => {
    const event = perceptionEvent('camera', 'frame', 'granted', { width: 768 }, 123)

    expect(event).toMatchObject({
      source: 'camera',
      kind: 'frame',
      consent: 'granted',
      timestamp: 123,
      metadata: { width: 768 },
    })
    expect(event.id).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('rejects revoked observations', () => {
    const event = perceptionEvent('screen', 'frame', 'revoked', {}, 123)
    expect(canPublishPerception(event)).toBe(false)
  })

  it('accepts granted observations', () => {
    const event = perceptionEvent('browser', 'context', 'granted', { page: 'home' }, 123)
    expect(canPublishPerception(event)).toBe(true)
  })
})
