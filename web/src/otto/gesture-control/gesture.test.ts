import { describe, expect, it } from 'vitest'
import { adjacentGestureDestination, describeHand, describeSingleHand, SwipeRecognizer, type HandFrame } from './gesture'

const frame = (x: number, y = 0.5, pointing = true, palmWidth = 0.1): HandFrame => ({
  center: { x, y }, indexTip: { x, y: y - 0.1 }, palmWidth, pointing,
})

function settle(recognizer: SwipeRecognizer, x = 0.3, y = 0.5, palmWidth = 0.1) {
  for (let time = 0; time <= 360; time += 40) recognizer.update(frame(x, y, true, palmWidth), time)
}

function swipe(recognizer: SwipeRecognizer, startX: number, direction: -1 | 1, startTime = 400, palmWidth = 0.1): string | null {
  let result: string | null = null
  for (let step = 1; step <= 8; step += 1) {
    const x = startX + direction * 0.2 * palmWidth * step
    result = recognizer.update(frame(x, 0.5, true, palmWidth), startTime + step * 40) ?? result
  }
  return result
}

function pointingLandmarks(open = false) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }))
  points[0] = { x: 0.5, y: 0.85 }
  points[5] = { x: 0.38, y: 0.62 }
  points[6] = { x: 0.38, y: 0.46 }
  points[8] = { x: 0.38, y: 0.27 }
  points[9] = { x: 0.47, y: 0.62 }
  points[10] = { x: 0.47, y: 0.49 }
  points[12] = { x: 0.49, y: open ? 0.2 : 0.60 }
  points[13] = { x: 0.55, y: 0.62 }
  points[14] = { x: 0.55, y: 0.49 }
  points[16] = { x: 0.57, y: open ? 0.2 : 0.60 }
  points[17] = { x: 0.64, y: 0.62 }
  points[18] = { x: 0.64, y: 0.49 }
  points[20] = { x: 0.66, y: open ? 0.2 : 0.60 }
  return points
}

describe('hand geometry', () => {
  it('requires exactly 21 valid landmarks and rejects multiple hands', () => {
    expect(describeHand([])).toBeNull()
    expect(describeSingleHand([])).toBeNull()
    expect(describeSingleHand([[{ x: Number.NaN, y: 0 }]])).toBeNull()
    expect(describeSingleHand([pointingLandmarks(), pointingLandmarks()])).toBeNull()
  })

  it('recognises a single index-pointing pose and measures palm width', () => {
    const result = describeHand(pointingLandmarks())
    expect(result?.pointing).toBe(true)
    expect(result?.indexTip).toEqual({ x: 0.38, y: 0.27 })
    expect(result?.palmWidth).toBeCloseTo(0.26)
  })

  it('does not treat an open hand as a navigation pose', () => {
    expect(describeHand(pointingLandmarks(true))?.pointing).toBe(false)
  })
})

describe('deliberate swipe recognition', () => {
  it('detects a deliberate right swipe after a stable pointing pose', () => {
    const recognizer = new SwipeRecognizer()
    settle(recognizer)
    expect(swipe(recognizer, 0.3, 1)).toBe('right')
  })

  it('detects a deliberate left swipe after a stable pointing pose', () => {
    const recognizer = new SwipeRecognizer()
    settle(recognizer, 0.6)
    expect(swipe(recognizer, 0.6, -1)).toBe('left')
  })

  it('uses palm-width-normalised distance at a different camera scale', () => {
    const recognizer = new SwipeRecognizer()
    settle(recognizer, 0.3, 0.5, 0.2)
    expect(swipe(recognizer, 0.3, 1, 400, 0.2)).toBe('right')
  })

  it('requires a neutral pose and cooldown before another swipe can fire', () => {
    const recognizer = new SwipeRecognizer()
    settle(recognizer)
    expect(swipe(recognizer, 0.3, 1)).toBe('right')
    expect(recognizer.update(frame(0.46, 0.5, false), 760)).toBeNull()
    for (let time = 800; time <= 1200; time += 40) expect(recognizer.update(frame(0.46), time)).toBeNull()
    for (let time = 1240; time <= 1560; time += 40) expect(recognizer.update(frame(0.46), time)).toBeNull()
    expect(swipe(recognizer, 0.46, -1, 1600)).toBe('left')
  })
  it('rejects an open-palm wave', () => {
    const recognizer = new SwipeRecognizer()
    for (let time = 0; time <= 1800; time += 40) {
      const x = 0.5 + Math.sin(time / 120) * 0.12
      expect(recognizer.update(frame(x, 0.5, false), time)).toBeNull()
    }
  })

  it('rejects movement that began before the rest period', () => {
    const recognizer = new SwipeRecognizer()
    for (let time = 0; time <= 1000; time += 40) expect(recognizer.update(frame(0.2 + time * 0.0005), time)).toBeNull()
  })

  it('rejects diagonal movement', () => {
    const recognizer = new SwipeRecognizer()
    settle(recognizer)
    let result: string | null = null
    for (let step = 1; step <= 8; step += 1) result = recognizer.update(frame(0.3 + step * 0.02, 0.5 + step * 0.02), 400 + step * 40) ?? result
    expect(result).toBeNull()
  })

  it('does not repeat while the pointing gesture remains held', () => {
    const recognizer = new SwipeRecognizer()
    settle(recognizer)
    expect(swipe(recognizer, 0.3, 1)).toBe('right')
    for (let time = 760; time < 1600; time += 40) expect(recognizer.update(frame(0.46), time)).toBeNull()
  })
})

describe('host destination allow-list', () => {
  const destinations = [{ id: 'home', label: 'Home' }, { id: 'features', label: 'Features' }, { id: 'about', label: 'About' }] as const
  it('moves only to the adjacent registered destination', () => {
    expect(adjacentGestureDestination(destinations, 'features', 'left')?.id).toBe('home')
    expect(adjacentGestureDestination(destinations, 'features', 'right')?.id).toBe('about')
  })
  it('does not wrap at the ends or accept an unknown current page', () => {
    expect(adjacentGestureDestination(destinations, 'home', 'left')).toBeNull()
    expect(adjacentGestureDestination(destinations, 'about', 'right')).toBeNull()
    expect(adjacentGestureDestination(destinations, 'admin', 'right')).toBeNull()
  })
  it('rejects invalid, duplicate and oversized destination registries', () => {
    expect(adjacentGestureDestination([{ id: 'https://example.com', label: 'External' }, ...destinations], 'home', 'right')).toBeNull()
    expect(adjacentGestureDestination([{ id: 'home', label: 'Home' }, { id: 'home', label: 'Duplicate' }], 'home', 'right')).toBeNull()
    const large = Array.from({ length: 101 }, (_, index) => ({ id: 'page-' + index, label: 'Page ' + index }))
    expect(adjacentGestureDestination(large, 'page-0', 'right')).toBeNull()
  })
})