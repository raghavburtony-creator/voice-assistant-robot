// Otto's gestures: short body-language moves (waves, nods...) layered on top of the robot's base animation.
// A gesture is pure math: sample(u, t) returns offsets for the head, arms and face. The controller weights them with a
// smoothstep envelope, so nothing ever snaps on start, end, interrupt or stop. No React and no WebGL here.
//
// Channels are the Clay Robot's rig (web/src/components/originkit/ui/clay-robot.tsx), mapped in ClayScene.tsx:
//   head  rx  nod, + dips the face down      ry  turn, + toward the viewer's right
//         rz  tilt, + crown to viewer's left lift  whole robot up (scene units)
//   handL / handR (viewer's left / right)  raise  outward and up from hanging (rad)
//         swing  forward (+) / back at the shoulder (rad)      ext  stretch the clay arm, 0..1
//   face  joy  happy arc eyes, 0..1          lookX / lookY  shift the gaze on the screen

export const GESTURE_NAMES = ['welcomeWave', 'celebrate', 'nod', 'headShake', 'thinkingHand', 'goodbyeWave', 'lookAround', 'stretch', 'pointLeft', 'pointRight'] as const
export type GestureName = (typeof GESTURE_NAMES)[number]

export const isGestureName = (value: unknown): value is GestureName =>
  typeof value === 'string' && (GESTURE_NAMES as readonly string[]).includes(value)

export type HeadOffsets = { rx: number; ry: number; rz: number; lift: number }
export type ArmOffsets = { raise: number; swing: number; ext: number }
export type FaceOffsets = { joy: number; lookX: number; lookY: number }
type Channels = { head: HeadOffsets; handL: ArmOffsets; handR: ArmOffsets; face: FaceOffsets }
export type GesturePart = keyof Channels
type Sample = { [P in GesturePart]?: Partial<Channels[P]> }

const KEYS: { [P in GesturePart]: (keyof Channels[P])[] } = {
  head: ['rx', 'ry', 'rz', 'lift'],
  handL: ['raise', 'swing', 'ext'],
  handR: ['raise', 'swing', 'ext'],
  face: ['joy', 'lookX', 'lookY'],
}
const PARTS = Object.keys(KEYS) as GesturePart[]

export type GestureDef = {
  /** Seconds for one play (a held gesture loops its sustain after `attack`). */
  duration: number
  /** Seconds to blend in and out. */
  attack: number
  release: number
  parts: readonly GesturePart[]
  /** How much cursor tracking survives while this plays at full weight (0..1). */
  look: number
  /** Higher interrupts lower; equal interrupts too. */
  priority: number
  /** Offsets at normalised time u (0..1 over `duration`) and seconds since start t, before weighting. Return the same keys every call. */
  sample: (u: number, t: number) => Sample
}

const TAU = Math.PI * 2
const smoothstep = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k) }
const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

// A wave with the right arm: raised and stretched so the hand clears the helmet, swaying at the shoulder.
const wave = (t: number, hz: number, sway: number) => ({ raise: 1.72 + sway * Math.sin(TAU * hz * t), swing: 0, ext: 1 })

// Showing a spot on the viewer's side: the arm out roughly level and stretched, a small settle, the head turned and tilted that way.
const point = (arm: 'handL' | 'handR', side: -1 | 1): GestureDef => ({
  duration: 1.6, attack: 0.25, release: 0.4, parts: [arm, 'head', 'face'], look: 0.3, priority: 2,
  sample: u => {
    const settle = 0.06 * Math.sin(TAU * 1.5 * u)
    return { [arm]: { raise: 1.3 + settle, swing: 0.15, ext: 1 }, head: { ry: 0.3 * side, rz: -0.08 * side, rx: -0.04 }, face: { lookX: 0.25 * side } }
  } })

/** Offsets are added to the base pose; the robot's hanging arm is raise 0. */
export const GESTURES: Readonly<Record<GestureName, GestureDef>> = {
  welcomeWave: { duration: 2, attack: 0.3, release: 0.4, parts: ['handR', 'head', 'face'], look: 0.7, priority: 2,
    sample: (_u, t) => ({ handR: wave(t, 2.3, 0.3), head: { rz: -0.08, rx: -0.06 }, face: { joy: 1 } }) },
  goodbyeWave: { duration: 2.4, attack: 0.3, release: 0.55, parts: ['handR', 'head', 'face'], look: 0.7, priority: 2,
    // A slower, wider wave, then a small bow at the end.
    sample: (u, t) => ({ handR: wave(t, 1.6, 0.38), head: { rz: -0.08, rx: -0.04 + 0.16 * smoothstep(0.7, 1, u) }, face: { joy: 1 } }) },
  celebrate: { duration: 1.8, attack: 0.28, release: 0.35, parts: ['handL', 'handR', 'head', 'face'], look: 0.4, priority: 3,
    // Both arms up, pumping in turn, and a couple of little hops.
    sample: (_u, t) => {
      const s = Math.sin(TAU * 2.2 * t), c = Math.cos(TAU * 2.2 * t)
      return {
        handL: { raise: 1.95 + 0.25 * s, swing: 0, ext: 1 },
        handR: { raise: 1.95 + 0.25 * c, swing: 0, ext: 1 },
        head: { rx: -0.14, lift: 0.35 * Math.abs(Math.sin(TAU * 1.1 * t)) },
        face: { joy: 1 },
      }
    } },
  nod: { duration: 0.75, attack: 0.08, release: 0.15, parts: ['head'], look: 0.5, priority: 1,
    sample: u => ({ head: { rx: 0.2 * Math.sin(TAU * u) } }) },
  headShake: { duration: 1, attack: 0.1, release: 0.2, parts: ['head'], look: 0.1, priority: 2,
    sample: u => { const s = Math.sin(TAU * 3 * u) * (1 - 0.6 * u); return { head: { ry: 0.3 * s, rz: 0.04 * s, rx: 0.05 } } } },
  // Held while thinking: the right hand up under the visor like a hand on the chin, head tilted, eyes up and aside.
  thinkingHand: { duration: 3, attack: 0.45, release: 0.4, parts: ['handR', 'head', 'face'], look: 0.3, priority: 0,
    sample: (_u, t) => ({
      handR: { raise: -0.4 + 0.03 * Math.sin(2.4 * t), swing: 2.2, ext: 0.5 },
      head: { rz: 0.16, rx: -0.1, ry: 0.05 * Math.sin(0.5 * t) },
      face: { lookX: -0.22, lookY: 0.22 },
    }) },
  // Idle: a slow look to one side, then the other, eyes leading the head. The lowest priority: anything else cuts in.
  lookAround: { duration: 3.4, attack: 0.5, release: 0.6, parts: ['head', 'face'], look: 0.15, priority: -1,
    sample: u => {
      const side = Math.sin(TAU * u) * smoothstep(0, 0.15, u) * (1 - smoothstep(0.85, 1, u))
      const eyes = Math.sin(TAU * Math.min(1, u * 1.08))
      return { head: { ry: 0.38 * side, rx: -0.05 * Math.abs(side) }, face: { lookX: 0.22 * eyes, lookY: 0.04 } }
    } },
  // Idle: both arms up and out, a lean back, and down again, as after sitting still too long.
  stretch: { duration: 2.6, attack: 0.6, release: 0.7, parts: ['handL', 'handR', 'head', 'face'], look: 0.2, priority: -1,
    sample: u => {
      const up = smoothstep(0.05, 0.4, u) * (1 - smoothstep(0.7, 0.98, u))
      return {
        handL: { raise: 1.5 * up, swing: 0, ext: 0.7 * up },
        handR: { raise: 1.5 * up, swing: 0, ext: 0.7 * up },
        head: { rx: -0.16 * up, lift: 0.12 * up },
        face: { joy: 0.6 * up },
      }
    } },
  pointLeft: point('handL', -1),
  pointRight: point('handR', 1),
}

export type GestureFrame = Channels & {
  /** 0..1: multiply the cursor head-tracking by this (1 = full tracking, 0 = none). */
  look: number
  /** 0..1 per arm: multiply that arm's base motion by this. */
  baseL: number
  baseR: number
  /** The gestures contributing this frame, for debugging and the lab. */
  active: GestureName[]
}

export type GestureOptions = {
  /** Scales the motion, 0..1.5. Multiplied by the controller's intensity. */
  intensity?: number
  /** Ignore priority and cooldown (never reduced motion). */
  force?: boolean
}

/** Why a gesture ended: it ran its course, a new one cut in, stop() or reduced motion ended it, or a held one was let go. */
export type GestureEndReason = 'finished' | 'interrupted' | 'stopped' | 'released'

/** Reported when a gesture starts or ends ("ended" is logical: its fade-out follows over its release time). */
export type GestureEvent =
  | { type: 'start'; name: GestureName; held: boolean }
  | { type: 'end'; name: GestureName; held: boolean; reason: GestureEndReason }

export type GestureControllerOptions = {
  /** Called for every gesture start and end. */
  onEvent?: (event: GestureEvent) => void
  intensity?: number
  /** Reduced motion: one-shot gestures are skipped; held gestures still show, at `reducedIntensity`. */
  reducedMotion?: boolean
  reducedIntensity?: number
  /** The same gesture is not restarted within this many seconds unless forced. */
  cooldown?: number
}

export type GestureController = {
  /** Plays a one-shot. Returns false when it was refused (unknown, reduced motion, intensity 0, lower priority, cooldown). */
  play(name: GestureName, options?: GestureOptions): boolean
  /** Holds a gesture until release() (the pose layer: thinkingHand while thinking). One held gesture at a time. */
  hold(name: GestureName | null, options?: GestureOptions): void
  release(): void
  /** Blends every gesture out (never snaps). */
  stop(): void
  setReducedMotion(on: boolean): void
  setIntensity(value: number): void
  /** True while anything is still contributing (the scene keeps drawing). */
  busy(): boolean
  /** Advances by dt seconds (clamped to 0.25) and returns this frame's offsets. Reuses one object: do not keep it. */
  update(dt: number): GestureFrame
}

type Entry = { name: GestureName; def: GestureDef; gain: number; t: number; w: number }
type Held = Entry & { ramp: number; target: 0 | 1; ended: boolean }
type Fading = Entry & { fade: number; from: number }

export function createGestureController(options: GestureControllerOptions = {}): GestureController {
  let intensity = options.intensity ?? 1
  let reduced = options.reducedMotion ?? false
  const reducedIntensity = options.reducedIntensity ?? 0.5
  const cooldown = options.cooldown ?? 0.4
  let now = 0
  const lastPlayed: Partial<Record<GestureName, number>> = {}
  let helds: Held[] = []
  let shot: Entry | null = null
  let fading: Fading[] = []
  const frame: GestureFrame = {
    head: { rx: 0, ry: 0, rz: 0, lift: 0 }, handL: { raise: 0, swing: 0, ext: 0 }, handR: { raise: 0, swing: 0, ext: 0 },
    face: { joy: 0, lookX: 0, lookY: 0 }, look: 1, baseL: 1, baseR: 1, active: [],
  }

  const emit = options.onEvent ?? (() => {})
  const fadeLength = (def: GestureDef) => Math.max(0.15, def.release)
  /** Moves a one-shot to the fading list, ramping down from its current weight. */
  const interrupt = (entry: Entry, reason: GestureEndReason) => {
    fading.push({ ...entry, fade: 0, from: entry.w })
    emit({ type: 'end', name: entry.name, held: false, reason })
  }
  const releaseHeld = (reason: GestureEndReason = 'released') => {
    for (const h of helds) {
      h.target = 0
      if (!h.ended) { h.ended = true; emit({ type: 'end', name: h.name, held: true, reason }) }
    }
  }
  const effective = () => (reduced ? reducedIntensity : intensity)

  return {
    play(name, opts = {}) {
      const def = GESTURES[name]
      if (!def || reduced || effective() <= 0) return false
      if (!opts.force) {
        if (now - (lastPlayed[name] ?? -Infinity) < cooldown) return false
        const inRelease = shot && shot.t > shot.def.duration - shot.def.release
        if (shot && !inRelease && def.priority < shot.def.priority) return false
      }
      if (shot) interrupt(shot, 'interrupted')
      lastPlayed[name] = now
      shot = { name, def, gain: opts.intensity ?? 1, t: 0, w: 0 }
      emit({ type: 'start', name, held: false })
      return true
    },
    hold(name, opts = {}) {
      const def = name ? GESTURES[name] : undefined
      if (!name || !def) return releaseHeld()
      const live = helds[helds.length - 1]
      if (live && live.target === 1 && live.name === name) return
      releaseHeld()
      helds.push({ name, def, gain: opts.intensity ?? 1, t: 0, w: 0, ramp: 0, target: 1, ended: false })
      emit({ type: 'start', name, held: true })
    },
    release: () => releaseHeld(),
    stop() { releaseHeld('stopped'); if (shot) { interrupt(shot, 'stopped'); shot = null } },
    setReducedMotion(on) { reduced = on; if (reduced && shot) { interrupt(shot, 'stopped'); shot = null } }, // held gestures stay
    setIntensity(value) { intensity = value },
    busy: () => helds.length > 0 || shot !== null || fading.length > 0,
    update(dt) {
      // Up to 250 ms a frame keeps slow devices in real time; more (a tab coming back) must not skip a gesture's middle.
      dt = Math.min(0.25, Math.max(0, dt || 0))
      now += dt
      // Advance weights.
      for (const h of helds) {
        h.t += dt
        const span = h.target ? h.def.attack : fadeLength(h.def)
        h.ramp = clamp01(h.ramp + (h.target ? 1 : -1) * dt / span)
        h.w = smoothstep(0, 1, h.ramp)
      }
      helds = helds.filter(h => h.target === 1 || h.ramp > 0)
      if (shot) {
        shot.t += dt
        const { duration, attack, release } = shot.def
        if (shot.t >= duration) { emit({ type: 'end', name: shot.name, held: false, reason: 'finished' }); shot = null }
        else shot.w = smoothstep(0, attack, shot.t) * (1 - smoothstep(duration - release, duration, shot.t))
      }
      for (const f of fading) { f.t += dt; f.fade += dt; f.w = f.from * (1 - smoothstep(0, fadeLength(f.def), f.fade)) }
      fading = fading.filter(f => f.fade < fadeLength(f.def))

      // Compose. Per channel (part + key): S = total one-shot weight, H = total held weight, counted only for the keys
      // a sample emits. Overlaps become a weighted average (never above 1), and a one-shot only takes over the keys it moves.
      for (const part of PARTS) for (const k of KEYS[part]) (frame[part] as Record<string, number>)[k as string] = 0
      frame.active.length = 0
      const shots: Entry[] = shot ? [shot, ...fading] : fading
      const S: Record<string, number> = {}, H: Record<string, number> = {}
      let lookLoss = 0
      const entries: { e: Entry; out: Sample; held: boolean }[] = []
      const gather = (e: Entry, held: boolean) => {
        if (e.w <= 0) return
        const out = e.def.sample(held ? (e.t % e.def.duration) / e.def.duration : Math.min(1, e.t / e.def.duration), e.t)
        const tot = held ? H : S
        for (const part of e.def.parts) { const src = out[part]; if (src) for (const k in src) tot[part + k] = (tot[part + k] ?? 0) + e.w }
        entries.push({ e, out, held })
      }
      for (const h of helds) gather(h, true)
      for (const s of shots) gather(s, false)
      const mask = { handL: 0, handR: 0 }
      for (const { e, out, held } of entries) {
        const amp = e.w * e.gain * effective()
        for (const part of e.def.parts) {
          const src = out[part] as Record<string, number> | undefined
          if (!src) continue
          const dst = frame[part] as Record<string, number>
          for (const k in src) {
            const id = part + k, s1 = Math.min(1, S[id] ?? 0)
            dst[k] += src[k] * amp * (held ? (1 - s1) / Math.max(1, H[id]) : 1 / Math.max(1, S[id]))
            if (part === 'handL' || part === 'handR') mask[part] = Math.max(mask[part], s1 + (1 - s1) * Math.min(1, H[id] ?? 0))
          }
        }
        lookLoss += e.w * (1 - e.def.look)
        if (!frame.active.includes(e.name)) frame.active.push(e.name)
      }
      frame.look = clamp01(1 - lookLoss)
      frame.baseL = 1 - mask.handL
      frame.baseR = 1 - mask.handR
      return frame
    },
  }
}

/** A tiny pub/sub that carries gesture requests from app code to whichever robot is mounted. */
export type GestureCommand =
  | { type: 'play'; name: GestureName; options?: GestureOptions }
  | { type: 'hold'; name: GestureName | null; options?: GestureOptions }
  | { type: 'stop' }

export type GestureChannel = {
  play(name: GestureName, options?: GestureOptions): void
  hold(name: GestureName | null, options?: GestureOptions): void
  stop(): void
  /** For the robot: receive commands. Returns an unsubscribe function. */
  subscribe(listener: (command: GestureCommand) => void): () => void
  /** For the robot: report a gesture starting or ending to everyone listening with onEvent. */
  emit(event: GestureEvent): void
  /** For app code: hear when gestures start and end. Returns an unsubscribe function. */
  onEvent(listener: (event: GestureEvent) => void): () => void
}

export function createGestureChannel(): GestureChannel {
  const listeners = new Set<(command: GestureCommand) => void>()
  const observers = new Set<(event: GestureEvent) => void>()
  // With nobody listening (the robot is lazy-loaded) keep the latest hold, and the latest play if it is still fresh.
  let pendingHold: GestureCommand | null = null
  let pendingPlay: { command: GestureCommand; at: number } | null = null
  const send = (command: GestureCommand) => {
    if (listeners.size) { listeners.forEach(listener => listener(command)); return }
    if (command.type === 'hold') pendingHold = command
    else if (command.type === 'play') pendingPlay = { command, at: Date.now() }
    else { pendingHold = null; pendingPlay = null }
  }
  return {
    play: (name, options) => send({ type: 'play', name, options }),
    hold: (name, options) => send({ type: 'hold', name, options }),
    stop: () => send({ type: 'stop' }),
    subscribe(listener) {
      const replay = [pendingHold, pendingPlay && Date.now() - pendingPlay.at < 1500 ? pendingPlay.command : null]
      pendingHold = pendingPlay = null
      listeners.add(listener)
      for (const command of replay) if (command) listener(command)
      return () => { listeners.delete(listener) }
    },
    emit: event => observers.forEach(observer => observer(event)),
    onEvent(observer) {
      observers.add(observer)
      return () => { observers.delete(observer) }
    },
  }
}
