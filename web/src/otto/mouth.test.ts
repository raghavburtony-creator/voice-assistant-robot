import { describe, expect, it } from 'vitest'
import { fakeVoiceSpectrum, MOUTH_BANDS, MouthAnalyzer } from './mouth'

const RATE = 24000, BINS = 256 // fftSize 512 at 24 kHz: ~47 Hz a bin
/** A spectrum with energy (dB) only around the given frequencies, and a quiet room (-110 dB) elsewhere. */
function spectrum(peaks: [hz: number, db: number][], room = -110) {
  const out = new Float32Array(BINS).fill(room)
  const hzPerBin = RATE / (BINS * 2)
  for (const [hz, db] of peaks) for (let i = 0; i < BINS; i++) if (Math.abs(i * hzPerBin - hz) < 150) out[i] = Math.max(out[i], db)
  return out
}
const settle = (m: MouthAnalyzer, s: Float32Array | null, seconds = 0.5) => { for (let t = 0; t < seconds; t += 1 / 60) m.update(s, RATE, 1 / 60); return [...m.bars] }

describe('MouthAnalyzer bands', () => {
  it('covers speech from 85 Hz to 4 kHz, low pitch in the centre, sibilants outermost', () => {
    expect(Math.min(...MOUTH_BANDS.map(b => b.from))).toBe(85)
    expect(Math.max(...MOUTH_BANDS.map(b => b.to))).toBe(4000)
    expect(MOUTH_BANDS[2]).toMatchObject({ from: 85, to: 300 })
    expect(MOUTH_BANDS[4].from).toBeGreaterThanOrEqual(3000)
  })

  it('a low vowel lifts the centre bar, not the outer ones', () => {
    const bars = settle(new MouthAnalyzer(), spectrum([[150, -38]]))
    expect(bars[2]).toBeGreaterThan(0.6)
    expect(Math.max(bars[0], bars[4])).toBe(0)
  })

  it('formants lift the inner pair (F1 left, F2 right)', () => {
    const bars = settle(new MouthAnalyzer(), spectrum([[600, -42], [1500, -46]]))
    expect(bars[1]).toBeGreaterThan(0.4)
    expect(bars[3]).toBeGreaterThan(0.4)
    expect(bars[2]).toBe(0)
  })

  it('a sibilant lifts the outer pair', () => {
    const bars = settle(new MouthAnalyzer(), spectrum([[2500, -52], [3500, -55]]))
    expect(Math.min(bars[0], bars[4])).toBeGreaterThan(0.3)
    expect(bars[2]).toBe(0)
  })
})

describe('MouthAnalyzer gate and smoothing', () => {
  it('room noise under the gate leaves every bar at exactly 0', () => {
    expect(settle(new MouthAnalyzer(), spectrum([], -75))).toEqual([0, 0, 0, 0, 0])
  })

  it('rises fast and, between syllables, falls slowly', () => {
    const m = new MouthAnalyzer()
    const loud = spectrum([[150, -32]])
    m.update(loud, RATE, 0.05)
    const afterRise = m.bars[2]
    settle(m, loud)
    const top = m.bars[2]
    // A quieter moment that keeps the gate open (still above gateDb): the bar glides toward its new level.
    const quiet = spectrum([[150, -60]])
    const ref = new MouthAnalyzer(); settle(ref, loud); settle(ref, quiet, 2)
    const low = ref.bars[2] // where the bar ends up at the quieter level
    m.update(quiet, RATE, 0.05)
    const fell = (top - m.bars[2]) / (top - low)
    expect(afterRise / top).toBeGreaterThan(0.8) // 50 ms goes >80% of the way up (attack 25 ms)
    expect(fell).toBeLessThan(0.4)               // 50 ms goes <40% of the way down (release 140 ms)
  })

  it('closes faster once a pause shuts the gate', () => {
    const m = new MouthAnalyzer()
    settle(m, spectrum([[150, -32]]))
    const top = m.bars[2]
    m.update(spectrum([]), RATE, 0.05)
    expect((top - m.bars[2]) / top).toBeGreaterThan(0.5)
  })

  it('settles to exactly 0 in a pause and reports silent', () => {
    const m = new MouthAnalyzer()
    settle(m, spectrum([[150, -35], [600, -40]]))
    expect(m.silent).toBe(false)
    settle(m, null, 1.5)
    expect([...m.bars]).toEqual([0, 0, 0, 0, 0])
    expect(m.silent).toBe(true)
  })

  it('looks the same at 30 and 120 fps', () => {
    const at = (fps: number) => { const m = new MouthAnalyzer(); const s = spectrum([[150, -36]]); for (let i = 0; i < fps * 0.1; i++) m.update(s, RATE, 1 / fps); return m.bars[2] }
    expect(at(30)).toBeCloseTo(at(120), 5)
  })

  it('the gate has hysteresis: a level hovering at the threshold does not flicker', () => {
    const m = new MouthAnalyzer({ gateDb: -64, hysteresisDb: 4 })
    settle(m, spectrum([[150, -62]]))      // between gate and gate + hysteresis: not loud enough to open
    expect(m.bars[2]).toBe(0)
    settle(m, spectrum([[150, -50]]))      // opens
    const opened = m.bars[2]
    settle(m, spectrum([[150, -62]]), 0.1) // back near the threshold: stays open, eases down
    expect(m.bars[2]).toBeGreaterThan(0)
    expect(opened).toBeGreaterThan(m.bars[2])
  })
})

describe('the fake voice', () => {
  it('moves every bar while talking and shuts the mouth in the pauses between words', () => {
    const m = new MouthAnalyzer(), s = new Float32Array(BINS)
    const peak = [0, 0, 0, 0, 0]
    let pausedAt0 = true
    for (let t = 0; t < 4.8; t += 1 / 60) {
      m.update(fakeVoiceSpectrum(t, s), RATE, 1 / 60)
      m.bars.forEach((b, i) => { peak[i] = Math.max(peak[i], b) })
      // Late in each word's pause (1.25-1.6 s into every 1.6 s word) the bars have released to 0.
      const w = t % 1.6
      if (w > 1.55 && w < 1.6 && !m.silent) pausedAt0 = false
    }
    expect(peak.every(p => p > 0.3)).toBe(true)
    expect(pausedAt0).toBe(true)
  })
})

// A grid where every bin is exactly 5 Hz (fftSize 2000 at 10 kHz), so each band edge falls on a bin boundary.
describe('MouthAnalyzer band edges', () => {
  const RATE5 = 10000, BINS5 = 1000
  const lit = (bins: number[], db = -10) => {
    const out = new Float32Array(BINS5).fill(-200)
    for (const b of bins) out[b] = db
    const m = new MouthAnalyzer()
    for (let t = 0; t < 0.5; t += 1 / 60) m.update(out, RATE5, 1 / 60)
    return [...m.bars].map(b => b > 0)
  }
  const range = (a: number, b: number) => Array.from({ length: b - a }, (_, i) => a + i)

  it('each band, filled alone, opens only its own bar', () => {
    MOUTH_BANDS.forEach((band, bar) => {
      const open = lit(range(band.from / 5, band.to / 5))
      expect(open.map((o, i) => (o ? i : -1)).filter(i => i >= 0)).toEqual([bar])
    })
  })

  it.each([
    [16, null], [17, 2], [59, 2], [60, 1], [199, 1], [200, 3], [399, 3], [400, 0], [599, 0], [600, 4], [799, 4], [800, null],
  ])('bin %i (%i x 5 Hz) belongs to bar %s', (bin, bar) => {
    const open = lit([bin])
    expect(open.map((o, i) => (o ? i : -1)).filter(i => i >= 0)).toEqual(bar === null ? [] : [bar])
  })

  it('energy under the gate keeps every bar at exactly 0, just over it opens', () => {
    const quiet = new Float32Array(BINS5).fill(-80)
    const m = new MouthAnalyzer()
    for (let t = 0; t < 0.5; t += 1 / 60) m.update(quiet, RATE5, 1 / 60)
    expect([...m.bars]).toEqual([0, 0, 0, 0, 0])
    const loud = new Float32Array(BINS5).fill(-45)
    for (let t = 0; t < 0.5; t += 1 / 60) m.update(loud, RATE5, 1 / 60)
    expect(m.bars.every(b => b > 0)).toBe(true)
  })
})

describe('MouthAnalyzer attack, release and determinism', () => {
  const loud = spectrum([[150, -32]])
  const loudBar = () => { const m = new MouthAnalyzer(); settle(m, loud); return m }

  it('after a loud frame, silent frames only ever lower the bars, and they reach 0', () => {
    const m = loudBar()
    let prev = [...m.bars]
    expect(prev[2]).toBeGreaterThan(0.5)
    for (let t = 0; t < 1; t += 1 / 60) {
      m.update(null, RATE, 1 / 60)
      m.bars.forEach((b, i) => expect(b).toBeLessThanOrEqual(prev[i]))
      prev = [...m.bars]
    }
    expect(prev).toEqual([0, 0, 0, 0, 0])
  })

  it('is nearly closed one release time (140 ms) after the voice stops', () => {
    const m = loudBar()
    const top = m.bars[2]
    for (let t = 0; t < 0.14 - 1e-9; t += 1 / 60) m.update(null, RATE, 1 / 60)
    expect(m.bars[2]).toBeLessThan(top * 0.2)
  })

  it('rises faster than it falls', () => {
    const rise = new MouthAnalyzer(); rise.update(loud, RATE, 0.03)
    const top = loudBar().bars[2]
    const fall = loudBar(); fall.update(null, RATE, 0.03)
    expect(rise.bars[2] / top).toBeGreaterThan(1 - fall.bars[2] / top)
  })

  it('same input gives the same output, and reset() starts over', () => {
    const run = () => { const m = new MouthAnalyzer(); const out: number[] = []; for (let i = 0; i < 30; i++) out.push(...m.update(i % 7 < 4 ? loud : null, RATE, 1 / 60)); return out }
    expect(run()).toEqual(run())
    const m = loudBar(); m.reset()
    expect(m.silent).toBe(true)
  })

  it('a negative or zero dt moves nothing, and NaN bins do not poison the bars', () => {
    const m = new MouthAnalyzer()
    m.update(loud, RATE, -1); m.update(loud, RATE, 0)
    expect(m.silent).toBe(true)
    const bad = spectrum([[150, -32]]); bad[3] = NaN
    settle(m, bad)
    expect([...m.bars].every(Number.isFinite)).toBe(true)
  })
})
