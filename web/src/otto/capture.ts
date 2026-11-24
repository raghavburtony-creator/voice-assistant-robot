// A shared camera or screen (D-21): when it may send, how big and how often a frame is, and why it stops.
// Pure rules. The shell does the capture (getUserMedia, getDisplayMedia, the canvas) and asks these before each frame.

export type CaptureSource = 'camera' | 'screen'
/** "stop": the visitor pressed Stop. "ended": the conversation ended (the time limit too). "track_ended": the browser's own Stop sharing, or a lost device. */
export type CaptureStopReason = 'stop' | 'ended' | 'hidden' | 'track_ended'

/** At most one frame a second, at most this many pixels on the long side. The server checks the rate and size again.
 *  The extra 100 ms keeps network jitter from putting two frames under the server's full second. */
export const FRAME_INTERVAL_MS = 1100
export const MAX_FRAME_SIDE = 768

export interface CaptureState {
  /** A conversation is open. */
  open: boolean
  /** The tab is visible. */
  visible: boolean
  /** The shared track is still live. */
  trackLive: boolean
}

/** Why a running share must stop now, or null while it may go on. A stopped share never restarts by itself. */
export function captureStop(state: CaptureState): CaptureStopReason | null {
  if (!state.open) return 'ended'
  if (!state.trackLive) return 'track_ended'
  if (!state.visible) return 'hidden'
  return null
}

/** Whether a frame may be sent at `now` (ms), the last one having gone at `lastSentAt` (null: none yet). */
export function frameDue(now: number, lastSentAt: number | null): boolean {
  return lastSentAt === null || now - lastSentAt >= FRAME_INTERVAL_MS
}

/** The size to encode a width x height source at: scaled down to MAX_FRAME_SIDE on the long side, never up. Null for an empty source. */
export function frameSize(width: number, height: number): { width: number; height: number } | null {
  if (!(width > 0 && height > 0)) return null
  const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
