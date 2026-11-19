import { describe, expect, it } from 'vitest'
import { spokenLength } from './OttoRobot'

const TEXT = 'Hello there, I am Otto. Ask me anything.' // 40 characters

describe('speech bubble timing', () => {
  it('shows the share of the text that matches the share of audio played', () => {
    expect(spokenLength(TEXT, { played: 1, received: 2 }, 0)).toBe(20)
    expect(spokenLength(TEXT, { played: 2, received: 2 }, 0)).toBe(40)
  })

  it('never shows more than the audio could have said, when the transcript runs ahead of its audio', () => {
    // All the text, but only 0.5 s of 0.6 s received has played: 0.5 s at most 24 characters a second.
    expect(spokenLength(TEXT, { played: 0.5, received: 0.6 }, 0)).toBe(12)
  })

  it('never goes backwards, and holds still with no audio yet (or after it was cut off)', () => {
    expect(spokenLength(TEXT, { played: 0.1, received: 2 }, 30)).toBe(30)
    expect(spokenLength(TEXT, null, 12)).toBe(12)
  })
})
