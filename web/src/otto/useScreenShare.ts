// Sharing the screen with Otto (D-21). Shell: getDisplayMedia, a hidden video, a canvas, the masks. The rules (when to
// stop, how often, how big, where the masks go) are in capture.ts.
//
//   off --ask()--> notice --share()--> starting --picker ok--> on --any stop reason--> off (never restarts by itself)
//                    \--cancel()--> off               \--picker refused--> off

import { useCallback, useEffect, useRef, useState } from 'react'
import { isSensitiveField } from './awareness/collectPage'
import { captureStop, FRAME_INTERVAL_MS, frameSize, maskBoxes, type Box, type CaptureStopReason } from './capture'
import { PRIVATE_SELECTOR } from './guidance/hidden'

export type ScreenSharePhase = 'off' | 'notice' | 'starting' | 'on'

interface Options {
  /** A conversation is open: sharing may start, and it stops when this goes false. */
  open: boolean
  sendCapture: (source: 'screen' | null) => boolean
  sendFrame: (data: string) => boolean
}

// Capture Handle (Chrome): this page names itself, so a share can tell whether the visitor picked this very tab.
type HandleConfig = { handle: string; permittedOrigins: string[]; exposeOrigin?: boolean }
type WithHandle = MediaDevices & { setCaptureHandleConfig?: (config: HandleConfig) => void }
type TrackWithHandle = MediaStreamTrack & { getCaptureHandle?: () => { handle?: string } | null }
const HANDLE = `otto-${Math.random().toString(36).slice(2)}`

/** Where this page's private regions are now, in viewport CSS px: D-17's exclusions, Otto's panel included. */
function privateBoxes(doc: Document): Box[] {
  const elements = new Set<Element>(doc.querySelectorAll(PRIVATE_SELECTOR))
  doc.querySelectorAll('input, select, textarea').forEach(e => { if (isSensitiveField(e)) elements.add(e) })
  return [...elements].map(e => e.getBoundingClientRect())
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => { const url = String(reader.result); resolve(url.slice(url.indexOf(',') + 1)) }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export function useScreenShare({ open, sendCapture, sendFrame }: Options) {
  const [phase, setPhase] = useState<ScreenSharePhase>('off')
  /** The shared surface is this tab, so its private regions are painted over. False: Otto sees everything in it. */
  const [ownTab, setOwnTab] = useState(false)
  /** Why the last share stopped, for the panel to say; null before any share. */
  const [stopped, setStopped] = useState<CaptureStopReason | null>(null)
  /** The picker was refused or failed, so nothing was shared. */
  const [declined, setDeclined] = useState(false)
  const stopRef = useRef<((reason: CaptureStopReason) => void) | null>(null)
  const sendRef = useRef({ sendCapture, sendFrame })
  sendRef.current = { sendCapture, sendFrame }
  const openRef = useRef(open)
  openRef.current = open

  const ask = useCallback(() => { if (openRef.current) { setStopped(null); setDeclined(false); setPhase('notice') } }, [])
  const cancel = useCallback(() => setPhase(p => (p === 'notice' ? 'off' : p)), [])
  const stop = useCallback(() => stopRef.current?.('stop'), [])

  /** Called from the notice's Share button, so the browser picker opens inside a user gesture. */
  const share = useCallback(async () => {
    if (!openRef.current || stopRef.current) return
    setPhase('starting')
    const devices = navigator.mediaDevices as WithHandle | undefined
    let stream: MediaStream
    try {
      devices?.setCaptureHandleConfig?.({ handle: HANDLE, permittedOrigins: [location.origin] })
      if (!devices?.getDisplayMedia) throw new Error('unsupported')
      // preferCurrentTab and selfBrowserSurface are Chrome hints; other browsers ignore them and show their picker.
      stream = await devices.getDisplayMedia({ video: true, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' } as DisplayMediaStreamOptions)
    } catch {
      setDeclined(true)
      setPhase('off')
      return
    }
    const track = stream.getVideoTracks()[0]
    if (!track || !openRef.current) {
      stream.getTracks().forEach(t => t.stop())
      setPhase('off')
      return
    }
    const own = (track as TrackWithHandle).getCaptureHandle?.()?.handle === HANDLE
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    void video.play().catch(() => {})
    const canvas = document.createElement('canvas')
    let encoding = false
    let timer = 0

    const end = (reason: CaptureStopReason) => {
      if (stopRef.current !== end) return
      stopRef.current = null
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      track.removeEventListener('ended', onEnded)
      stream.getTracks().forEach(t => t.stop())
      video.srcObject = null
      canvas.width = canvas.height = 0
      sendRef.current.sendCapture(null)
      setPhase('off')
      setStopped(reason)
    }
    const check = () => {
      const reason = captureStop({ open: openRef.current, visible: document.visibilityState === 'visible', trackLive: track.readyState === 'live' })
      if (reason) end(reason)
      return reason === null
    }
    const onVisibility = () => { check() }
    const onEnded = () => end('track_ended')

    const tick = () => {
      if (!check() || encoding) return
      const size = frameSize(video.videoWidth, video.videoHeight)
      const ctx = size && canvas.getContext('2d')
      if (!size || !ctx) return
      if (own && !(window.innerWidth > 0 && window.innerHeight > 0)) return // can't place the masks: send nothing rather than an unmasked frame
      // shortcut: masks use the layout at encode time, so a scroll during the last frame can shift them a few px; upgrade with Region Capture if that shows.
      const masks = own ? maskBoxes(privateBoxes(document), { width: window.innerWidth, height: window.innerHeight }, size) : []
      canvas.width = size.width
      canvas.height = size.height
      ctx.drawImage(video, 0, 0, size.width, size.height)
      ctx.fillStyle = '#000'
      for (const m of masks) ctx.fillRect(m.x, m.y, m.width, m.height)
      encoding = true
      canvas.toBlob(blob => {
        encoding = false
        if (!blob || stopRef.current !== end) return
        void toBase64(blob).then(data => { if (stopRef.current === end) sendRef.current.sendFrame(data) }, () => {})
      }, 'image/jpeg', 0.7)
    }

    stopRef.current = end
    document.addEventListener('visibilitychange', onVisibility)
    track.addEventListener('ended', onEnded)
    timer = window.setInterval(tick, FRAME_INTERVAL_MS)
    sendRef.current.sendCapture('screen')
    setOwnTab(own)
    setPhase('on')
  }, [])

  // The conversation ended: the share ends with it, and an unanswered notice goes away.
  useEffect(() => {
    if (open) return
    stopRef.current?.('ended')
    setPhase(p => (p === 'notice' ? 'off' : p))
  }, [open])

  // Unmount: nothing keeps running (tracks, timer, listeners).
  useEffect(() => () => stopRef.current?.('stop'), [])

  return { phase, ownTab, stopped, declined, ask, cancel, share, stop }
}
