// Browser audio for the voice assistant: microphone -> 16 kHz PCM16 frames, and
// 24 kHz PCM16 speech -> speakers. Gemini Live uses these rates in each direction.
import { analyserMouth, type MouthSource } from './mouth';

export const INPUT_RATE = 16_000;
export const OUTPUT_RATE = 24_000;
/** 50 ms of input audio per frame. */
const FRAME_SAMPLES = 800;

// Inlined so no separate asset has to be served. It resamples from the context rate
// (often 44.1 or 48 kHz, which the browser picks) down to 16 kHz by linear interpolation.
const RECORDER_WORKLET = `
class PcmRecorder extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.ratio = sampleRate / options.processorOptions.targetRate;
    this.frame = new Int16Array(options.processorOptions.frameSamples);
    this.filled = 0;
    this.pos = 0;
    this.last = 0;
  }
  process(inputs) {
    const input = inputs[0] && inputs[0][0];
    if (!input) return true;
    let pos = this.pos;
    while (pos < input.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const a = i === 0 ? this.last : input[i - 1];
      const b = input[i];
      const s = Math.max(-1, Math.min(1, a + (b - a) * frac));
      this.frame[this.filled++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      if (this.filled === this.frame.length) {
        this.port.postMessage(this.frame.buffer.slice(0));
        this.filled = 0;
      }
      pos += this.ratio;
    }
    this.pos = pos - input.length;
    this.last = input[input.length - 1];
    return true;
  }
}
registerProcessor("pcm-recorder", PcmRecorder);
`;

export type Recorder = { stop: () => void; setMuted: (muted: boolean) => void };

/** Peak level of a PCM16 frame, 0 to 1. */
export function frameLevel(pcm: ArrayBuffer): number {
  const samples = new Int16Array(pcm);
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  return peak / 0x8000;
}

/** Call from a click handler: the AudioContext is created before the first await, inside the gesture. */
export async function startRecorder(onFrame: (pcm: ArrayBuffer) => void): Promise<Recorder> {
  const context = new AudioContext();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (cause) {
    void context.close();
    throw cause;
  }
  const url = URL.createObjectURL(new Blob([RECORDER_WORKLET], { type: "application/javascript" }));
  try {
    await context.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "pcm-recorder", {
    processorOptions: { targetRate: INPUT_RATE, frameSamples: FRAME_SAMPLES },
  });
  let muted = false;
  node.port.onmessage = event => { if (!muted && event.data instanceof ArrayBuffer) onFrame(event.data); };
  // The worklet must be pulled by the graph to run; a muted gain keeps it silent.
  const sink = context.createGain();
  sink.gain.value = 0;
  source.connect(node).connect(sink).connect(context.destination);
  if (context.state === "suspended") await context.resume();
  return {
    setMuted(next) {
      muted = next;
      stream.getAudioTracks().forEach(track => { track.enabled = !next; });
    },
    stop() {
      node.port.onmessage = null;
      stream.getTracks().forEach(track => track.stop());
      void context.close();
    },
  };
}

/** Room echo lingers after playback stops, and chunks can arrive with small gaps. */
const ECHO_TAIL_MS = 500;

/** How far one turn of Otto's speech has got: seconds played and seconds received so far. */
export type SpeechProgress = { played: number; received: number };
/** Read every frame by the speech bubble; null when nothing of this turn has arrived. */
export type SpeechClock = () => SpeechProgress | null;

const UNLOCK_EVENTS = ["pointerdown", "keydown", "touchstart"] as const;

/**
 * Plays streamed PCM16 chunks back to back, and can be cut off instantly on barge-in.
 *
 * Autoplay: made inside a click the context starts running. Made any other way ("Hey Otto", a start that waited for the
 * audio code) it may start suspended. Chunks are then queued, not dropped: they are scheduled on the context's clock,
 * which stands still while suspended, and play in order once it runs. It is resumed on every chunk (allowed once the
 * page has had a click or key press) and on the visitor's next click, tap or key press (Alt+O included).
 */
export class SpeechPlayer {
  private context = new AudioContext({ sampleRate: OUTPUT_RATE });
  private nextStart = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private quietAt = 0;
  /** Reads Otto's voice as it plays, for the robot's mouth. */
  private analyser: AnalyserNode;
  /** This turn's chunks, as [start, end] on the context's clock, for progress(). */
  private turn: { start: number; end: number }[] = [];
  private turnDone = 0;
  private turnPlayed = 0;
  private turnReceived = 0;
  private newTurn = true;
  /** After interrupt(): the rest of the interrupted turn still on its way from the server is dropped. */
  private dropping = false;
  private closed = false;
  private readonly unlock = () => { void this.resume(); };
  /** The five mouth bars from the voice's speech bands (mouth.ts), or null once quiet and settled. */
  readonly mouth: MouthSource;
  /** The node Otto's voice passes through on its way out, for connecting another analyser (e.g. a mascot's lip-sync). */
  get output(): AudioNode { return this.analyser; }
  /** Seconds of this turn played and received, for the speech bubble. */
  readonly clock: SpeechClock = () => this.progress();
  onIdle: (() => void) | null = null;

  constructor() {
    this.analyser = this.context.createAnalyser();
    this.analyser.connect(this.context.destination);
    this.mouth = analyserMouth(this.analyser, () => this.sources.size > 0);
    if (typeof window !== "undefined") {
      for (const type of UNLOCK_EVENTS) window.addEventListener(type, this.unlock, { capture: true, passive: true });
    }
  }

  async resume() {
    try {
      if (this.context.state === "suspended") await this.context.resume();
    } catch { /* closed before resume finished, or not allowed yet */ }
  }

  /** "running", or "suspended" until the browser allows sound. */
  get state(): AudioContextState {
    return this.context.state;
  }

  get playing() {
    return this.sources.size > 0;
  }

  /** True while speech is audible, so the microphone would pick it up. */
  get busy() {
    return this.sources.size > 0 || performance.now() < this.quietAt;
  }

  /** Nodes still connected (for leak checks): zero once quiet. */
  get activeSources() {
    return this.sources.size;
  }

  play(chunk: ArrayBuffer) {
    if (this.closed || this.dropping) return;
    const samples = new Int16Array(chunk, 0, Math.floor(chunk.byteLength / 2));
    if (!samples.length) return;
    if (this.context.state === "suspended") void this.resume();
    const buffer = this.context.createBuffer(1, samples.length, OUTPUT_RATE);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    // A small lead absorbs network jitter; after a gap, restart from "now".
    const now = this.context.currentTime;
    if (this.nextStart < now + 0.02) this.nextStart = now + 0.06;
    source.start(this.nextStart);
    if (this.newTurn) { this.turn = []; this.turnDone = 0; this.turnPlayed = 0; this.turnReceived = 0; this.newTurn = false; }
    this.turn.push({ start: this.nextStart, end: this.nextStart + buffer.duration });
    this.turnReceived += buffer.duration;
    this.nextStart += buffer.duration;
    this.sources.add(source);
    source.onended = () => {
      source.disconnect();
      this.sources.delete(source);
      if (!this.sources.size) {
        this.quietAt = performance.now() + ECHO_TAIL_MS;
        this.onIdle?.();
      }
    };
  }

  /** How much of this turn has played, by the audio clock itself (so the bubble keeps pace with what is heard). */
  progress(): SpeechProgress | null {
    if (!this.turn.length) return null;
    const t = this.context.currentTime;
    // Chunks play in order: everything before `turnDone` has finished.
    while (this.turnDone < this.turn.length && this.turn[this.turnDone].end <= t) {
      const c = this.turn[this.turnDone++];
      this.turnPlayed += c.end - c.start;
    }
    let played = this.turnPlayed;
    const current = this.turn[this.turnDone];
    if (current && t > current.start) played += t - current.start;
    return { played: Math.min(played, this.turnReceived), received: this.turnReceived };
  }

  /** The server finished this turn: the next chunk starts a new one (and audio is let through again after a barge-in). */
  endTurn() {
    this.newTurn = true;
    this.dropping = false;
  }

  /** Stops what is playing now (sources stopped and disconnected, queue emptied). */
  flush() {
    for (const source of this.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* already stopped */ }
      source.disconnect();
    }
    this.sources.clear();
    this.nextStart = 0;
    this.quietAt = 0;
    this.turn = [];
    this.newTurn = true;
    this.onIdle?.();
  }

  /**
   * Barge-in: stop now, and drop the rest of this turn that is still arriving, until endTurn() (the server's
   * "interrupted" or "turn_complete"). The mouth then decays to closed on its own, as in any pause.
   */
  interrupt() {
    this.dropping = true;
    this.flush();
  }

  close() {
    if (this.closed) return;
    this.flush();
    this.closed = true;
    this.onIdle = null;
    if (typeof window !== "undefined") {
      for (const type of UNLOCK_EVENTS) window.removeEventListener(type, this.unlock, { capture: true });
    }
    this.context.close().catch(() => {});
  }
}
