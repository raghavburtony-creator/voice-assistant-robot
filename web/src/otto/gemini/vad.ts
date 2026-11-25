// End-of-turn detection for the microphone: an RMS meter on the live MediaStream (Web Audio, no dependencies). The rules
// are in ../speechGate.ts (adaptive noise floor, hysteresis, onset and hangover); this file only reads the level.
// Speech counts once the level stays above the enter line for `speechOnsetMs`; the turn ends after `silenceTimeoutMs`
// below the exit line. No speech in `noSpeechTimeoutMs`, or a turn past `maxTurnDurationMs`, ends it too.

import { DEFAULT_GATE, SpeechGate, type DiagnosticSink, type SpeechGateSettings } from '../speechGate'

/** `speechThreshold` is the lowest level that can count as speech (a silent room); in a noisy room the gate follows the
 *  noise floor (`enterRatio`, `exitRatio`) instead of needing it raised. `initialFloor` is set by the bridge. */
export type VadSettings = Omit<SpeechGateSettings, 'initialFloor'>

export const DEFAULT_VAD: VadSettings = { ...DEFAULT_GATE }

export type VadHandlers = {
  onSpeechStart?: () => void
  /** `max`: the ceiling cut a turn that was still going. Fires at most once per detector. */
  onSpeechEnd: (reason: 'silence' | 'max') => void
  /** Nothing was said in time. Fires at most once per detector. */
  onNoSpeech: () => void
  /** Privacy-safe events: speech start and end, the floor, reasons. No audio. */
  onDiagnostic?: DiagnosticSink
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
  private readonly gate: SpeechGate
  private done = false

  private readonly handlers: VadHandlers

  /**
   * `context`: share a running one (the recorder's, made in the click) instead of making a new one that may start suspended.
   * `initialFloor`: the noise floor of the detector before this one, so a reopened microphone starts knowing the room.
   */
  constructor(stream: MediaStream, settings: VadSettings, handlers: VadHandlers, context?: AudioContext, initialFloor?: number) {
    this.handlers = handlers
    this.gate = new SpeechGate({ ...settings, initialFloor }, {
      onSpeechStart: handlers.onSpeechStart,
      onSpeechEnd: reason => this.end(() => handlers.onSpeechEnd(reason)),
      onNoSpeech: () => this.end(() => handlers.onNoSpeech()),
      onDiagnostic: handlers.onDiagnostic,
    }, performance.now())
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

  /** The room's learned noise level (RMS), to hand to the next detector. */
  get noiseFloor() { return this.gate.noiseFloor }

  private tick = () => {
    if (this.done || !this.analyser) return
    const now = performance.now()
    if (this.handlers.muted?.()) {
      this.gate.hold(now)
      this.handlers.onLevel?.(0)
      return
    }
    this.analyser.getFloatTimeDomainData(this.buffer)
    let sum = 0
    for (const v of this.buffer) sum += v * v
    const rms = Math.sqrt(sum / this.buffer.length)
    this.handlers.onLevel?.(rms)
    this.gate.step(rms, now)
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
