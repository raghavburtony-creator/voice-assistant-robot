import { describe, expect, it } from 'vitest'
import { compareConstraints, describeConstraint, describeLevels, MIC_REQUEST, PROCESSING_CONSTRAINTS, SILENT_PEAK, summariseLevels } from './micDiagnostic'

describe('what the recorder asks the microphone for', () => {
  it('asks for mono audio with all three kinds of processing', () => {
    expect(MIC_REQUEST).toEqual({ channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true })
    expect(PROCESSING_CONSTRAINTS).toEqual(['echoCancellation', 'noiseSuppression', 'autoGainControl'])
  })
})

describe('reading back which constraints took effect', () => {
  const supported = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }

  it('reports each constraint the track kept as applied', () => {
    const report = compareConstraints({ echoCancellation: true, noiseSuppression: true, autoGainControl: true }, supported)
    expect(report.map(item => item.status)).toEqual(['applied', 'applied', 'applied'])
  })

  it('says so when the browser turned one off', () => {
    const report = compareConstraints({ echoCancellation: false, noiseSuppression: true, autoGainControl: true }, supported)
    expect(report[0]).toEqual({ name: 'echoCancellation', requested: true, applied: false, status: 'not_applied' })
    expect(describeConstraint(report[0])).toBe('echoCancellation: NOT applied: the browser turned it off')
  })

  it('tells a constraint the browser does not list from one it lists but does not report', () => {
    const report = compareConstraints({}, { echoCancellation: true, noiseSuppression: false })
    expect(report.map(item => item.status)).toEqual(['unknown', 'unsupported', 'unsupported'])
  })

  it('never guesses from a value that is not a boolean, or from no settings at all', () => {
    expect(compareConstraints({ echoCancellation: 'true', noiseSuppression: 1, autoGainControl: null }, supported).map(item => item.status))
      .toEqual(['unknown', 'unknown', 'unknown'])
    expect(compareConstraints(null).map(item => item.status)).toEqual(['unknown', 'unknown', 'unknown'])
    expect(compareConstraints(undefined, supported).map(item => item.status)).toEqual(['unknown', 'unknown', 'unknown'])
  })
})

describe('summarising a short listening window', () => {
  it('gives the average, the peak and the quietest frame', () => {
    const summary = summariseLevels([0.01, 0.05, 0.02, 0.2])
    expect(summary.frames).toBe(4)
    expect(summary.average).toBeCloseTo(0.07)
    expect(summary).toMatchObject({ peak: 0.2, floor: 0.01, silent: false })
    expect(describeLevels(summary)).toBe('level over 4 frames: average 0.0700, peak 0.2000, quietest 0.0100')
  })

  it('calls a window with no real signal silent, and says why that matters', () => {
    const summary = summariseLevels([0, SILENT_PEAK / 2, 0])
    expect(summary.silent).toBe(true)
    expect(describeLevels(summary)).toContain('No signal')
  })

  it('drops frames that are not finite numbers from 0 up, and caps one above 1', () => {
    const summary = summariseLevels([NaN, -1, Infinity, '0.5' as unknown as number, 0.1, 3])
    expect(summary).toMatchObject({ frames: 2, peak: 1, floor: 0.1 })
  })

  it('reports an empty window without inventing numbers', () => {
    expect(summariseLevels([])).toEqual({ frames: 0, average: 0, peak: 0, floor: 0, silent: true })
    expect(describeLevels(summariseLevels([]))).toBe('level: no frames were read')
  })
})
