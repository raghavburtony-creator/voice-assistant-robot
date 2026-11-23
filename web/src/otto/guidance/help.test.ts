import { describe, expect, it } from 'vitest'
import { DEFAULT_OTTO_CONFIG } from '../config'
import { createHelpJudge } from './help'

const judge = () => createHelpJudge(() => DEFAULT_OTTO_CONFIG.guidance) // 2 failures within 60 s

describe('help: something happened that the visitor may need help with', () => {
  it('without a help target, nothing is offered: the reaction is enough', () => {
    const j = judge()
    expect(j.consider({ type: 'failure', topic: 'save' }, 0)).toBeNull()
    expect(j.consider({ type: 'failure', topic: 'save' }, 1000)).toBeNull()
    expect(j.consider({ type: 'attention' }, 2000)).toBeNull()
  })

  it('one failure may be a slip; the same failure again is offered help', () => {
    const j = judge()
    expect(j.consider({ type: 'failure', topic: 'save', help: 'email' }, 0)).toBeNull()
    expect(j.consider({ type: 'failure', topic: 'save', help: 'email', message: 'Check the email address.' }, 5000))
      .toMatchObject({ target: 'email', reason: 'app', importance: 'normal', say: 'Check the email address.' })
  })

  it('failures too far apart, of different things, or fixed in between do not add up', () => {
    const j = judge()
    j.consider({ type: 'failure', topic: 'save', help: 'email' }, 0)
    expect(j.consider({ type: 'failure', topic: 'save', help: 'email' }, 61_000)).toBeNull() // outside the window
    expect(j.consider({ type: 'failure', topic: 'upload', help: 'file' }, 62_000)).toBeNull() // another thing
    j.consider({ type: 'success', topic: 'save' }, 63_000)
    expect(j.consider({ type: 'failure', topic: 'save', help: 'email' }, 64_000)).toBeNull()  // fixed, then a fresh slip
  })

  it('a major failure, or attention, is offered at once; major attention is shown', () => {
    const j = judge()
    expect(j.consider({ type: 'failure', importance: 'major', help: 'retry' }, 0)?.importance).toBe('normal')
    expect(j.consider({ type: 'attention', help: 'terms' }, 0)?.importance).toBe('normal')
    expect(j.consider({ type: 'attention', importance: 'major', help: 'terms' }, 0)?.importance).toBe('major')
  })

  it('waiting is offered only when major', () => {
    const j = judge()
    expect(j.consider({ type: 'waiting', help: 'plan' }, 0)).toBeNull()
    expect(j.consider({ type: 'waiting', help: 'plan', importance: 'major' }, 0)).toMatchObject({ target: 'plan' })
  })
})
