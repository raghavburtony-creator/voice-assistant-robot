import { describe, expect, it } from 'vitest'
import { captureStop, frameDue, frameSize, FRAME_INTERVAL_MS, MAX_FRAME_SIDE } from './capture'

describe('captureStop', () => {
  const running = { open: true, visible: true, trackLive: true }

  it('lets a share go on only while the conversation is open, the tab visible and the track live', () => {
    expect(captureStop(running)).toBeNull()
    expect(captureStop({ ...running, open: false })).toBe('ended')
    expect(captureStop({ ...running, visible: false })).toBe('hidden')
    expect(captureStop({ ...running, trackLive: false })).toBe('track_ended')
  })

  it('names the end of the conversation first', () => {
    expect(captureStop({ open: false, visible: false, trackLive: false })).toBe('ended')
  })
})

describe('frameDue', () => {
  it('sends the first frame at once, then at most one a second', () => {
    expect(frameDue(0, null)).toBe(true)
    expect(frameDue(FRAME_INTERVAL_MS - 1, 0)).toBe(false)
    expect(frameDue(FRAME_INTERVAL_MS, 0)).toBe(true)
  })
})

describe('frameSize', () => {
  it('scales the long side down to the cap and keeps the shape', () => {
    expect(frameSize(1920, 1080)).toEqual({ width: MAX_FRAME_SIDE, height: 432 })
    expect(frameSize(1080, 1920)).toEqual({ width: 432, height: MAX_FRAME_SIDE })
  })

  it('never scales up, and refuses an empty source', () => {
    expect(frameSize(640, 480)).toEqual({ width: 640, height: 480 })
    expect(frameSize(0, 480)).toBeNull()
    expect(frameSize(NaN, 480)).toBeNull()
  })
})
