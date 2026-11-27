// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGestureControl } from './useGestureControl'

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  detectForVideo: vi.fn(() => ({ landmarks: [] })),
  createFromOptions: vi.fn(),
  forVisionTasks: vi.fn(async () => ({})),
}))

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: mocks.forVisionTasks },
  HandLandmarker: { createFromOptions: mocks.createFromOptions },
}))

let root: Root | null = null
let host: HTMLDivElement | null = null
let controller: ReturnType<typeof useGestureControl> | null = null
let track: MediaStreamTrack & { stop: ReturnType<typeof vi.fn> }
let raf: ReturnType<typeof vi.fn>
let cancelRaf: ReturnType<typeof vi.fn>

function Harness() {
  controller = useGestureControl({ onSwipe: vi.fn() })
  return createElement('video', { ref: controller.videoRef, autoPlay: true, muted: true, playsInline: true })
}

async function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root?.render(createElement(Harness)) })
}

function installCamera() {
  const listeners = new Map<string, EventListener>()
  track = {
    stop: vi.fn(),
    addEventListener: vi.fn((type: string, listener: EventListener) => listeners.set(type, listener)),
    removeEventListener: vi.fn((type: string) => listeners.delete(type)),
    readyState: 'live',
  } as unknown as MediaStreamTrack & { stop: ReturnType<typeof vi.fn> }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(async () => stream) } })
  return { listeners, stream }
}

beforeEach(() => {
  controller = null
  mocks.close.mockReset()
  mocks.detectForVideo.mockReset().mockReturnValue({ landmarks: [] })
  mocks.createFromOptions.mockReset().mockImplementation(async () => ({ close: mocks.close, detectForVideo: mocks.detectForVideo }))
  mocks.forVisionTasks.mockReset().mockResolvedValue({})
  raf = vi.fn(() => 41)
  cancelRaf = vi.fn()
  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', cancelRaf)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})

afterEach(async () => {
  if (root) await act(async () => root?.unmount())
  root = null
  host?.remove()
  host = null
  controller = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  Reflect.deleteProperty(navigator, 'mediaDevices')
})

describe('useGestureControl camera lifecycle', () => {
  it('starts only on request and releases the camera, frame loop and landmarker on Stop', async () => {
    const { stream } = installCamera()
    await mount()
    expect(controller?.phase).toBe('off')
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled()

    await act(async () => { await controller?.start() })
    expect(controller?.phase).toBe('on')
    expect(controller?.videoRef.current?.srcObject).toBe(stream)
    expect(raf).toHaveBeenCalledTimes(1)

    await act(async () => { controller?.stop() })
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(mocks.close).toHaveBeenCalledTimes(1)
    expect(cancelRaf).toHaveBeenCalledWith(41)
    expect(controller?.videoRef.current?.srcObject).toBeNull()
    expect(controller?.phase).toBe('off')
  })

  it('releases camera resources when its panel unmounts', async () => {
    installCamera()
    await mount()
    await act(async () => { await controller?.start() })
    await act(async () => { root?.unmount() })
    root = null
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(mocks.close).toHaveBeenCalledTimes(1)
    expect(cancelRaf).toHaveBeenCalledWith(41)
  })

  it('stops when the browser ends the camera track', async () => {
    const { listeners } = installCamera()
    await mount()
    await act(async () => { await controller?.start() })
    await act(async () => { listeners.get('ended')?.(new Event('ended')) })
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(mocks.close).toHaveBeenCalledTimes(1)
    expect(controller?.phase).toBe('off')
  })
})