/**
 * Narrow bridge between the web UI and the Tauri host.
 *
 * Browser mode remains the default: every helper safely reports that the desktop
 * runtime is absent. The bridge exposes lifecycle information and a read-only
 * status command only; desktop actions belong behind the permissioned gateway.
 */

export type DesktopStatus = {
  runtime: 'tauri'
  platform: string
  version: string
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
