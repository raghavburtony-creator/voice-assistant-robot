/**
 * Narrow bridge between the web UI and the Tauri host.
 *
 * Browser mode remains the default: every helper safely reports that the desktop
 * runtime is absent. Native movement accepts named destinations only; coordinates
 * and monitor geometry stay inside the Tauri host.
 */

export type DesktopStatus = {
  runtime: 'tauri'
  platform: string
  version: string
}

export const DESKTOP_DESTINATIONS = ['home', 'desktop-left', 'desktop-right', 'top', 'bottom'] as const
export type DesktopDestination = typeof DESKTOP_DESTINATIONS[number]

export type DesktopMovementResult = {
  ok: boolean
  destination: DesktopDestination
  monitor: string | null
  x?: number
  y?: number
  error?: string
}

export type DesktopMovementEvent = {
  status: 'started' | 'completed' | 'failed'
  destination: DesktopDestination
  monitor: string | null
  x: number | null
  y: number | null
  message: string | null
}

type DesktopEvent<T> = { payload: T }
type Unlisten = () => void

type TauriHost = {
  core: {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>
  }
  event: {
    listen<T>(event: string, handler: (event: DesktopEvent<T>) => void): Promise<Unlisten>
  }
}

declare global {
  interface Window {
    __TAURI__?: TauriHost
  }
}

function host(): TauriHost | null {
  return typeof window === 'undefined' ? null : window.__TAURI__ ?? null
}

export function isDesktopRuntime(): boolean {
  return host() !== null
}

/** Returns null in ordinary browser mode. */
export async function getDesktopStatus(): Promise<DesktopStatus | null> {
  const runtime = host()
  if (!runtime) return null
  return runtime.core.invoke<DesktopStatus>('desktop_status')
}

/** Ask the native host to move Otto to an allow-listed named destination. */
export async function moveDesktopTo(destination: DesktopDestination): Promise<DesktopMovementResult> {
  if (!(DESKTOP_DESTINATIONS as readonly string[]).includes(destination)) {
    return { ok: false, destination, monitor: null, error: 'Unsupported desktop destination.' }
  }
  const runtime = host()
  if (!runtime) {
    return { ok: false, destination, monitor: null, error: 'Desktop movement is only available in the Otto desktop app.' }
  }
  try {
    return await runtime.core.invoke<DesktopMovementResult>('move_desktop_window', { destination })
  } catch (error) {
    return {
      ok: false,
      destination,
      monitor: null,
      error: error instanceof Error ? error.message : 'The desktop host could not move Otto.',
    }
  }
}

/** Subscribe to native movement lifecycle events. */
export async function onDesktopMovement(handler: (event: DesktopMovementEvent) => void): Promise<Unlisten> {
  const runtime = host()
  if (!runtime) return () => undefined
  return runtime.event.listen<DesktopMovementEvent>('otto://desktop-movement', event => handler(event.payload))
}

/** Subscribe to the native host's startup lifecycle event. */
export async function onDesktopReady(handler: (status: DesktopStatus) => void): Promise<Unlisten> {
  const runtime = host()
  if (!runtime) return () => undefined
  // The native startup event may have fired before the webview module loaded.
  // Subscribe first, then query the host so callers never miss the initial state.
  const unlisten = await runtime.event.listen<DesktopStatus>('otto://desktop-ready', event => handler(event.payload))
  const status = await runtime.core.invoke<DesktopStatus>('desktop_status')
  handler(status)
  return unlisten
}

/** Subscribe to host-reported errors without treating them as successful actions. */
export async function onDesktopError(handler: (message: string) => void): Promise<Unlisten> {
  const runtime = host()
  if (!runtime) return () => undefined
  return runtime.event.listen<string>('otto://desktop-error', event => handler(event.payload))
}
