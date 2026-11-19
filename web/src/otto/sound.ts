// Otto's sound cues: tiny robot chirps synthesised with Web Audio (oscillators and gain ramps, no audio files).
// They are triggered by gesture events (useGestureSounds) or called directly, never from the voice state or a render loop.
//
// Autoplay: browsers refuse to start audio before the visitor has clicked or pressed a key on the page. Until then no
// AudioContext is made and cues are dropped (a chirp seconds late is worse than none); after it, one context is made
// lazily and reused, resumed if the browser suspended it. dispose() closes it.

export const SOUND_CUES = ['chirpConnect', 'chirpAcknowledge', 'chirpThinking', 'chirpNegative', 'chirpCelebration', 'chirpGoodbye'] as const
export type SoundCue = (typeof SOUND_CUES)[number]

/** One note: when it starts (s after the cue), how long it lasts, its pitch gliding from f0 to f1 (Hz), its shape and level. */
type Note = { at: number; dur: number; f0: number; f1: number; wave: OscillatorType; level: number }
const note = (at: number, dur: number, f0: number, f1 = f0, wave: OscillatorType = 'sine', level = 1): Note => ({ at, dur, f0, f1, wave, level })

/** The cues, as short phrases of notes. Kept soft and short (under 0.6 s) so they never talk over Otto. */
export const CUE_NOTES: Readonly<Record<SoundCue, readonly Note[]>> = {
  // Hello: a bright rising "bwee-dip".
  chirpConnect: [note(0, 0.12, 520, 880), note(0.13, 0.1, 880, 1320, 'triangle', 0.8)],
  // Got it: one soft blip.
  chirpAcknowledge: [note(0, 0.09, 700, 780, 'sine', 0.8)],
  // Hmm: three quiet ticks that wander.
  chirpThinking: [note(0, 0.05, 620, 640, 'triangle', 0.5), note(0.1, 0.05, 700, 720, 'triangle', 0.5), note(0.2, 0.06, 640, 600, 'triangle', 0.5)],
  // No: two falling "bwow"s.
  chirpNegative: [note(0, 0.15, 420, 300, 'triangle', 0.9), note(0.18, 0.18, 360, 230, 'triangle', 0.9)],
  // Yay: a quick arpeggio up (C E G C) and a sparkle.
  chirpCelebration: [note(0, 0.07, 523), note(0.07, 0.07, 659), note(0.14, 0.07, 784), note(0.21, 0.12, 1047, 1047, 'triangle'), note(0.3, 0.16, 1568, 1760, 'sine', 0.5)],
  // Bye: a falling "bee-boo".
  chirpGoodbye: [note(0, 0.14, 880, 660), note(0.16, 0.22, 660, 440, 'sine', 0.9)],
}

const ATTACK = 0.008   // s: a fade-in this short is inaudible as a fade but stops the click of a hard start
const SILENT = 0.0001  // exponential ramps cannot reach 0: start and end here instead
const HEADROOM = 0.35  // master level at volume 1, so several overlapping notes stay well under clipping
const STALE_MS = 300   // a cue still waiting this long for a suspended context to resume is dropped

export type SoundOptions = {
  enabled?: boolean
  /** 0 (silent) to 1. */
  volume?: number
  /** For tests: make the context, and the target that sees the visitor's first click or key press. */
  createContext?: () => AudioContext
  activationTarget?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> | null
  /** For tests: whether the page already had a click or key press (navigator.userActivation). */
  activated?: boolean
}

const ACTIVATION_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const

export class SoundController {
  private enabled: boolean
  private volume: number
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private activated: boolean
  private disposed = false
  private readonly createContext: () => AudioContext
  private readonly target: SoundOptions['activationTarget']
  private readonly onActivate = () => {
    this.activated = true
    this.removeListeners()
    // Inside the visitor's own gesture: make (or resume) the context now, so the first cue plays at once.
    if (this.enabled && this.volume > 0) void this.ensure()?.resume().catch(() => {})
  }

  constructor(options: SoundOptions = {}) {
    this.enabled = options.enabled ?? true
    this.volume = clamp01(options.volume ?? 0.5)
    this.createContext = options.createContext ?? (() => new AudioContext())
    this.target = options.activationTarget === undefined ? (typeof window !== 'undefined' ? window : null) : options.activationTarget
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }) : undefined
    this.activated = options.activated ?? nav?.userActivation?.hasBeenActive ?? false
    if (!this.activated) for (const type of ACTIVATION_EVENTS) this.target?.addEventListener(type, this.onActivate, { capture: true, passive: true })
  }

  /** Plays a cue now. Returns false when it was dropped (sound off, volume 0, no click or key press yet, disposed). */
  play(cue: SoundCue): boolean {
    if (this.disposed || !this.enabled || this.volume <= 0 || !this.activated || !CUE_NOTES[cue]) return false
    const context = this.ensure()
    if (!context) return false
    if (context.state === 'suspended') {
      const asked = performance.now()
      context.resume().then(() => { if (performance.now() - asked < STALE_MS && !this.disposed) this.schedule(cue) }).catch(() => {})
      return true
    }
    this.schedule(cue)
    return true
  }

  setEnabled(on: boolean) { this.enabled = on }

  setVolume(volume: number) {
    this.volume = clamp01(volume)
    // A short glide, not a jump, so changing the volume mid-cue does not click.
    if (this.master && this.context) this.master.gain.setTargetAtTime(this.volume * HEADROOM, this.context.currentTime, 0.02)
  }

  /** True once a context exists (for tests and the lab). */
  get started() { return this.context !== null }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.removeListeners()
    this.master = null
    const context = this.context
    this.context = null
    void context?.close().catch(() => {})
  }

  private removeListeners() {
    for (const type of ACTIVATION_EVENTS) this.target?.removeEventListener(type, this.onActivate, { capture: true })
  }

  private ensure(): AudioContext | null {
    if (this.disposed) return null
    if (this.context) return this.context
    try {
      const context = this.createContext()
      const master = context.createGain()
      master.gain.value = this.volume * HEADROOM
      // A gentle limiter after the master: overlapping cues can never clip.
      const limiter = context.createDynamicsCompressor()
      limiter.threshold.value = -10
      limiter.knee.value = 6
      limiter.ratio.value = 12
      limiter.attack.value = 0.003
      limiter.release.value = 0.1
      master.connect(limiter)
      limiter.connect(context.destination)
      this.context = context
      this.master = master
      return context
    } catch {
      return null // no Web Audio here: stay silent
    }
  }

  private schedule(cue: SoundCue) {
    const context = this.context, master = this.master
    if (!context || !master) return
    const start = context.currentTime + 0.01
    for (const n of CUE_NOTES[cue]) {
      const t0 = start + n.at, t1 = t0 + n.dur
      const osc = context.createOscillator()
      const gain = context.createGain()
      osc.type = n.wave
      osc.frequency.setValueAtTime(n.f0, t0)
      if (n.f1 !== n.f0) osc.frequency.exponentialRampToValueAtTime(n.f1, t1)
      gain.gain.setValueAtTime(SILENT, t0)
      gain.gain.exponentialRampToValueAtTime(n.level, t0 + ATTACK)
      gain.gain.exponentialRampToValueAtTime(SILENT, t1)
      osc.connect(gain)
      gain.connect(master)
      osc.onended = () => { osc.disconnect(); gain.disconnect() }
      osc.start(t0)
      osc.stop(t1 + 0.02)
    }
  }
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0))
