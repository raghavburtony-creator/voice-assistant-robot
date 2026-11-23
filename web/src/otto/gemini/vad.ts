// End-of-turn detection for the microphone: an RMS meter on the live MediaStream (Web Audio, no dependencies). Speech
// counts once the level stays above `speechThreshold` for `speechOnsetMs`; the turn ends after `silenceTimeoutMs` of
// quiet. No speech in `noSpeechTimeoutMs`, or a turn past `maxTurnDurationMs`, ends it too.

export type VadSettings = {
  /** RMS level (0..1) above which a frame counts as speech. */
  speechThreshold: number
  /** The level must stay above the threshold this long before speech is confirmed (ignores clicks). */
  speechOnsetMs: number
  /** Trailing silence that ends the turn once speech has started. */
  silenceTimeoutMs: number
  /** Give up if no speech starts in this long. */
  noSpeechTimeoutMs: number
  /** Hard ceiling on one turn. */
  maxTurnDurationMs: number
}

export const DEFAULT_VAD: VadSettings = {
  speechThreshold: 0.02,
  speechOnsetMs: 180,
  silenceTimeoutMs: 1000,
  noSpeechTimeoutMs: 6000,
  maxTurnDurationMs: 30_000,
}

export type VadHandlers = {
  onSpeechStart?: () => void
  /** `max`: the ceiling cut a turn that was still going. Fires at most once per detector. */
  onSpeechEnd: (reason: 'silence' | 'max') => void
  /** Nothing was said in time. Fires at most once per detector. */
  onNoSpeech: () => void
  /** Every tick, for a meter. */
  onLevel?: (rms: number) => void
  /** While true the tick is skipped and the turn's clocks stand still (Otto's own voice must not count as the visitor's). */
  muted?: () => boolean
}

/** setInterval, not requestAnimationFrame: frames stop in a background tab, and the cutoffs must still fire there. */
const TICK_MS = 50

export class VoiceActivityDetector {
  private context: AudioContext | null
  private readonly ownsContext: boolean
  private source: MediaStreamAudioSourceNode | null
  private analyser: AnalyserNode | null
  private buffer: Float32Array<ArrayBuffer>
  private timer: ReturnType<typeof setInterval> | undefined
  private startedAt = performance.now()
  private lastTick = this.startedAt
  private loudSince: number | null = null
  private quietSince: number | null = null
  private speaking = false
  private done = false

  private readonly settings: VadSettings
  private readonly handlers: VadHandlers

  /** `context`: share a running one (the recorder's, made in the click) instead of making a new one that may start suspended. */
  constructor(stream: MediaStream, settings: VadSettings, handlers: VadHandlers, context?: AudioContext) {
    this.settings = settings
    this.handlers = handlers
    this.ownsContext = !context
    this.context = context ?? new AudioContext()
    this.source = this.context.createMediaStreamSource(stream)
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 1024
    this.source.connect(this.analyser)
    if (this.ownsContext) void this.context.resume().catch(() => {}) // a context made outside a click can start suspended
    this.buffer = new Float32Array(this.analyser.fftSize)
    this.timer = setInterval(this.tick, TICK_MS)
  }

  private tick = () => {
    if (this.done || !this.analyser) return
    const now = performance.now()
    const dt = now - this.lastTick
    this.lastTick = now
    if (this.handlers.muted?.()) {
      this.startedAt += dt
      this.loudSince = this.quietSince = null
      this.handlers.onLevel?.(0)
      return
    }
    this.analyser.getFloatTimeDomainData(this.buffer)
    let sum = 0
    for (const v of this.buffer) sum += v * v
    const rms = Math.sqrt(sum / this.buffer.length)
    this.handlers.onLevel?.(rms)
    this.step(rms, now)
  }

  private step(rms: number, now: number) {
    const s = this.settings
    const loud = rms >= s.speechThreshold
    const elapsed = now - this.startedAt
    if (elapsed >= s.maxTurnDurationMs) return this.end(() => this.speaking ? this.handlers.onSpeechEnd('max') : this.handlers.onNoSpeech())
    if (!this.speaking) {
      this.loudSince = loud ? this.loudSince ?? now : null
      if (this.loudSince !== null && now - this.loudSince >= s.speechOnsetMs) {
        this.speaking = true
        this.handlers.onSpeechStart?.()
      } else if (elapsed >= s.noSpeechTimeoutMs) this.end(() => this.handlers.onNoSpeech())
      return
    }
    this.quietSince = loud ? null : this.quietSince ?? now
    if (this.quietSince !== null && now - this.quietSince >= s.silenceTimeoutMs) this.end(() => this.handlers.onSpeechEnd('silence'))
  }

  /** Releases everything first, so a handler that starts a new detector or the next step finds no leftovers. */
  private end(report: () => void) {
    this.dispose()
    report()
  }

  /** Stops the tick timer and disconnects every node. Safe to call twice. The stream's tracks are not touched. */
  dispose() {
    this.done = true
    clearInterval(this.timer)
    this.source?.disconnect()
    this.analyser?.disconnect()
    if (this.ownsContext) void this.context?.close().catch(() => {})
    this.source = this.analyser = this.context = null
  }
}
