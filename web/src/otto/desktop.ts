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

export const DESKTOP_ACTIONS = [
  'minimize_otto', 'restore_otto',
  'move_home', 'move_left', 'move_right', 'move_top', 'move_bottom',
  'launch_calculator', 'launch_text_editor',
] as const
export type DesktopAction = typeof DESKTOP_ACTIONS[number]

export type DesktopActionResult = {
  action: DesktopAction
  ok: boolean
  status: 'completed' | 'started' | 'failed'
  verification: 'verified' | 'native_api_completed' | 'process_spawned' | 'not_verified' | 'unavailable'
  message: string
}

export type DesktopMovementResult = {
  ok: boolean
  destination: DesktopDestination
  error?: string
}

export type DesktopMovementEvent = {
  status: 'started' | 'completed' | 'failed'
  destination: DesktopDestination
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
    return { ok: false, destination, error: 'Unsupported desktop destination.' }
  }
  const runtime = host()
  if (!runtime) {
    return { ok: false, destination, error: 'Desktop movement is only available in the Otto desktop app.' }
  }
  try {
    return await runtime.core.invoke<DesktopMovementResult>('move_desktop_window', { destination })
  } catch (error) {
    return {
      ok: false,
      destination,
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


export type DesktopContext = {
  platform: string
  monitor: { x: number; y: number; width: number; height: number }
  otto: { x: number | null; y: number | null; width: number; height: number; visible: boolean }
  cursor: { x: number; y: number }
  activeWindow: { application: string; title: string } | null
}

/** Execute one allow-listed action through the native permission gateway. */
export async function executeDesktopAction(action: DesktopAction): Promise<DesktopActionResult> {
  if (!(DESKTOP_ACTIONS as readonly string[]).includes(action)) {
    return { action, ok: false, status: 'failed', verification: 'unavailable', message: 'Unsupported desktop action.' }
  }
  const runtime = host()
  if (!runtime) {
    return { action, ok: false, status: 'failed', verification: 'unavailable', message: 'Desktop actions are only available in the Otto desktop app.' }
  }
  try {
    return await runtime.core.invoke<DesktopActionResult>('desktop_action', { action })
  } catch (error) {
    return {
      action, ok: false, status: 'failed', verification: 'unavailable',
      message: error instanceof Error ? error.message : 'The desktop host could not execute the action.',
    }
  }
}

/** Read metadata from the native host. Call only while the visitor's desktop-awareness switch is on. */
export async function getDesktopContext(): Promise<DesktopContext | null> {
  const runtime = host()
  if (!runtime) return null
  return runtime.core.invoke<DesktopContext>('desktop_context')
}
