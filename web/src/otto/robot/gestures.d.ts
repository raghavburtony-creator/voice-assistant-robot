// Types for gestures.js. The implementation is plain JavaScript with no imports, so the no-build preview
// (preview/index.html) loads the very same file the app does. Keep this file and gestures.js in step.

export type GestureName = 'welcomeWave' | 'celebrate' | 'nod' | 'headShake' | 'thinkingHand' | 'goodbyeWave'

export declare const GESTURE_NAMES: readonly GestureName[]

/** The parts a gesture can move. A gesture only masks the base animation of the parts it declares. */
export type GesturePart = 'head' | 'handL' | 'handR'

/** Offsets added on top of the base pose (radians for r*, model units for p*). Missing fields are 0. */
export type HeadOffsets = { rx: number; ry: number; rz: number; py: number }
export type HandOffsets = { px: number; py: number; pz: number; rx: number; rz: number }

/** What the controller produces each frame. The scene adds the offsets to its own damped base pose. */
export type GestureFrame = {
  head: HeadOffsets
  handL: HandOffsets
  handR: HandOffsets
  /** 0..1, multiply the pointer head-tracking target by this (1 = full tracking, 0 = none). */
  look: number
  /** 0..1 per arm, multiply that arm's base motion (idle sway, talk motion) by this. */
  baseL: number
  baseR: number
  /** The gestures contributing this frame, for debugging and the lab. */
  active: GestureName[]
}

export type GestureDef = {
  /** Seconds for one play (a held gesture loops its sustain after `attack`). */
  duration: number
  /** Seconds to blend in and out. */
  attack: number
  release: number
  parts: readonly GesturePart[]
  /** How much pointer tracking survives while this plays at full weight (0..1). */
  look: number
  /** Higher interrupts lower; equal interrupts too. */
  priority: number
  /** Offsets at normalised time u (0..1 over `duration`) and absolute time t (seconds since start), before weighting. */
  sample: (u: number, t: number) => { head?: Partial<HeadOffsets>; handL?: Partial<HandOffsets>; handR?: Partial<HandOffsets> }
}

export declare const GESTURES: Readonly<Record<GestureName, GestureDef>>

export type GestureOptions = {
  /** Scales the motion, 0..1.5. Multiplied by the controller's intensity. */
  intensity?: number
  /** Ignore priority and cooldown. */
  force?: boolean
}

export type GestureControllerOptions = {
  intensity?: number
  /** Reduced motion: one-shot gestures are skipped; held gestures still show, at `reducedIntensity`. */
  reducedMotion?: boolean
  reducedIntensity?: number
  /** The same gesture is not restarted within this many seconds unless forced. */
  cooldown?: number
}

export type GestureController = {
  /** Plays a one-shot. Returns false when it was refused (unknown, reduced motion, lower priority, cooldown). */
  play(name: GestureName, options?: GestureOptions): boolean
  /** Holds a gesture until release() (the pose layer: e.g. thinkingHand while thinking). One held gesture at a time. */
  hold(name: GestureName | null, options?: GestureOptions): void
  release(): void
  /** Blends every gesture out (never snaps). */
  stop(): void
  setReducedMotion(on: boolean): void
  setIntensity(value: number): void
  /** Advances by dt seconds (clamped to 0.1) and returns this frame's offsets. Reuses one object: do not keep it. */
  update(dt: number): GestureFrame
}

export declare function createGestureController(options?: GestureControllerOptions): GestureController

/** A tiny pub/sub that carries gesture requests from app code to whichever robot scene is mounted. */
export type GestureCommand =
  | { type: 'play'; name: GestureName; options?: GestureOptions }
  | { type: 'hold'; name: GestureName | null; options?: GestureOptions }
  | { type: 'stop' }

export type GestureChannel = {
  play(name: GestureName, options?: GestureOptions): void
  hold(name: GestureName | null, options?: GestureOptions): void
  stop(): void
  /** Returns an unsubscribe function. */
  subscribe(listener: (command: GestureCommand) => void): () => void
}

export declare function createGestureChannel(): GestureChannel

export declare function isGestureName(value: unknown): value is GestureName
