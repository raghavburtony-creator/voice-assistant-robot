import { isRuntimeId } from '../runtimeId'

export type GesturePoint = Readonly<{ x: number; y: number }>
export type HandLandmark = Readonly<{ x: number; y: number }>
export type HandFrame = Readonly<{ center: GesturePoint; indexTip: GesturePoint; palmWidth: number; pointing: boolean }>
export type SwipeDirection = 'left' | 'right'

/** Convert camera-axis movement to the mirrored direction the visitor sees in the preview. */
export function mirrorSwipeDirection(direction: SwipeDirection): SwipeDirection {
  return direction === 'left' ? 'right' : 'left'
}
export type GestureDestination = Readonly<{ id: string; label: string }>
export type GestureNavigation = Readonly<{ destinations: readonly GestureDestination[]; onNavigate: (destinationId: string) => void }>

const WRIST = 0
const INDEX_MCP = 5
const INDEX_PIP = 6
const INDEX_TIP = 8
const MIDDLE_MCP = 9
const MIDDLE_PIP = 10
const MIDDLE_TIP = 12
const RING_MCP = 13
const RING_PIP = 14
const RING_TIP = 16
const PINKY_MCP = 17
const PINKY_PIP = 18
const PINKY_TIP = 20

function distance(a: GesturePoint, b: GesturePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function fingerReach(landmarks: readonly HandLandmark[], tip: number, pip: number): number {
  return distance(landmarks[tip], landmarks[WRIST]) - distance(landmarks[pip], landmarks[WRIST])
}

/** Convert a 21-point MediaPipe hand into the minimal data used by the local controller. */
export function describeHand(landmarks: readonly HandLandmark[]): HandFrame | null {
  if (landmarks.length !== 21 || landmarks.some(point =>
    !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < -0.1 || point.x > 1.1 || point.y < -0.1 || point.y > 1.1
  )) return null

  const palmWidth = distance(landmarks[INDEX_MCP], landmarks[PINKY_MCP])
  if (!Number.isFinite(palmWidth) || palmWidth < 0.015) return null

  const palmIndices = [WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP]
  const center = palmIndices.reduce((point, index) => ({
    x: point.x + landmarks[index].x / palmIndices.length,
    y: point.y + landmarks[index].y / palmIndices.length,
  }), { x: 0, y: 0 })

  // Use palm-width-normalised geometry instead of absolute pixel or image-axis tests.
  const indexReach = fingerReach(landmarks, INDEX_TIP, INDEX_PIP) / palmWidth
  const middleReach = fingerReach(landmarks, MIDDLE_TIP, MIDDLE_PIP) / palmWidth
  const ringReach = fingerReach(landmarks, RING_TIP, RING_PIP) / palmWidth
  const pinkyReach = fingerReach(landmarks, PINKY_TIP, PINKY_PIP) / palmWidth
  const pointing = indexReach > 0.12 && middleReach < 0.08 && ringReach < 0.08 && pinkyReach < 0.08

  return {
    center,
    indexTip: { x: Math.max(0, Math.min(1, landmarks[INDEX_TIP].x)), y: Math.max(0, Math.min(1, landmarks[INDEX_TIP].y)) },
    palmWidth,
    pointing,
  }
}

/** Multiple hands are ambiguous for this first controller slice and never produce an actionable frame. */
export function describeSingleHand(hands: readonly (readonly HandLandmark[])[]): HandFrame | null {
  return hands.length === 1 ? describeHand(hands[0]) : null
}

/** Resolve a swipe only against an ordered, host-supplied list of safe runtime IDs. */
export function adjacentGestureDestination(
  destinations: readonly GestureDestination[],
  currentId: string,
  direction: SwipeDirection,
): GestureDestination | null {
  if (destinations.length < 2 || destinations.length > 100) return null
  const seen = new Set<string>()
  for (const destination of destinations) {
    if (!isRuntimeId(destination.id) || !destination.label.trim() || destination.label.length > 80 || seen.has(destination.id)) return null
    seen.add(destination.id)
  }
  const current = destinations.findIndex(destination => destination.id === currentId)
  if (current < 0) return null
  const next = current + (direction === 'left' ? -1 : 1)
  return next >= 0 && next < destinations.length ? destinations[next] : null
}

type Sample = GesturePoint & { time: number; palmWidth: number }

const REST_MS = 360
const COOLDOWN_MS = 900
const MIN_SWIPE_DISTANCE_PW = 1.2
const MIN_SWIPE_DURATION_MS = 120
const MAX_SWIPE_DURATION_MS = 750
const MIN_VELOCITY_PW_PER_SECOND = 2
const MIN_HORIZONTAL_RATIO = 1.6
const MIN_DIRECTION_CONSISTENCY = 0.78

/**
 * A swipe requires a stable pointing pose before movement. Spatial thresholds are normalised
 * by palm width; after one action the hand must leave the pointing pose and settle again.
 */
export class SwipeRecognizer {
  private stillOrigin: Sample | null = null
  private stableSince: number | null = null
  private swipeOrigin: Sample | null = null
  private samples: Sample[] = []
  private cooldownUntil = 0
  private requiresNeutral = false

  reset(): void {
    this.stillOrigin = null
    this.stableSince = null
    this.swipeOrigin = null
    this.samples = []
    this.cooldownUntil = 0
    this.requiresNeutral = false
  }

  update(frame: HandFrame | null, nowMs: number): SwipeDirection | null {
    if (!Number.isFinite(nowMs)) return null
    if (!frame || !frame.pointing || !Number.isFinite(frame.palmWidth) || frame.palmWidth <= 0) {
      this.stillOrigin = null
      this.stableSince = null
      this.swipeOrigin = null
      this.samples = []
      if (this.requiresNeutral) this.requiresNeutral = false
      return null
    }

    const sample: Sample = { ...frame.center, time: nowMs, palmWidth: frame.palmWidth }
    if (!this.swipeOrigin) {
      if (!this.stillOrigin || this.stableSince === null) {
        this.stillOrigin = sample
        this.stableSince = nowMs
        return null
      }

      const scale = Math.max(0.001, (this.stillOrigin.palmWidth + sample.palmWidth) / 2)
      if (distance(sample, this.stillOrigin) / scale > 0.12) {
        this.stillOrigin = sample
        this.stableSince = nowMs
        return null
      }
      if (this.requiresNeutral || nowMs < this.cooldownUntil || nowMs - this.stableSince < REST_MS) return null

      this.swipeOrigin = { ...this.stillOrigin, time: nowMs, palmWidth: sample.palmWidth }
      this.samples = [this.swipeOrigin, sample]
      return null
    }

    this.samples.push(sample)
    if (this.samples.length > 60) this.samples.shift()
    const scale = Math.max(0.001, (this.swipeOrigin.palmWidth + sample.palmWidth) / 2)
    const dx = (sample.x - this.swipeOrigin.x) / scale
    const dy = (sample.y - this.swipeOrigin.y) / scale
    const duration = nowMs - this.swipeOrigin.time

    if (duration > MAX_SWIPE_DURATION_MS) {
      this.swipeOrigin = null
      this.samples = []
      this.stillOrigin = sample
      this.stableSince = nowMs
      return null
    }

    if (duration >= MIN_SWIPE_DURATION_MS && Math.abs(dx) >= MIN_SWIPE_DISTANCE_PW) {
      const direction = dx < 0 ? -1 : 1
      const horizontalRatio = Math.abs(dx) / Math.max(Math.abs(dy), 0.015)
      const velocity = Math.abs(dx) / (duration / 1000)
      const consistency = this.directionConsistency(direction, scale)
      if (horizontalRatio >= MIN_HORIZONTAL_RATIO && velocity >= MIN_VELOCITY_PW_PER_SECOND && consistency >= MIN_DIRECTION_CONSISTENCY) {
        this.cooldownUntil = nowMs + COOLDOWN_MS
        this.requiresNeutral = true
        this.stillOrigin = null
        this.stableSince = null
        this.swipeOrigin = null
        this.samples = []
        return direction < 0 ? 'left' : 'right'
      }
    }
    return null
  }

  private directionConsistency(direction: number, scale: number): number {
    let steps = 0
    let matching = 0
    for (let index = 1; index < this.samples.length; index += 1) {
      const delta = (this.samples[index].x - this.samples[index - 1].x) / scale
      if (Math.abs(delta) < 0.02) continue
      steps += 1
      if (Math.sign(delta) === direction) matching += 1
    }
    return steps === 0 ? 0 : matching / steps
  }
}