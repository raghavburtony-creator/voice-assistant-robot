// Is that sound the visitor speaking, or just the room? Pure rules (core): no audio nodes, no timers, no browser globals.
// Callers feed one level per frame (RMS or peak, 0..1) and the time in ms; the gate answers with events.
//
// Why not one fixed threshold: a laptop fan sits at a steady level. Under a fixed threshold that level is either "speech"
// all the time (the turn never ends, a fan above it reopens turns, Otto cuts himself off) or the threshold is so high that
// quiet speech is lost. So the gate follows a noise floor and judges every frame against it:
//
//   floor      falls fast (a quiet moment shows the true room level) and rises slowly (speech must not become the floor).
//              A fan that steps up is absorbed within a couple of seconds; a spoken word (under half a second) is not.
//   hysteresis speech starts above `enterRatio` x floor and holds down to `exitRatio` x floor, so a level hovering at the
//              line does not flap. Both never go below an absolute minimum, so a silent room keeps today's sensitivity.
//   onset      the level must stay above the enter line for `speechOnsetMs` (a click or a cough is not a turn).
//   hangover   the turn ends only after `silenceTimeoutMs` below the exit line (a pause between words is not the end).
//
// The speech gate (turns) and the barge-in gate (cutting Otto off while he is audible) are separate states on purpose:
// whether a turn is open, whether the visitor is credibly speaking over Otto, and whether Otto is audible are three
// facts that must not be read off one "mic is loud" flag.

/** Privacy-safe diagnostics: levels, durations and reasons only. Never audio, never a transcript. */
export type VoiceDiagnostic =
  | { type: 'speech_start'; level: number; floor: number }
  | { type: 'speech_end'; reason: 'silence' | 'max'; durationMs: number }
  | { type: 'no_speech' }
  | { type: 'turn_complete' }
  | { type: 'interruption'; accepted: true; reason: 'sustained_speech'; level: number; floor: number }
  | { type: 'interruption'; accepted: false; reason: 'too_brief'; durationMs: number; level: number; floor: number }

export type DiagnosticSink = (event: VoiceDiagnostic) => void

export type NoiseFloorSettings = {
  /** Time constant (ms) with which the floor follows a level that is below it. Short: the room shows itself in a pause. */
  fallMs: number
  /** Time constant (ms) with which it follows a level above it while no speech is confirmed. */
  riseMs: number
  /** The same while speech is confirmed. Long: a spoken turn must not be absorbed into the floor. */
  speakingRiseMs: number
  /** The floor never goes above this, so a loud room cannot make the gate deaf. */
  maxFloor: number
}

export const DEFAULT_FLOOR: NoiseFloorSettings = { fallMs: 150, riseMs: 1500, speakingRiseMs: 8000, maxFloor: 0.1 }

/** An exponential follower of the room's level: fast down, slow up. */
export class NoiseFloor {
  value: number
  private readonly settings: NoiseFloorSettings
  constructor(settings: NoiseFloorSettings = DEFAULT_FLOOR, initial = 0) {
    this.settings = settings
    this.value = Math.min(initial, settings.maxFloor)
  }

  update(level: number, dtMs: number, speaking: boolean, riseOverrideMs?: number) {
    const s = this.settings
    const tau = level < this.value ? s.fallMs : riseOverrideMs ?? (speaking ? s.speakingRiseMs : s.riseMs)
    this.value += (level - this.value) * (1 - Math.exp(-Math.max(0, dtMs) / tau))
    this.value = Math.min(this.value, s.maxFloor)
  }
}

export type SpeechGateSettings = {
  /** The level must stay above the enter line this long before speech is confirmed (ignores clicks and coughs). */
  speechOnsetMs: number
  /** Trailing time below the exit line that ends the turn once speech has started. */
  silenceTimeoutMs: number
  /** Give up if no speech starts in this long. */
  noSpeechTimeoutMs: number
  /** Hard ceiling on one turn. */
  maxTurnDurationMs: number
  /** Absolute minimum of the enter line (RMS 0..1): the sensitivity in a silent room. */
  speechThreshold: number
  /** Speech starts above this many times the noise floor. */
  enterRatio: number
  /** Speech holds above this many times the floor (below `enterRatio`: the hysteresis). */
  exitRatio: number
  /** Absolute minimum of the exit line. */
  minExitLevel: number
  /** At the start only the floor is learned: no speech can begin. 0 when a floor is carried over (`initialFloor`). */
  calibrationMs: number
  /** The floor from an earlier gate in the same room, so a reopened microphone does not start blind. */
  initialFloor?: number
}

export const DEFAULT_GATE: SpeechGateSettings = {
  speechOnsetMs: 180,
  silenceTimeoutMs: 1000,
  noSpeechTimeoutMs: 6000,
  maxTurnDurationMs: 30_000,
  speechThreshold: 0.02,
  enterRatio: 2.5,
  exitRatio: 1.6,
  minExitLevel: 0.012,
  calibrationMs: 400,
}

export type SpeechGateHandlers = {
  onSpeechStart?: () => void
  /** `max`: the ceiling cut a turn that was still going. Fires at most once. */
  onSpeechEnd: (reason: 'silence' | 'max') => void
  /** Nothing was said in time. Fires at most once. */
  onNoSpeech: () => void
  onDiagnostic?: DiagnosticSink
}

/** The turn: waiting, then speaking, then done. Time comes from the caller, so a test can drive it. */
export class SpeechGate {
  private readonly floor: NoiseFloor
  private readonly settings: SpeechGateSettings
  private readonly handlers: SpeechGateHandlers
  private startedAt: number
  private lastAt: number
  private loudSince: number | null = null
  private quietSince: number | null = null
  private speechAt = 0
  private speaking = false
  private done = false

  constructor(settings: Partial<SpeechGateSettings>, handlers: SpeechGateHandlers, now: number, floor?: NoiseFloorSettings) {
    this.settings = { ...DEFAULT_GATE, ...settings }
    if (this.settings.initialFloor !== undefined) this.settings.calibrationMs = 0
    this.handlers = handlers
    this.floor = new NoiseFloor(floor, this.settings.initialFloor ?? 0)
    this.startedAt = this.lastAt = now
  }

  get isSpeaking() { return this.speaking }
  get isDone() { return this.done }
  /** The learned noise floor, to carry into the next gate. */
  get noiseFloor() { return this.floor.value }
  get enterLevel() { return Math.max(this.settings.speechThreshold, this.floor.value * this.settings.enterRatio) }
  get exitLevel() { return Math.max(this.settings.minExitLevel, this.floor.value * this.settings.exitRatio) }

  /** The turn is already known to be speech (a confirmed barge-in): it starts now and ends by the usual hangover. */
  begin(now: number) {
    if (this.done || this.speaking) return
    this.speaking = true
    this.speechAt = now
    this.lastAt = now
    this.quietSince = this.loudSince = null
  }

  /** The turn's clocks stand still while the caller cannot tell (Otto is audible). Nothing is learned either. */
  hold(now: number) {
    const dt = now - this.lastAt
    this.lastAt = now
    this.startedAt += dt
    this.loudSince = this.quietSince = null
  }

  /** One level at time `now` (ms). Returns nothing; the handlers hear what happened. */
  step(level: number, now: number) {
    if (this.done) return
    const s = this.settings
    const dt = now - this.lastAt
    this.lastAt = now
    const elapsed = now - this.startedAt
    const calibrating = elapsed < s.calibrationMs
    // Judged against the floor as it stood before this frame, so a sudden loud burst is not first absorbed into it.
    const enter = this.enterLevel
    const exit = this.exitLevel
    this.floor.update(level, dt, this.speaking, calibrating ? 150 : undefined)

    if (elapsed >= s.maxTurnDurationMs) return this.finish(() => {
      if (this.speaking) this.handlers.onSpeechEnd('max'); else this.handlers.onNoSpeech()
    }, this.speaking ? { type: 'speech_end', reason: 'max', durationMs: now - this.speechAt } : { type: 'no_speech' })

    if (!this.speaking) {
      this.loudSince = !calibrating && level >= enter ? this.loudSince ?? now : null
      if (this.loudSince !== null && now - this.loudSince >= s.speechOnsetMs) {
        this.speaking = true
        this.speechAt = this.loudSince
        this.quietSince = null
        this.handlers.onDiagnostic?.({ type: 'speech_start', level, floor: this.floor.value })
        this.handlers.onSpeechStart?.()
      } else if (elapsed >= s.noSpeechTimeoutMs) this.finish(() => this.handlers.onNoSpeech(), { type: 'no_speech' })
      return
    }
    this.quietSince = level >= exit ? null : this.quietSince ?? now
    if (this.quietSince !== null && now - this.quietSince >= s.silenceTimeoutMs) {
      this.finish(() => this.handlers.onSpeechEnd('silence'), { type: 'speech_end', reason: 'silence', durationMs: this.quietSince! - this.speechAt })
    }
  }

  private finish(report: () => void, diagnostic: VoiceDiagnostic) {
    this.done = true
    this.handlers.onDiagnostic?.(diagnostic)
    report()
  }
}

export type BargeInSettings = {
  /** Absolute minimum level (0..1, peak) of a voice over Otto's echo. */
  level: number
  /** How long the voice must stay credible before Otto is cut off. */
  holdMs: number
  /** The voice must also be this many times the room's noise floor (learned while Otto was silent). */
  floorRatio: number
  /** A dip this short inside the run does not restart it: speech has gaps between syllables. */
  gapMs: number
}

export const DEFAULT_BARGE: BargeInSettings = { level: 0.22, holdMs: 200, floorRatio: 4, gapMs: 100 }

/**
 * Cutting Otto off by talking over him. Evidence is a level that stays above both the fixed line (his echo) and a multiple
 * of the room's floor for `holdMs`. A burst shorter than that is rejected and reported; noise at the floor never counts.
 * The floor is learned while Otto is silent and held still while he is audible, because his echo is not the room.
 */
export class BargeInGate {
  private readonly floor = new NoiseFloor()
  private credibleMs = 0
  private gapMs = 0
  private peak = 0
  private readonly settings: BargeInSettings
  private readonly onDiagnostic?: DiagnosticSink

  constructor(settings: BargeInSettings = DEFAULT_BARGE, onDiagnostic?: DiagnosticSink, initialFloor = 0) {
    this.settings = settings
    this.onDiagnostic = onDiagnostic
    this.floor.value = Math.min(initialFloor, DEFAULT_FLOOR.maxFloor)
  }

  get noiseFloor() { return this.floor.value }
  get line() { return Math.max(this.settings.level, this.floor.value * this.settings.floorRatio) }

  /** Forget a run in progress (Otto stopped being audible, the mic stopped sending). */
  reset() { this.credibleMs = this.gapMs = this.peak = 0 }

  /**
   * One frame of `frameMs`. `audible`: Otto's voice is sounding. Returns true when the visitor has credibly interrupted.
   * Not audible: the frame only teaches the floor and clears any run.
   */
  frame(level: number, frameMs: number, audible: boolean): boolean {
    if (!audible) {
      this.floor.update(level, frameMs, false)
      this.reset()
      return false
    }
    const line = this.line
    if (level >= line) {
      this.credibleMs += frameMs + this.gapMs
      this.gapMs = 0
      this.peak = Math.max(this.peak, level)
      if (this.credibleMs >= this.settings.holdMs) {
        this.onDiagnostic?.({ type: 'interruption', accepted: true, reason: 'sustained_speech', level: this.peak, floor: this.floor.value })
        this.reset()
        return true
      }
      return false
    }
    if (this.credibleMs === 0) return false
    this.gapMs += frameMs
    if (this.gapMs > this.settings.gapMs) {
      this.onDiagnostic?.({ type: 'interruption', accepted: false, reason: 'too_brief', durationMs: this.credibleMs, level: this.peak, floor: this.floor.value })
      this.reset()
    }
    return false
  }
}

export type OpenMicStep<F> = {
  /** Frames to send to the server now (the kept lead-in first, when a turn has just started). */
  send: F[]
  /** A turn that was streaming has ended: tell the server the audio stream is over (`mic_off`). */
  endOfAudio: boolean
}

/**
 * What an open microphone sends upstream. Only a validated turn is streamed: between turns the frames are kept (the last
 * `prerollFrames`, so the start of a word is not cut) and dropped, so a fan is not streamed to the model and billed by the
 * minute. Push-to-talk does not use it: pressing Talk is the visitor's own gate. Generic over the frame so it stays pure.
 */
export class OpenMicGate<F> {
  private gate: SpeechGate | null = null
  private streaming = false
  private floor: number | undefined
  private lead: F[] = []
  private pending: OpenMicStep<F> = { send: [], endOfAudio: false }
  private readonly settings: Partial<SpeechGateSettings>
  private readonly prerollFrames: number
  private readonly onDiagnostic?: DiagnosticSink

  constructor(settings: Partial<SpeechGateSettings>, prerollFrames: number, onDiagnostic?: DiagnosticSink) {
    this.settings = settings
    this.prerollFrames = prerollFrames
    this.onDiagnostic = onDiagnostic
  }

  get isStreaming() { return this.streaming }
  get noiseFloor() { return this.gate?.noiseFloor ?? this.floor ?? 0 }

  private open(now: number): SpeechGate {
    return this.gate ??= new SpeechGate({ ...this.settings, initialFloor: this.floor }, {
      onSpeechStart: () => { this.streaming = true; this.pending.send.push(...this.lead); this.lead = [] },
      onSpeechEnd: () => this.close(),
      onNoSpeech: () => this.close(),
      onDiagnostic: this.onDiagnostic,
    }, now)
  }

  private close() {
    if (this.gate) this.floor = this.gate.noiseFloor
    this.gate = null
    if (this.streaming) { this.streaming = false; this.pending.endOfAudio = true }
  }

  /** One frame while Otto is silent and the mic is sending. `rms`: the frame's level. */
  frame(frame: F, rms: number, now: number): OpenMicStep<F> {
    this.pending = { send: [], endOfAudio: false }
    this.open(now).step(rms, now)
    if (this.streaming) this.pending.send.push(frame)
    else { this.lead.push(frame); if (this.lead.length > this.prerollFrames) this.lead.shift() }
    return this.pending
  }

  /** Otto is audible: the visitor's turn is over (he answered it), and nothing is kept. */
  otto(): OpenMicStep<F> {
    this.pending = { send: [], endOfAudio: false }
    this.lead = []
    this.close()
    return this.pending
  }

  /** The visitor cut Otto off: the turn is open from now, whatever was held back goes first (`held`). */
  interrupted(held: F[], now: number): OpenMicStep<F> {
    this.pending = { send: [...held], endOfAudio: false }
    this.lead = []
    this.streaming = true
    this.open(now).begin(now)
    return this.pending
  }

  /** The mic stopped sending (muted, push-to-talk, stopped): forget the turn. The room's floor is kept. */
  stop() {
    this.close()
    this.lead = []
    this.pending = { send: [], endOfAudio: false }
  }
}
