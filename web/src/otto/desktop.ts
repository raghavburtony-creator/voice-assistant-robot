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

export type DesktopConsentCertificate = {
  certificateId: string
  requestId: string
  action: DesktopAction
  decision: 'approved' | 'denied'
  method: 'native_os_dialog'
  issuedAtUnixMs: number
}

export type DesktopActionResult = {
  action: DesktopAction
  ok: boolean
  status: 'completed' | 'started' | 'failed' | 'denied'
  verification: 'verified' | 'native_api_completed' | 'process_spawned' | 'not_verified' | 'unavailable'
  message: string
  consentCertificate?: DesktopConsentCertificate | null
}

export type DesktopConsentCertificateReport = {
  certificate_id: string
  request_id: string
  action: DesktopAction
  decision: 'approved' | 'denied'
  method: 'native_os_dialog'
  issued_at_unix_ms: number
}

export type DesktopActionReport = {
  request_id: string
  action: DesktopAction
  consent_certificate: DesktopConsentCertificateReport | null
  result: Pick<DesktopActionResult, 'ok' | 'status' | 'verification'>
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

// Desktop awareness is an explicit, session-only permission. It deliberately lives in
// memory rather than storage so a reload/restart cannot silently re-enable desktop access.
let desktopPermissionEnabled = false

export function isDesktopPermissionEnabled(): boolean {
  return desktopPermissionEnabled
}

export function setDesktopPermissionEnabled(enabled: boolean): void {
  desktopPermissionEnabled = enabled
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

/** Verify a completed movement against a fresh, read-only native observation. */
export function verifyDesktopMovement(action: DesktopAction, context: DesktopContext): boolean {
  const destinations: Partial<Record<DesktopAction, DesktopDestination>> = {
    move_home: 'home',
    move_left: 'desktop-left',
    move_right: 'desktop-right',
    move_top: 'top',
    move_bottom: 'bottom',
  }
  const destination = destinations[action]
  if (!destination || context.otto.x === null || context.otto.y === null) return false

  const margin = 20
  const left = context.monitor.x
  const top = context.monitor.y
  const minX = left + margin
  const minY = top + margin
  const maxX = Math.max(minX, left + context.monitor.width - context.otto.width - margin)
  const maxY = Math.max(minY, top + context.monitor.height - context.otto.height - margin)
  const centreX = left + Math.max(0, context.monitor.width) / 2 - context.otto.width / 2
  const centreY = top + Math.max(0, context.monitor.height) / 2 - context.otto.height / 2
  const expectedByDestination: Record<DesktopDestination, [number, number]> = {
    home: [centreX, centreY],
    'desktop-left': [minX, centreY],
    'desktop-right': [maxX, centreY],
    top: [centreX, minY],
    bottom: [centreX, maxY],
  }
  const expected = expectedByDestination[destination]
  const targetX = Math.min(maxX, Math.max(minX, expected[0]))
  const targetY = Math.min(maxY, Math.max(minY, expected[1]))
  return Math.abs(context.otto.x - targetX) <= 5 && Math.abs(context.otto.y - targetY) <= 5
}

/** Execute one allow-listed action through the native permission gateway. */
export async function executeDesktopAction(action: DesktopAction, requestId: string): Promise<DesktopActionResult> {
  if (!(DESKTOP_ACTIONS as readonly string[]).includes(action) || !/^[0-9a-f]{32}$/.test(requestId)) {
    return { action, ok: false, status: 'failed', verification: 'unavailable', message: 'Unsupported desktop action.' }
  }
  if (!desktopPermissionEnabled) {
    return {
      action, ok: false, status: 'denied', verification: 'unavailable',
      message: 'Desktop access is disabled. Enable Desktop awareness in the voice panel before using desktop actions.',
    }
  }
  const runtime = host()
  if (!runtime) {
    return { action, ok: false, status: 'failed', verification: 'unavailable', message: 'Desktop actions are only available in the Otto desktop app.' }
  }
  let consentCertificate: DesktopConsentCertificate | null = null
  try {
    const isMovement = action === 'move_home' || action === 'move_left' || action === 'move_right' || action === 'move_top' || action === 'move_bottom'
    // Observe the current desktop before asking the native gateway to act. If the host
    // cannot provide a baseline, fail closed rather than executing an unverifiable move.
    if (isMovement) {
      await runtime.core.invoke<DesktopContext>('desktop_context')
      // Desktop awareness can be revoked while the native observation is in flight.
      // Recheck immediately before opening the OS approval prompt.
      if (!desktopPermissionEnabled) {
        return {
          action, ok: false, status: 'failed', verification: 'unavailable',
          message: 'Desktop awareness was turned off before the native approval prompt opened. No action was executed.',
        }
      }
    }
    const result = await runtime.core.invoke<DesktopActionResult>('desktop_action', { action, requestId })
    consentCertificate = result.consentCertificate ?? null
    if (!result.ok || result.status !== 'completed' || result.verification !== 'native_api_completed') return result

    // Native API completion is not proof that the window reached its requested position.
    // Take a fresh observation and only report success when the observed geometry agrees.
    const context = await runtime.core.invoke<DesktopContext>('desktop_context')
    if (!verifyDesktopMovement(action, context)) {
      return {
        ...result,
        ok: false,
        status: 'failed',
        verification: 'not_verified',
        message: "The native move finished, but Otto's observed position did not match the requested destination.",
      }
    }
    return { ...result, verification: 'verified', message: `${result.message} The final position was verified.` }
  } catch (error) {
    return {
      action, ok: false, status: 'failed', verification: 'unavailable',
      message: error instanceof Error ? error.message : 'The desktop host could not execute the action.',
      consentCertificate,
    }
  }
}

/** Read metadata from the native host only while the session's desktop permission is enabled. */
export async function getDesktopContext(): Promise<DesktopContext | null> {
  if (!desktopPermissionEnabled) return null
  const runtime = host()
  if (!runtime) return null
  return runtime.core.invoke<DesktopContext>('desktop_context')
}
