import { describe, expect, it } from 'vitest'
import { captureStop, frameDue, frameSize, FRAME_INTERVAL_MS, MASK_PAD, maskBoxes, MAX_FRAME_SIDE } from './capture'

describe('maskBoxes', () => {
  const viewport = { width: 1000, height: 500 }

  it('maps viewport boxes onto the frame, padded', () => {
    expect(maskBoxes([{ x: 100, y: 100, width: 200, height: 50 }], viewport, { width: 500, height: 250 }))
      .toEqual([{ x: (100 - MASK_PAD) / 2, y: (100 - MASK_PAD) / 2, width: (200 + 2 * MASK_PAD) / 2, height: (50 + 2 * MASK_PAD) / 2 }])
  })

  it('clips to the frame and drops empty or off-frame boxes', () => {
    const frame = { width: 1000, height: 500 }
    expect(maskBoxes([{ x: -50, y: 480, width: 100, height: 100 }], viewport, frame))
      .toEqual([{ x: 0, y: 480 - MASK_PAD, width: 50 + MASK_PAD, height: 20 + MASK_PAD }])
    expect(maskBoxes([{ x: 2000, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 10 }], viewport, frame)).toEqual([])
  })

  it('masks nothing for an empty viewport rather than guessing', () => {
    expect(maskBoxes([{ x: 0, y: 0, width: 10, height: 10 }], { width: 0, height: 0 }, { width: 10, height: 10 })).toEqual([])
  })
})

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
