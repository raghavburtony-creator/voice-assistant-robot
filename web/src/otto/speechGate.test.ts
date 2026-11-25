import { describe, expect, it, vi } from 'vitest'
import { BargeInGate, DEFAULT_BARGE, DEFAULT_FLOOR, NoiseFloor, OpenMicGate, SpeechGate, type VoiceDiagnostic } from './speechGate'

const FRAME = 50

/** Runs a gate over `levels` (one per 50 ms frame) starting at `t0`; returns the time after the last frame. */
function feed(gate: SpeechGate, levels: number[], t0 = 0) {
  let t = t0
  for (const level of levels) { t += FRAME; gate.step(level, t) }
  return t
}
const repeat = (level: number, ms: number) => Array.from({ length: Math.round(ms / FRAME) }, () => level)

function makeGate(settings = {}) {
  const h = { onSpeechStart: vi.fn(), onSpeechEnd: vi.fn(), onNoSpeech: vi.fn() }
  const diagnostics: VoiceDiagnostic[] = []
  const gate = new SpeechGate(settings, { ...h, onDiagnostic: e => diagnostics.push(e) }, 0)
  return { gate, h, diagnostics }
}

describe('NoiseFloor', () => {
  it('falls fast in a pause and rises slowly under speech', () => {
    const floor = new NoiseFloor()
    for (let i = 0; i < 100; i++) floor.update(0.05, FRAME, false) // 5 s of fan
    const learned = floor.value
    expect(learned).toBeGreaterThan(0.04)
    for (let i = 0; i < 5; i++) floor.update(0.4, FRAME, true) // a spoken word of 250 ms
    expect(floor.value).toBeLessThan(learned + 0.02)
    for (let i = 0; i < 6; i++) floor.update(0.001, FRAME, true)
    expect(floor.value).toBeLessThan(0.01)
  })

  it('is capped, so a loud room cannot make the gate deaf', () => {
    const floor = new NoiseFloor()
    for (let i = 0; i < 400; i++) floor.update(0.9, FRAME, false)
    expect(floor.value).toBeLessThanOrEqual(DEFAULT_FLOOR.maxFloor)
  })
})

describe('SpeechGate: the user turn', () => {
  it('one coherent turn: onset, speech, hangover, one end', () => {
    const { gate, h } = makeGate()
    const t = feed(gate, [...repeat(0, 500), ...repeat(0.2, 600), ...repeat(0, 1200)])
    expect(h.onSpeechStart).toHaveBeenCalledTimes(1)
    expect(h.onSpeechEnd).toHaveBeenCalledExactlyOnceWith('silence')
    feed(gate, repeat(0.2, 2000), t)
    expect(h.onSpeechStart).toHaveBeenCalledTimes(1) // a finished gate does not reopen turns by itself
  })

  it('a cough or click shorter than the onset is not a turn', () => {
    const { gate, h } = makeGate()
    feed(gate, [...repeat(0, 500), ...repeat(0.3, 100), ...repeat(0, 1000)])
    expect(h.onSpeechStart).not.toHaveBeenCalled()
  })

  it('learns the room before it listens: no turn starts in the calibration window', () => {
    const { gate, h } = makeGate()
    feed(gate, repeat(0.3, 350))
    expect(h.onSpeechStart).not.toHaveBeenCalled()
  })

  it('a steady fan above the fixed minimum never opens a turn', () => {
    const { gate, h } = makeGate()
    feed(gate, repeat(0.045, 5800))
    expect(h.onSpeechStart).not.toHaveBeenCalled()
  })

  it('hysteresis: a level between the exit and the enter line holds an open turn but does not open one', () => {
    // floor 0.01: enter = max(0.02, 0.025) = 0.025, exit = max(0.012, 0.016) = 0.016
    const closed = makeGate()
    feed(closed.gate, [...repeat(0.01, 500), ...repeat(0.02, 1000)])
    expect(closed.h.onSpeechStart).not.toHaveBeenCalled()
    const open = makeGate()
    const t = feed(open.gate, [...repeat(0.01, 500), ...repeat(0.2, 400)])
    expect(open.h.onSpeechStart).toHaveBeenCalledTimes(1)
    feed(open.gate, repeat(0.02, 800), t)
    expect(open.h.onSpeechEnd).not.toHaveBeenCalled()
  })

  it('a pause shorter than the hangover does not end the turn; a longer one does', () => {
    const { gate, h } = makeGate()
    let t = feed(gate, [...repeat(0, 500), ...repeat(0.2, 400)])
    t = feed(gate, repeat(0, 800), t)
    t = feed(gate, repeat(0.2, 400), t)
    expect(h.onSpeechEnd).not.toHaveBeenCalled()
    feed(gate, repeat(0, 1100), t)
    expect(h.onSpeechEnd).toHaveBeenCalledTimes(1)
  })

  it('speech and then a fan: the turn ends and the fan opens no second turn', () => {
    const { gate, h } = makeGate()
    feed(gate, [...repeat(0, 500), ...repeat(0.25, 500), ...repeat(0.05, 12_000)])
    expect(h.onSpeechStart).toHaveBeenCalledTimes(1)
    expect(h.onSpeechEnd).toHaveBeenCalledTimes(1)
  })

  it('no speech in time is reported once; a turn past the ceiling is cut', () => {
    const quiet = makeGate()
    feed(quiet.gate, repeat(0, 6500))
    expect(quiet.h.onNoSpeech).toHaveBeenCalledTimes(1)
    const long = makeGate({ maxTurnDurationMs: 3000 })
    feed(long.gate, [...repeat(0, 500), ...repeat(0.3, 4000)])
    expect(long.h.onSpeechEnd).toHaveBeenCalledExactlyOnceWith('max')
  })

  it('hold() freezes the clocks while Otto is audible', () => {
    const { gate, h } = makeGate({ noSpeechTimeoutMs: 1000, calibrationMs: 0 })
    for (let t = 50; t <= 5000; t += 50) gate.hold(t)
    expect(h.onNoSpeech).not.toHaveBeenCalled()
    feed(gate, repeat(0, 1100), 5000)
    expect(h.onNoSpeech).toHaveBeenCalledTimes(1)
  })

  it('begin() opens the turn for a confirmed interruption; it ends by the hangover', () => {
    const { gate, h } = makeGate({ calibrationMs: 0 })
    gate.begin(0)
    expect(gate.isSpeaking).toBe(true)
    feed(gate, repeat(0, 1100))
    expect(h.onSpeechEnd).toHaveBeenCalledExactlyOnceWith('silence')
  })

  it('a carried floor skips calibration and keeps a fan out of the first turn', () => {
    const { gate, h } = makeGate({ initialFloor: 0.05 })
    const t = feed(gate, repeat(0.05, 1000))
    expect(h.onSpeechStart).not.toHaveBeenCalled()
    feed(gate, repeat(0.3, 300), t)
    expect(h.onSpeechStart).toHaveBeenCalledTimes(1)
  })

  it('reports start and end as diagnostics with levels and reasons only', () => {
    const { gate, diagnostics } = makeGate()
    feed(gate, [...repeat(0, 500), ...repeat(0.2, 400), ...repeat(0, 1200)])
    expect(diagnostics.map(d => d.type)).toEqual(['speech_start', 'speech_end'])
    expect(diagnostics[1]).toMatchObject({ type: 'speech_end', reason: 'silence' })
    expect(Object.keys(diagnostics[0]).sort()).toEqual(['floor', 'level', 'type'])
  })
})

describe('BargeInGate: interrupting Otto', () => {
  const settings = DEFAULT_BARGE
  const make = () => {
    const diagnostics: VoiceDiagnostic[] = []
    const gate = new BargeInGate(settings, e => diagnostics.push(e))
    run(gate, repeat(0.001, settings.calibrationMs), false) // the room, learned while Otto was silent
    return { gate, diagnostics }
  }
  const run = (gate: BargeInGate, levels: number[], audible = true) => levels.map(l => gate.frame(l, FRAME, audible))

  it('a genuine, sustained voice interrupts and says why', () => {
    const { gate, diagnostics } = make()
    const out = run(gate, repeat(0.5, 200))
    expect(out.indexOf(true)).toBe(3) // 4 frames = 200 ms
    expect(diagnostics.at(-1)).toMatchObject({ type: 'interruption', accepted: true, reason: 'sustained_speech' })
  })

  it('a brief noise does not interrupt, and is reported as too brief', () => {
    const { gate, diagnostics } = make()
    expect(run(gate, [...repeat(0.6, 100), ...repeat(0.01, 400)]).some(Boolean)).toBe(false)
    expect(diagnostics).toEqual([expect.objectContaining({ type: 'interruption', accepted: false, reason: 'too_brief' })])
  })

  it('a dip inside speech does not restart the run', () => {
    const { gate } = make()
    expect(run(gate, [0.5, 0.5, 0.01, 0.5, 0.5]).some(Boolean)).toBe(true)
  })

  it('a steady fan louder than the fixed line does not interrupt: the line follows the floor', () => {
    const { gate } = make()
    run(gate, repeat(0.3, 3000), false) // the fan, while Otto is silent: that is the floor (capped at 0.1)
    expect(gate.line).toBeGreaterThan(settings.level)
    expect(run(gate, repeat(0.3, 3000)).some(Boolean)).toBe(false)
  })

  it("the floor is not learned from Otto's own echo", () => {
    const { gate } = make()
    run(gate, repeat(0.01, 500), false)
    const before = gate.noiseFloor
    run(gate, repeat(0.15, 2000)) // his echo, under the fixed line
    expect(gate.noiseFloor).toBe(before)
  })

  it('echo under the fixed line never interrupts', () => {
    const { gate } = make()
    expect(run(gate, repeat(0.2, 3000)).some(Boolean)).toBe(false)
  })

  it('a loud room cannot interrupt before the floor is learned (Otto spoke as soon as the mic opened)', () => {
    const diagnostics: VoiceDiagnostic[] = []
    const gate = new BargeInGate(settings, e => diagnostics.push(e))
    run(gate, repeat(0.3, 100), false) // 100 ms of room only: not calibrated
    expect(gate.calibrated).toBe(false)
    expect(run(gate, repeat(0.3, 1000)).some(Boolean)).toBe(false) // the room, above the fixed line, while he speaks
    expect(diagnostics.some(d => d.type === 'interruption' && !d.accepted && d.reason === 'calibrating')).toBe(true)
  })

  it("calibrates from Otto's silences, however short each is", () => {
    const gate = new BargeInGate(settings)
    for (let i = 0; i < 8; i++) { run(gate, repeat(0.01, 50), false); run(gate, [0.01], true) }
    expect(gate.calibrated).toBe(true)
  })

  it('a carried floor needs no calibration', () => {
    expect(new BargeInGate(settings, undefined, 0.05).calibrated).toBe(true)
  })

  it('when Otto falls silent a run in progress is forgotten', () => {
    const { gate } = make()
    run(gate, [0.5, 0.5, 0.5])
    run(gate, [0.01], false)
    expect(run(gate, [0.5]).some(Boolean)).toBe(false)
  })
})

describe('OpenMicGate: what an open microphone sends', () => {
  /** Frames are numbered, so a test can say which went upstream. */
  function mic() {
    const diagnostics: VoiceDiagnostic[] = []
    const gate = new OpenMicGate<number>({}, 12, e => diagnostics.push(e))
    const sent: number[] = []
    let ends = 0
    let n = 0
    let t = 0
    const push = (levels: number[]) => levels.forEach(level => {
      const step = gate.frame(n++, level, (t += FRAME))
      sent.push(...step.send)
      if (step.endOfAudio) ends++
    })
    return { gate, diagnostics, sent, push, ends: () => ends, time: () => t, count: () => n }
  }

  it('a room with only a fan sends nothing upstream: no unbounded capture', () => {
    const m = mic()
    m.push(repeat(0.05, 60_000))
    expect(m.sent).toEqual([])
    expect(m.ends()).toBe(0)
  })

  it('one coherent turn is sent whole, with the start of the first word, and ends once', () => {
    const m = mic()
    m.push(repeat(0.001, 500)) // frames 0..9
    m.push(repeat(0.2, 600)) // frames 10..21: speech starts after the onset
    m.push(repeat(0.001, 1200))
    expect(m.sent[0]).toBeLessThanOrEqual(10) // the lead-in includes the frames before the onset was confirmed
    expect(m.sent).toContain(21)
    expect(m.sent.every((f, i) => i === 0 || f === m.sent[i - 1] + 1)).toBe(true) // no gaps inside the turn
    expect(m.ends()).toBe(1)
    expect(m.gate.isStreaming).toBe(false)
  })

  it('after a turn the fan is dropped, and the next turn is still detected', () => {
    const m = mic()
    m.push([...repeat(0.04, 1000), ...repeat(0.3, 600), ...repeat(0.04, 5000)])
    const firstTurn = m.sent.length
    expect(m.ends()).toBe(1)
    m.push(repeat(0.04, 5000))
    expect(m.sent.length).toBe(firstTurn) // nothing more upstream
    m.push(repeat(0.3, 600))
    expect(m.sent.length).toBeGreaterThan(firstTurn)
    m.push(repeat(0.04, 2000))
    expect(m.ends()).toBe(2)
  })

  it('Otto becoming audible closes the visitor turn and keeps nothing', () => {
    const m = mic()
    m.push([...repeat(0.001, 500), ...repeat(0.2, 600)])
    expect(m.gate.isStreaming).toBe(true)
    expect(m.gate.otto().endOfAudio).toBe(true)
    expect(m.gate.isStreaming).toBe(false)
    expect(m.gate.otto().endOfAudio).toBe(false)
  })

  it('a barge-in sends what was held and opens the turn, which then ends by the hangover', () => {
    const m = mic()
    const step = m.gate.interrupted([100, 101, 102], m.time())
    expect(step.send).toEqual([100, 101, 102])
    expect(m.gate.isStreaming).toBe(true)
    m.push(repeat(0.001, 1100))
    expect(m.ends()).toBe(1)
  })

  it('stop() (muted, or Talk pressed) forgets the turn without telling the server twice', () => {
    const m = mic()
    m.push([...repeat(0.001, 500), ...repeat(0.2, 600)])
    m.gate.stop()
    expect(m.gate.isStreaming).toBe(false)
  })
})
