import { describe, expect, it } from 'vitest'
import { createFrictionJudge, FRICTION_OFFER, type FrictionSettings } from './friction'

const ON: FrictionSettings = { proactiveHelpEnabled: true, frictionCooldownMs: 60_000, helpAfterFailures: 2, helpWindowMs: 60_000 }
const judge = (over: Partial<FrictionSettings> = {}) => createFrictionJudge(() => ({ ...ON, ...over }))
const fail = { kind: 'failedSubmit', form: 'f', target: 'email', message: 'Include an @.' } as const

describe('friction judge', () => {
  it('one refused submit may be a slip; the second within the window gets a quiet offer', () => {
    const j = judge()
    expect(j.consider(fail, 0)).toBeNull()
    expect(j.consider(fail, 1000)).toEqual({
      target: 'email', reason: 'app', importance: 'normal', mode: 'offer', offer: FRICTION_OFFER, say: 'Include an @.', why: 'failed 2 times: offer',
    })
  })
  it('failures outside the window do not add up; a form that went through forgets them', () => {
    const j = judge()
    j.consider(fail, 0)
    expect(j.consider(fail, 61_000)).toBeNull()
    j.consider({ kind: 'fixed', form: 'f' }, 62_000)
    expect(j.consider(fail, 63_000)).toBeNull()
  })
  it('off by default in the config: never an offer', () => {
    const j = judge({ proactiveHelpEnabled: false })
    j.consider(fail, 0)
    expect(j.consider(fail, 1)).toBeNull()
    expect(j.consider({ kind: 'stalled', form: 'f', target: 'email' }, 2)).toBeNull()
  })
  it('one offer per cooldown, and none without a target to show', () => {
    const j = judge()
    expect(j.consider({ kind: 'stalled', form: 'f' }, 0)).toBeNull()
    expect(j.consider({ kind: 'stalled', form: 'f', target: 'email' }, 0)?.why).toBe('stalled on an invalid field: offer')
    expect(j.consider({ kind: 'stalled', form: 'f', target: 'email' }, 30_000)).toBeNull()
    expect(j.consider({ kind: 'stalled', form: 'f', target: 'email' }, 60_000)).not.toBeNull()
  })
})
