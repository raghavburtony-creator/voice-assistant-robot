// What the microphone is asked for, and a way to read back what the browser actually gave (#145). Pure rules: the shell
// (audio.ts, and the lab's microphone check) does the getUserMedia call and hands the track's settings to these.
//
// Why it exists: a webview (WebKitGTK in the Linux desktop app) can ignore or only partly honour a processing constraint,
// and "bad listening" has several causes (missed words, cut-offs, Otto hearing himself, a wake word that never fires). The
// numbers come first; no threshold changes without them. Levels only: no audio is kept or sent (D-17).

/** The processing constraints the recorder asks for. Each one can be refused or ignored without an error. */
export const PROCESSING_CONSTRAINTS = ['echoCancellation', 'noiseSuppression', 'autoGainControl'] as const
export type ProcessingConstraint = (typeof PROCESSING_CONSTRAINTS)[number]

/** The one request the recorder makes (audio.ts `startRecorder`) and the lab checks, so the lab tests the real thing.
 *  Mono, because the binary frames stay 16 kHz mono PCM16 up (README, "How it works"). */
export const MIC_REQUEST = { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } as const

/** The part of a track's `getSettings()` this reads. Anything missing or of another type is "unknown", never a guess. */
export type MicSettings = Partial<Record<ProcessingConstraint, unknown>> & { channelCount?: unknown; sampleRate?: unknown }
/** `navigator.mediaDevices.getSupportedConstraints()`: which constraint names the browser knows at all. */
export type SupportedConstraints = object

export type ConstraintStatus = 'applied' | 'not_applied' | 'unknown' | 'unsupported'
export type ConstraintReport = { name: ProcessingConstraint; requested: boolean; applied: boolean | null; status: ConstraintStatus }

/** For each processing constraint: was it asked for, did the track report it on, or is that not known. "unsupported" means
 *  the browser does not list the constraint at all, so a missing value is the browser's limit, not a failed request. */
export function compareConstraints(settings: MicSettings | null | undefined, supported?: SupportedConstraints | null): ConstraintReport[] {
  return PROCESSING_CONSTRAINTS.map(name => {
    const requested = MIC_REQUEST[name]
    const value = settings?.[name]
    const applied = typeof value === 'boolean' ? value : null
    const listed = supported ? (supported as Record<string, unknown>)[name] : undefined
    let status: ConstraintStatus
    if (supported && listed === false) status = 'unsupported'
    else if (supported && listed === undefined && applied === null) status = 'unsupported'
    else if (applied === null) status = 'unknown'
    else status = applied === requested ? 'applied' : 'not_applied'
    return { name, requested, applied, status }
  })
}

const STATUS_WORDS: Record<ConstraintStatus, string> = {
  applied: 'on, as asked',
  not_applied: 'NOT applied: the browser turned it off',
  unknown: 'not reported by this browser',
  unsupported: 'not supported by this browser',
}

/** One plain line per constraint, for the lab. */
export function describeConstraint(report: ConstraintReport): string {
  return `${report.name}: ${STATUS_WORDS[report.status]}`
}

/** The level of a short listening window: RMS values from 0 to 1, one per frame. */
export type LevelSummary = { frames: number; average: number; peak: number; floor: number; silent: boolean }
/** Below this peak RMS the track carried no signal worth the name: muted, the wrong device, or a webview that gave silence. */
export const SILENT_PEAK = 0.002

/** Average, peak and quietest frame (the room's noise floor, as the page would learn it) of a window of RMS values. A value
 *  that is not a finite number from 0 up is dropped, so one bad frame cannot hide a real reading. */
export function summariseLevels(rms: readonly number[]): LevelSummary {
  const clean = rms.filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0).map(value => Math.min(1, value))
  if (clean.length === 0) return { frames: 0, average: 0, peak: 0, floor: 0, silent: true }
  const average = clean.reduce((sum, value) => sum + value, 0) / clean.length
  const peak = Math.max(...clean)
  return { frames: clean.length, average, peak, floor: Math.min(...clean), silent: peak < SILENT_PEAK }
}

const fixed = (value: number) => value.toFixed(4)

/** The level line for the lab, with the one hint that follows from it. */
export function describeLevels(summary: LevelSummary): string {
  if (summary.frames === 0) return 'level: no frames were read'
  const numbers = `level over ${summary.frames} frames: average ${fixed(summary.average)}, peak ${fixed(summary.peak)}, quietest ${fixed(summary.floor)}`
  return summary.silent ? `${numbers}. No signal: the microphone is muted, the wrong device, or the webview gave silence.` : numbers
}
