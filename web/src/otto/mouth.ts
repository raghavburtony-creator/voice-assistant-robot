// The mouth: five bars from five speech bands of a voice's spectrum. One analyzer for every source (the live Gemini voice,
// an audio file in the lab, the lab's fake voice), so they all move the mouth the same way.
//
//   bar:   0 (outer)       1 (inner)      2 (centre)    3 (inner)       4 (outer)
//   band:  2.0-3.0 kHz     300 Hz-1 kHz   85-300 Hz     1-2 kHz         3-4 kHz
//          consonants      formant F1     vowel pitch   formant F2      sibilants
//
// Per band: mean power over its FFT bins, a lift for the higher bands (speech falls off ~6 dB an octave), mapped from a
// floor to a ceiling in dB. A gate with hysteresis shuts every bar during pauses and room noise. Bars rise fast (attack)
// and fall slowly (release) between syllables, faster once the gate has shut; exponential in time, so any frame rate
// looks the same.

/** Speech bands in Hz, in bar order (left to right on the mouth), each with its lift in dB. */
export const MOUTH_BANDS: readonly { from: number; to: number; liftDb: number; role: string }[] = [
  { from: 2000, to: 3000, liftDb: 12, role: 'consonants' },
  { from: 300, to: 1000, liftDb: 2, role: 'formant F1' },
  { from: 85, to: 300, liftDb: 0, role: 'vowel pitch' },
  { from: 1000, to: 2000, liftDb: 7, role: 'formant F2' },
  { from: 3000, to: 4000, liftDb: 15, role: 'sibilants' },
]
export const MOUTH_BARS = MOUTH_BANDS.length

export type MouthOptions = {
  /** Band level (dB, after lift) that reads as 0, and as 1. */
  floorDb?: number
  ceilDb?: number
  /** The gate opens when the loudest band passes gateDb + hysteresisDb and shuts when it falls below gateDb. */
  gateDb?: number
  hysteresisDb?: number
  /** Time constants in seconds: how fast a bar rises toward a louder band, and falls toward a quieter one. */
  attack?: number
  release?: number
}

const DEFAULTS: Required<MouthOptions> = { floorDb: -68, ceilDb: -30, gateDb: -64, hysteresisDb: 4, attack: 0.025, release: 0.14 }

export class MouthAnalyzer {
  readonly bars = new Float32Array(MOUTH_BARS)
  private readonly o: Required<MouthOptions>
  private open = false

  constructor(options: MouthOptions = {}) {
    this.o = { ...DEFAULTS, ...options }
  }

  /**
   * Moves the bars `dt` seconds toward what `spectrumDb` holds (dB per FFT bin, as AnalyserNode.getFloatFrequencyData gives;
   * bin i is at i * sampleRate / fftSize Hz) and returns them. Pass null for silence: the bars settle to 0.
   */
  update(spectrumDb: Float32Array | null, sampleRate: number, dt: number): Float32Array {
    const targets = [0, 0, 0, 0, 0]
    if (spectrumDb && spectrumDb.length) {
      const hzPerBin = sampleRate / (spectrumDb.length * 2)
      let loudest = -Infinity
      const levels = MOUTH_BANDS.map(band => {
        const from = Math.max(1, Math.floor(band.from / hzPerBin)), to = Math.max(from + 1, Math.ceil(band.to / hzPerBin))
        let power = 0, n = 0
        for (let i = from; i < to && i < spectrumDb.length; i++) {
          const db = spectrumDb[i]
          if (Number.isFinite(db)) power += 10 ** (db / 10)
          n++
        }
        const db = n && power > 0 ? 10 * Math.log10(power / n) + band.liftDb : -Infinity
        loudest = Math.max(loudest, db)
        return db
      })
      // The gate, with hysteresis so a level hovering at the threshold does not flicker it.
      if (this.open ? loudest < this.o.gateDb : loudest > this.o.gateDb + this.o.hysteresisDb) this.open = !this.open
      if (this.open) levels.forEach((db, i) => { targets[i] = Math.min(1, Math.max(0, (db - this.o.floorDb) / (this.o.ceilDb - this.o.floorDb))) })
    } else {
      this.open = false
    }
    const step = Math.max(0, dt)
    for (let i = 0; i < MOUTH_BARS; i++) {
      // Between syllables (gate open) bars glide down; once the gate shuts it is a pause, and the mouth closes faster.
      const tau = targets[i] > this.bars[i] ? this.o.attack : this.open ? this.o.release : this.o.release * 0.45
      this.bars[i] += (targets[i] - this.bars[i]) * (1 - Math.exp(-step / tau))
      if (this.bars[i] < 0.01 && targets[i] === 0) this.bars[i] = 0 // invisible by now: settle exactly
    }
    return this.bars
  }

  /** True once every bar has settled to 0. */
  get silent(): boolean {
    return this.bars.every(b => b === 0)
  }

  reset() {
    this.bars.fill(0)
    this.open = false
  }
}

/** Something the robot can read the mouth from, once per frame: five bars, or null once silent and settled. */
export type MouthSource = () => ArrayLike<number> | null

/** A MouthSource over a Web Audio AnalyserNode (the live voice, a file). `active` says whether anything is playing. */
export function analyserMouth(analyser: AnalyserNode, active: () => boolean, options?: MouthOptions): MouthSource {
  analyser.fftSize = 512 // ~47 Hz bins at 24 kHz: enough resolution for the 85-300 Hz vowel band
  analyser.smoothingTimeConstant = 0 // the analyzer smooths, asymmetrically
  analyser.minDecibels = -100
  analyser.maxDecibels = -10
  const mouth = new MouthAnalyzer(options)
  const spectrum = new Float32Array(analyser.frequencyBinCount)
  let last = 0
  return () => {
    const now = performance.now()
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
    last = now
    if (active()) {
      analyser.getFloatFrequencyData(spectrum)
      mouth.update(spectrum, analyser.context.sampleRate, dt)
    } else {
      if (mouth.silent) { last = 0; return null }
      mouth.update(null, analyser.context.sampleRate, dt)
    }
    return mouth.bars
  }
}

/**
 * A made-up voice for the lab: a spectrum (dB per bin) of syllables a few times a second. Each syllable is a vowel
 * (pitch around 140 Hz with two formants that drift) and some open with a consonant or end in a hiss (2-4 kHz bursts),
 * with short pauses between words. Fed through the same MouthAnalyzer as the real voice.
 */
export function fakeVoiceSpectrum(t: number, out: Float32Array, sampleRate = 24000): Float32Array {
  const hzPerBin = sampleRate / (out.length * 2)
  const word = t % 1.6                       // a word every 1.6 s, the last 0.35 s of it a pause
  const inWord = word < 1.25
  const syl = (t * 4.3) % 1                  // ~4 syllables a second
  const n = Math.floor(t * 4.3)
  const vowel = inWord ? Math.sin(Math.PI * Math.min(1, syl / 0.85)) ** 1.5 : 0
  const consonant = inWord && n % 2 === 0 ? Math.max(0, 1 - syl / 0.12) : 0
  const hiss = inWord && n % 3 === 1 ? Math.max(0, (syl - 0.7) / 0.3) : 0
  const f0 = 140 + 25 * Math.sin(t * 2.1)
  const f1 = 550 + 200 * Math.sin(n * 1.7), f2 = 1500 + 400 * Math.sin(n * 2.3)
  const bump = (hz: number, centre: number, width: number) => Math.exp(-(((hz - centre) / width) ** 2))
  for (let i = 0; i < out.length; i++) {
    const hz = i * hzPerBin
    const voiced = vowel * (bump(hz, f0, 70) + 0.55 * bump(hz, f1, 180) + 0.3 * bump(hz, f2, 260)) * Math.max(0.05, 1 - hz / 5000)
    const noisy = (0.4 * consonant + 0.5 * hiss) * bump(hz, 3200, 900)
    const power = voiced * 2e-4 + noisy * 4e-6 + 1e-11 // the last term is the room: well under the gate
    out[i] = 10 * Math.log10(power)
  }
  return out
}

/** A MouthSource for the lab's fake voice, through the same analyzer. */
export function fakeMouth(options?: MouthOptions): MouthSource {
  const mouth = new MouthAnalyzer(options)
  const spectrum = new Float32Array(256)
  let last = 0
  return () => {
    const now = performance.now()
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
    last = now
    return mouth.update(fakeVoiceSpectrum(now / 1000, spectrum), 24000, dt)
  }
}
