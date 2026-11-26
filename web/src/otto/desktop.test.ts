// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { executeDesktopAction, getDesktopContext, getDesktopStatus, isDesktopPermissionEnabled, isDesktopRuntime, onDesktopError, onDesktopMovement, onDesktopReady, setDesktopPermissionEnabled, verifyDesktopMovement } from './desktop'
import { toAssistantAction } from './messages'

describe('desktop bridge in browser mode', () => {
  it('does not mistake an ordinary browser for the native runtime', () => {
    expect(isDesktopRuntime()).toBe(false)
  })

  it('returns no native status when Tauri is unavailable', async () => {
    await expect(getDesktopStatus()).resolves.toBeNull()
  })

  it('makes lifecycle and error subscriptions safe no-ops in browser mode', async () => {
    const ready = await onDesktopReady(() => {
      throw new Error('browser mode must not emit desktop lifecycle events')
    })
    const error = await onDesktopError(() => {
      throw new Error('browser mode must not emit native errors')
    })

    expect(ready()).toBeUndefined()
    expect(error()).toBeUndefined()
  })
})

describe('desktop movement events', () => {
  it('subscribes to structured native movement events', async () => {
    const listen = vi.fn().mockResolvedValue(() => undefined)
    window.__TAURI__ = { core: { invoke: vi.fn() }, event: { listen } } as never
    const unlisten = await onDesktopMovement(() => undefined)
    expect(listen).toHaveBeenCalledWith('otto://desktop-movement', expect.any(Function))
    expect(unlisten()).toBeUndefined()
    delete window.__TAURI__
  })
})

describe('desktop action bridge', () => {
  beforeEach(() => setDesktopPermissionEnabled(true))
  afterEach(() => setDesktopPermissionEnabled(false))

  it('requires explicit desktop permission before invoking the native gateway', async () => {
    setDesktopPermissionEnabled(false)
    const invoke = vi.fn()
    window.__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } } as never

    await expect(executeDesktopAction('launch_calculator', 'a'.repeat(32))).resolves.toMatchObject({
      ok: false, status: 'denied', verification: 'unavailable',
    })
    expect(invoke).not.toHaveBeenCalled()
    delete window.__TAURI__
  })

  it('permission defaults to off and can be revoked for the rest of the session', () => {
    setDesktopPermissionEnabled(false)
    expect(isDesktopPermissionEnabled()).toBe(false)
    setDesktopPermissionEnabled(true)
    expect(isDesktopPermissionEnabled()).toBe(true)
    setDesktopPermissionEnabled(false)
    expect(isDesktopPermissionEnabled()).toBe(false)
  })
  it('accepts only the permissioned desktop action allow-list', () => {
    expect(toAssistantAction({ action: 'desktop_action', desktop_action: 'move_top', request_id: 'a'.repeat(32) })).toEqual({
      action: 'desktop_action', desktop_action: 'move_top', request_id: 'a'.repeat(32),
    })
    expect(toAssistantAction({ action: 'desktop_action', desktop_action: 'move_top' })).toBeNull()
    expect(toAssistantAction({ action: 'desktop_action', desktop_action: 'run_shell' })).toBeNull()
    expect(toAssistantAction({ action: 'desktop_action', desktop_action: 12 })).toBeNull()
  })

  it('sends only an allow-listed action to the native gateway', async () => {
    const invoke = vi.fn().mockResolvedValue({
      action: 'launch_calculator', ok: true, status: 'started',
      verification: 'process_spawned', message: 'Calculator was launched.',
      consentCertificate: {
        certificateId: 'a'.repeat(32) + '-123', requestId: 'a'.repeat(32),
        action: 'launch_calculator', decision: 'approved', method: 'native_os_dialog', issuedAtUnixMs: 123,
      },
    })
    window.__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } } as never
    await expect(executeDesktopAction('launch_calculator', 'a'.repeat(32))).resolves.toMatchObject({
      ok: true, status: 'started', verification: 'process_spawned',
      consentCertificate: { requestId: 'a'.repeat(32), decision: 'approved' },
    })
    expect(invoke).toHaveBeenCalledWith('desktop_action', { action: 'launch_calculator', requestId: 'a'.repeat(32) })
    delete window.__TAURI__
  })

  it('requires a fresh matching observation before reporting a native move as successful', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({
        platform: 'linux',
        monitor: { x: -1920, y: 0, width: 1920, height: 1080 },
        otto: { x: -1500, y: 220, width: 420, height: 640, visible: true },
        cursor: { x: -1500, y: 400 },
        activeWindow: null,
      })
      .mockResolvedValueOnce({
        action: 'move_left', ok: true, status: 'completed',
        verification: 'native_api_completed', message: 'Native movement completed.',
      })
      .mockResolvedValueOnce({
        platform: 'linux',
        monitor: { x: -1920, y: 0, width: 1920, height: 1080 },
        otto: { x: -1900, y: 220, width: 420, height: 640, visible: true },
        cursor: { x: -1500, y: 400 },
        activeWindow: null,
      })
    window.__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } } as never

    await expect(executeDesktopAction('move_left', 'd'.repeat(32))).resolves.toMatchObject({
      ok: true, status: 'completed', verification: 'verified',
    })
    expect(invoke).toHaveBeenNthCalledWith(1, 'desktop_context')
    expect(invoke).toHaveBeenNthCalledWith(2, 'desktop_action', { action: 'move_left' })
    expect(invoke).toHaveBeenNthCalledWith(3, 'desktop_context')
    delete window.__TAURI__
  })

  it('reports failure when native movement completes but observation disagrees', async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce({
        platform: 'linux',
        monitor: { x: -1920, y: 0, width: 1920, height: 1080 },
        otto: { x: -1500, y: 220, width: 420, height: 640, visible: true },
        cursor: { x: -1500, y: 400 },
        activeWindow: null,
      })
      .mockResolvedValueOnce({
        action: 'move_left', ok: true, status: 'completed',
        verification: 'native_api_completed', message: 'Native movement completed.',
      })
      .mockResolvedValueOnce({
        platform: 'linux',
        monitor: { x: -1920, y: 0, width: 1920, height: 1080 },
        otto: { x: -1200, y: 220, width: 420, height: 640, visible: true },
        cursor: { x: -1500, y: 400 },
        activeWindow: null,
      })
    window.__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } } as never

    await expect(executeDesktopAction('move_left', 'd'.repeat(32))).resolves.toMatchObject({
      ok: false, status: 'failed', verification: 'not_verified',
    })
    delete window.__TAURI__
  })

  it('does not execute desktop actions in browser mode', async () => {
    delete window.__TAURI__
    await expect(executeDesktopAction('launch_calculator', 'e'.repeat(32))).resolves.toMatchObject({
      ok: false, status: 'failed', verification: 'unavailable',
    })
  })
})


describe('desktop awareness bridge', () => {
  it('does not expose desktop metadata in browser mode', async () => {
    delete window.__TAURI__
    await expect(getDesktopContext()).resolves.toBeNull()
  })

  it('refuses desktop metadata when permission is disabled', async () => {
    const invoke = vi.fn()
    window.__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } } as never
    await expect(getDesktopContext()).resolves.toBeNull()
    expect(invoke).not.toHaveBeenCalled()
    delete window.__TAURI__
  })

  it('requests desktop metadata from the native host when permission is enabled', async () => {
    setDesktopPermissionEnabled(true)
    const invoke = vi.fn().mockResolvedValue({
      platform: 'windows',
      monitor: { x: -1920, y: 0, width: 1920, height: 1080 },
      otto: { x: -1800, y: 100, width: 420, height: 640, visible: true },
      cursor: { x: -1500, y: 400 },
      activeWindow: { application: 'browser.exe', title: 'Example page' },
    })
    window.__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } } as never
    await expect(getDesktopContext()).resolves.toMatchObject({ platform: 'windows', activeWindow: { application: 'browser.exe' } })
    expect(invoke).toHaveBeenCalledWith('desktop_context')
    delete window.__TAURI__
  })
})

describe('desktop movement verification', () => {
  const context = {
    platform: 'linux',
    monitor: { x: -1920, y: 0, width: 1920, height: 1080 },
    otto: { x: -1900, y: 220, width: 420, height: 640, visible: true },
    cursor: { x: -1500, y: 400 },
    activeWindow: null,
  }

  it('verifies a movement from a fresh observation, including negative monitor origins', () => {
    expect(verifyDesktopMovement('move_left', context)).toBe(true)
  })

  it('rejects a native completion when the observed position is wrong', () => {
    expect(verifyDesktopMovement('move_right', context)).toBe(false)
  })

  it('does not verify an observation without a usable window position', () => {
    expect(verifyDesktopMovement('move_home', {
      ...context,
      otto: { ...context.otto, x: null, y: null },
    })).toBe(false)
  })
})

