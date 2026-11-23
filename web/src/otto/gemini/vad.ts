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
  /** Every frame, for a meter. */
  onLevel?: (rms: number) => void
}

export class VoiceActivityDetector {
  private context: AudioContext | null
  private source: MediaStreamAudioSourceNode | null
  private analyser: AnalyserNode | null
  private buffer: Float32Array<ArrayBuffer>
  private frame = 0
  private readonly startedAt = performance.now()
  private loudSince: number | null = null
  private quietSince: number | null = null
  private speaking = false
  private done = false

  private readonly settings: VadSettings
  private readonly handlers: VadHandlers

  constructor(stream: MediaStream, settings: VadSettings, handlers: VadHandlers) {
    this.settings = settings
    this.handlers = handlers
    this.context = new AudioContext()
    this.source = this.context.createMediaStreamSource(stream)
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = 1024
    this.source.connect(this.analyser)
    this.buffer = new Float32Array(this.analyser.fftSize)
    this.frame = requestAnimationFrame(this.tick)
  }

  private tick = () => {
    if (this.done || !this.analyser) return
    this.analyser.getFloatTimeDomainData(this.buffer)
    let sum = 0
    for (const v of this.buffer) sum += v * v
    const rms = Math.sqrt(sum / this.buffer.length)
    this.handlers.onLevel?.(rms)
    this.step(rms, performance.now())
    if (!this.done) this.frame = requestAnimationFrame(this.tick)
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

  /** Cancels the frame loop and disconnects every node. Safe to call twice. The stream's tracks are not touched. */
  dispose() {
    this.done = true
    cancelAnimationFrame(this.frame)
    this.source?.disconnect()
    this.analyser?.disconnect()
    void this.context?.close().catch(() => {})
    this.source = this.analyser = this.context = null
  }
}
