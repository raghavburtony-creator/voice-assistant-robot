import { useCallback, useEffect, useRef, useState } from 'react'
import type { HandLandmarker } from '@mediapipe/tasks-vision'
import { describeSingleHand, mirrorSwipeDirection, SwipeRecognizer, type SwipeDirection } from './gesture'

const MEDIAPIPE_VERSION = '1.2.3'
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@' + MEDIAPIPE_VERSION + '/wasm'
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task'

export type GestureControlPhase = 'off' | 'starting' | 'on' | 'error'

type Options = { onSwipe: (direction: SwipeDirection) => void }

/** Camera and MediaPipe lifecycle for D-31. Video and landmarks never leave this browser module. */
export function useGestureControl({ onSwipe }: Options) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const trackerRef = useRef<HandLandmarker | null>(null)
  const frameRef = useRef<number | null>(null)
  const generationRef = useRef(0)
  const lifecycleCleanupRef = useRef<(() => void) | null>(null)
  const recognizerRef = useRef(new SwipeRecognizer())
  const onSwipeRef = useRef(onSwipe)
  onSwipeRef.current = onSwipe

  const [phase, setPhase] = useState<GestureControlPhase>('off')
  const phaseRef = useRef<GestureControlPhase>('off')
  const [handStatus, setHandStatus] = useState('Camera is off.')
  const handStatusRef = useRef('Camera is off.')
  const [error, setError] = useState<string | null>(null)

  const updatePhase = (next: GestureControlPhase) => {
    phaseRef.current = next
    setPhase(next)
  }
  const updateHandStatus = (next: string) => {
    if (handStatusRef.current === next) return
    handStatusRef.current = next
    setHandStatus(next)
  }

  const drawHand = useCallback((video: HTMLVideoElement, landmarks: readonly { x: number; y: number }[]) => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
    }
    const width = canvas.width
    const height = canvas.height
    context.clearRect(0, 0, width, height)
    const connections = [
      [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
      [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
      [13, 17], [17, 18], [18, 19], [19, 20], [17, 0],
    ] as const
    context.lineWidth = Math.max(2, width * 0.004)
    context.lineCap = 'round'
    context.strokeStyle = '#76d7c4'
    for (const [start, end] of connections) {
      context.beginPath()
      context.moveTo(landmarks[start].x * width, landmarks[start].y * height)
      context.lineTo(landmarks[end].x * width, landmarks[end].y * height)
      context.stroke()
    }
    for (let index = 0; index < landmarks.length; index += 1) {
      context.beginPath()
      context.fillStyle = index === 8 ? '#f6c85f' : '#ffffff'
      const radius = index === 8 ? Math.max(7, width * 0.012) : Math.max(2, width * 0.0045)
      context.arc(landmarks[index].x * width, landmarks[index].y * height, radius, 0, Math.PI * 2)
      context.fill()
    }
  }, [])

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height)
  }, [])

  const releaseResources = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current)
      frameRef.current = null
    }
    lifecycleCleanupRef.current?.()
    lifecycleCleanupRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    const video = videoRef.current
    if (video) { video.pause(); video.srcObject = null }
    try { trackerRef.current?.close() } catch { /* best-effort disposal after Stop */ }
    trackerRef.current = null
    recognizerRef.current.reset()
    clearCanvas()
  }, [clearCanvas])

  const stop = useCallback((message = 'Hand control stopped. Camera access has been released.') => {
    generationRef.current += 1
    releaseResources()
    updatePhase('off')
    setError(null)
    updateHandStatus(message)
  }, [releaseResources])

  const start = useCallback(async () => {
    if (phaseRef.current === 'starting' || phaseRef.current === 'on') return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      updatePhase('error')
      setError('This browser cannot provide camera access. Use a modern browser over HTTPS or localhost.')
      return
    }

    const generation = generationRef.current + 1
    generationRef.current = generation
    updatePhase('starting')
    setError(null)
    updateHandStatus('Requesting camera access. Video stays on this device.')

    try {
      // getUserMedia is called only from the Start button; there is no voice-session or microphone dependency.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'user' }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
        audio: false,
      })
      if (generationRef.current !== generation) { stream.getTracks().forEach(track => track.stop()); return }
      streamRef.current = stream

      const track = stream.getVideoTracks()[0]
      const onTrackEnded = () => {
        if (generationRef.current === generation) stop('Camera access ended. Press Start to begin a new session.')
      }
      const onVisibility = () => {
        if (document.visibilityState === 'hidden' && generationRef.current === generation) stop('Hand control stopped because this tab was hidden.')
      }
      track?.addEventListener('ended', onTrackEnded)
      document.addEventListener('visibilitychange', onVisibility)
      lifecycleCleanupRef.current = () => {
        track?.removeEventListener('ended', onTrackEnded)
        document.removeEventListener('visibilitychange', onVisibility)
      }

      const video = videoRef.current
      if (!video) throw new Error('preview unavailable')
      video.srcObject = stream
      await video.play()
      if (generationRef.current !== generation) return

      const tasks = await import('@mediapipe/tasks-vision')
      const vision = await tasks.FilesetResolver.forVisionTasks(WASM_URL)
      if (generationRef.current !== generation) return
      const tracker = await tasks.HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: MODEL_URL },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      })
      if (generationRef.current !== generation) { tracker.close(); return }
      trackerRef.current = tracker
      recognizerRef.current.reset()
      updatePhase('on')
      updateHandStatus('Show one hand. Hold an index-pointing pose steady, then swipe left or right.')

      let lastVideoTime = -1
      const render = (timestamp: number) => {
        if (generationRef.current !== generation || !trackerRef.current || !videoRef.current) return
        const currentVideo = videoRef.current
        if (currentVideo.readyState >= 2 && currentVideo.currentTime !== lastVideoTime) {
          lastVideoTime = currentVideo.currentTime
          try {
            const result = trackerRef.current.detectForVideo(currentVideo, timestamp)
            const hand = describeSingleHand(result.landmarks)
            if (!hand) {
              recognizerRef.current.update(null, timestamp)
              clearCanvas()
              updateHandStatus(result.landmarks.length > 1 ? 'Show one hand at a time. Multiple hands are ignored.' : 'No hand detected. Place one hand in view.')
            } else {
              drawHand(currentVideo, result.landmarks[0])
              if (!hand.pointing) {
                recognizerRef.current.update(null, timestamp)
                updateHandStatus('Point with your index finger. Fold the other fingers to navigate.')
              } else {
                const direction = recognizerRef.current.update(hand, timestamp)
                updateHandStatus(direction
                  ? 'Swipe recognised.'
                  : 'Index finger tracked. Hold still briefly, then swipe horizontally.')
                if (direction) onSwipeRef.current(mirrorSwipeDirection(direction))
              }
            }
          } catch {
            stop('Hand tracking stopped after a camera-processing error.')
            setError('Hand tracking could not process this camera frame. Press Start to try again.')
            updatePhase('error')
            return
          }
        }
        if (generationRef.current === generation) frameRef.current = requestAnimationFrame(render)
      }
      frameRef.current = requestAnimationFrame(render)
    } catch (cause) {
      if (generationRef.current !== generation) return
      releaseResources()
      updatePhase('error')
      const name = cause instanceof DOMException ? cause.name : ''
      setError(name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Camera permission was not granted. Allow camera access for this site and try again.'
        : name === 'NotFoundError'
          ? 'No camera was found on this device.'
          : 'Hand tracking could not start. Check your camera and internet connection, then try again.')
      updateHandStatus('Camera is off.')
    }
  }, [clearCanvas, drawHand, releaseResources, stop])

  useEffect(() => () => {
    generationRef.current += 1
    releaseResources()
  }, [releaseResources])

  return { videoRef, canvasRef, phase, handStatus, error, start, stop }
}