// A shared camera or screen (D-21): when it may send, how big and how often a frame is, and why it stops.
// Pure rules. The shell does the capture (getUserMedia, getDisplayMedia, the canvas) and asks these before each frame.

export type CaptureSource = 'camera' | 'screen'
/** "stop": the visitor pressed Stop. "ended": the conversation ended (the time limit too). "track_ended": the browser's own Stop sharing, or a lost device. */
export type CaptureStopReason = 'stop' | 'ended' | 'hidden' | 'track_ended'

/** At most one frame a second, at most this many pixels on the long side. The server checks the rate and size again.
 *  The extra 100 ms keeps network jitter from putting two frames under the server's full second. */
export const FRAME_INTERVAL_MS = 1100
export const MAX_FRAME_SIDE = 768

/** What the camera is asked for: pictures only. The microphone has its own consent (D-05), so a share never brings audio. */
export const CAMERA_REQUEST = { video: true, audio: false } as const

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

export interface Box { x: number; y: number; width: number; height: number }

/** CSS px of room around each masked box, so a field's edge or a focus ring doesn't show. */
export const MASK_PAD = 4

/**
 * Where to paint over the page's private regions in a frame of this tab: `boxes` in viewport CSS px, mapped onto a
 * frame of `frame` px that shows a `viewport` CSS px tab, padded, clipped to the frame. Empty or off-frame boxes drop out.
 */
export function maskBoxes(boxes: readonly Box[], viewport: { width: number; height: number }, frame: { width: number; height: number }): Box[] {
  if (!(viewport.width > 0 && viewport.height > 0)) return []
  const sx = frame.width / viewport.width, sy = frame.height / viewport.height
  const out: Box[] = []
  for (const b of boxes) {
    if (!(b.width > 0 && b.height > 0)) continue
    const x0 = Math.max(0, (b.x - MASK_PAD) * sx), y0 = Math.max(0, (b.y - MASK_PAD) * sy)
    const x1 = Math.min(frame.width, (b.x + b.width + MASK_PAD) * sx), y1 = Math.min(frame.height, (b.y + b.height + MASK_PAD) * sy)
    if (x1 > x0 && y1 > y0) out.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 })
  }
  return out
}

/** The size to encode a width x height source at: scaled down to MAX_FRAME_SIDE on the long side, never up. Null for an empty source. */
export function frameSize(width: number, height: number): { width: number; height: number } | null {
  if (!(width > 0 && height > 0)) return null
  const scale = Math.min(1, MAX_FRAME_SIDE / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}
