// Otto's gestures: short body-language moves (waves, nods...) layered on top of the base animation.
// Plain ES module, no imports and no three.js, so the no-build preview page loads this very file. Types: gestures.d.ts.
// A gesture is pure math: sample(u, t) returns offsets for the head and hands. The controller weights them with a
// smoothstep envelope, so nothing ever snaps on start, end, interrupt or stop.

const TAU = Math.PI * 2
const smoothstep = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k) }
const clamp01 = x => Math.min(1, Math.max(0, x))

/** @type {readonly string[]} */
export const GESTURE_NAMES = Object.freeze(['welcomeWave', 'celebrate', 'nod', 'headShake', 'thinkingHand', 'goodbyeWave'])

/** @param {unknown} value */
export const isGestureName = value => typeof value === 'string' && GESTURE_NAMES.includes(value)

// A wave: the right hand raised beside the head, wiggling at its wrist.
const wave = (t, hz, swing, sway) => ({ px: 0.42 + sway * Math.sin(TAU * hz * t), py: 0.62, pz: 0.18, rz: swing * Math.sin(TAU * hz * t) })

/** Each def: see GestureDef in gestures.d.ts. Offsets are radians (r*) or model units (p*). */
export const GESTURES = Object.freeze({
  welcomeWave: { duration: 2, attack: 0.25, release: 0.35, parts: ['handR', 'head'], look: 0.7, priority: 2,
    sample: (u, t) => ({ handR: wave(t, 2.2, 0.45, 0), head: { rz: -0.06, rx: -0.05 } }) },
  goodbyeWave: { duration: 2.4, attack: 0.3, release: 0.55, parts: ['handR', 'head'], look: 0.7, priority: 2,
    // A slower, wider wave, then a small bow at the end.
    sample: (u, t) => ({ handR: wave(t, 1.5, 0.55, 0.05), head: { rz: -0.06, rx: -0.04 + 0.12 * smoothstep(0.7, 1, u) } }) },
  celebrate: { duration: 1.8, attack: 0.2, release: 0.35, parts: ['handL', 'handR', 'head'], look: 0.4, priority: 3,
    // Both hands up, pumping in turn; the head bounces.
    sample: (u, t) => {
      const s = Math.sin(TAU * 2.2 * t), pumpL = Math.abs(s) * 0.08, pumpR = Math.abs(Math.cos(TAU * 2.2 * t)) * 0.08
      return {
        handL: { px: -0.4, py: 0.7 + pumpL, pz: 0.15, rz: 0.35 * s },
        handR: { px: 0.4, py: 0.7 + pumpR, pz: 0.15, rz: -0.35 * s },
        head: { rx: -0.12, py: 0.03 * Math.abs(s) },
      }
    } },
  nod: { duration: 0.7, attack: 0.08, release: 0.15, parts: ['head'], look: 0.5, priority: 1,
    sample: u => ({ head: { rx: 0.15 * Math.sin(TAU * u) } }) },
  headShake: { duration: 1, attack: 0.1, release: 0.2, parts: ['head'], look: 0.1, priority: 2,
    sample: u => { const s = Math.sin(TAU * 3 * u) * (1 - 0.6 * u); return { head: { ry: 0.28 * s, rz: 0.03 * s, rx: 0.04 } } } },
  // Held while thinking: a hand up under the visor like a hand on the chin, the head tilted.
  thinkingHand: { duration: 3, attack: 0.45, release: 0.4, parts: ['handR', 'head'], look: 0.3, priority: 0,
    sample: (u, t) => ({ handR: { px: -0.1, py: 0.16 + 0.012 * Math.sin(2.4 * t), pz: 0.5 }, head: { rz: 0.2, rx: -0.1, ry: 0.04 * Math.sin(0.5 * t) } }) },
})

const HEAD_KEYS = ['rx', 'ry', 'rz', 'py']
const HAND_KEYS = ['px', 'py', 'pz', 'rx', 'rz']
const zero = (o, keys) => { for (const k of keys) o[k] = 0 }

/**
 * @param {import('./gestures').GestureControllerOptions} [options]
 * @returns {import('./gestures').GestureController}
 */
export function createGestureController(options = {}) {
  let intensity = options.intensity ?? 1
  let reduced = options.reducedMotion ?? false
  const reducedIntensity = options.reducedIntensity ?? 0.5
  const cooldown = options.cooldown ?? 0.4
  let now = 0
  const lastPlayed = {}
  // Held layer entries (the newest is the live one, older ones fade out) and one-shots (the live one, plus fading ones).
  // An entry: { name, def, gain, t, w (weight 0..1), ramp (held: 0..1 progress, moves toward target), fade, from }
  let helds = []
  let shot = null
  let fading = []
  const frame = { head: { rx: 0, ry: 0, rz: 0, py: 0 }, handL: { px: 0, py: 0, pz: 0, rx: 0, rz: 0 }, handR: { px: 0, py: 0, pz: 0, rx: 0, rz: 0 }, look: 1, baseL: 1, baseR: 1, active: [] }

  const fadeLength = def => Math.max(0.15, def.release)
  /** Moves a one-shot to the fading list, ramping down from its current weight. */
  const interrupt = entry => { entry.fade = 0; entry.from = entry.w; fading.push(entry) }
  const releaseHeld = () => { for (const h of helds) h.target = 0 }
  const effective = () => (reduced ? reducedIntensity : intensity)

  const controller = {
    play(name, opts = {}) {
      const def = GESTURES[name]
      if (!def || reduced || effective() <= 0) return false
      if (!opts.force) {
        if (now - (lastPlayed[name] ?? -Infinity) < cooldown) return false
        const inRelease = shot && shot.t > shot.def.duration - shot.def.release
        if (shot && !inRelease && def.priority < shot.def.priority) return false
      }
      if (shot) interrupt(shot)
      lastPlayed[name] = now
      shot = { name, def, gain: opts.intensity ?? 1, t: 0, w: 0 }
      return true
    },
    hold(name, opts = {}) {
      const def = GESTURES[name]
      if (!def) return releaseHeld()
      const live = helds[helds.length - 1]
      if (live && live.target === 1 && live.name === name) return
      releaseHeld()
      helds.push({ name, def, gain: opts.intensity ?? 1, t: 0, w: 0, ramp: 0, target: 1 })
    },
    release: releaseHeld,
    stop() { releaseHeld(); if (shot) { interrupt(shot); shot = null } },
    setReducedMotion(on) { reduced = !!on; if (reduced && shot) { interrupt(shot); shot = null } }, // held gestures stay
    setIntensity(value) { intensity = value },
    update(dt) {
      dt = Math.min(0.1, Math.max(0, dt || 0))
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
        if (shot.t >= duration) shot = null
        else shot.w = smoothstep(0, attack, shot.t) * (1 - smoothstep(duration - release, duration, shot.t))
      }
      for (const f of fading) { f.t += dt; f.fade += dt; f.w = f.from * (1 - smoothstep(0, fadeLength(f.def), f.fade)) }
      fading = fading.filter(f => f.fade < fadeLength(f.def))

      // Compose.
      zero(frame.head, HEAD_KEYS); zero(frame.handL, HAND_KEYS); zero(frame.handR, HAND_KEYS)
      frame.active.length = 0
      const shots = shot ? [shot, ...fading] : fading
      // Per part: S = total one-shot weight, H = total held weight. Overlaps become a weighted average (never above 1).
      const S = { head: 0, handL: 0, handR: 0 }, H = { head: 0, handL: 0, handR: 0 }
      let lookLoss = 0
      for (const e of shots) for (const part of e.def.parts) S[part] += e.w
      for (const e of helds) for (const part of e.def.parts) H[part] += e.w
      const add = (e, held) => {
        if (e.w <= 0) return
        const out = e.def.sample(held ? (e.t % e.def.duration) / e.def.duration : Math.min(1, e.t / e.def.duration), e.t)
        const amp = e.w * e.gain * effective()
        for (const part of e.def.parts) {
          const src = out[part]
          if (!src) continue
          const dst = frame[part]
          const keys = part === 'head' ? HEAD_KEYS : HAND_KEYS
          const scale = held ? amp * (1 - Math.min(1, S[part])) / Math.max(1, H[part]) : amp / Math.max(1, S[part])
          for (const k of keys) dst[k] += (src[k] ?? 0) * scale
        }
        lookLoss += e.w * (1 - e.def.look)
        if (!frame.active.includes(e.name)) frame.active.push(e.name)
      }
      for (const h of helds) add(h, true)
      for (const s of shots) add(s, false)
      frame.look = clamp01(1 - lookLoss)
      const mask = part => Math.min(1, S[part]) + (1 - Math.min(1, S[part])) * Math.min(1, H[part])
      frame.baseL = 1 - mask('handL')
      frame.baseR = 1 - mask('handR')
      return frame
    },
  }
  return controller
}

/** @returns {import('./gestures').GestureChannel} */
export function createGestureChannel() {
  const listeners = new Set()
  // With nobody listening (the scene is lazy-loaded) keep the latest hold, and the latest play if it is still fresh.
  let pendingHold = null
  let pendingPlay = null
  const send = command => {
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
  }
}
