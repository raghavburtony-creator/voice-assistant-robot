import { describe, expect, it, vi } from 'vitest'
import { executeDesktopAction, getDesktopContext, getDesktopStatus, isDesktopRuntime, onDesktopError, onDesktopMovement, onDesktopReady } from './desktop'
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
  it('accepts only the permissioned desktop action allow-list', () => {
    expect(toAssistantAction({ action: 'desktop_action', desktop_action: 'move_top' })).toEqual({
      action: 'desktop_action', desktop_action: 'move_top',
    })
    expect(toAssistantAction({ action: 'desktop_action', desktop_action: 'run_shell' })).toBeNull()
    expect(toAssistantAction({ action: 'desktop_action', desktop_action: 12 })).toBeNull()
  })

  it('sends only an allow-listed action to the native gateway', async () => {
    const invoke = vi.fn().mockResolvedValue({
      action: 'launch_calculator', ok: true, status: 'started',
      verification: 'process_spawned', message: 'Calculator was launched.',
    })
    window.__TAURI__ = { core: { invoke }, event: { listen: vi.fn() } } as never
    await expect(executeDesktopAction('launch_calculator')).resolves.toMatchObject({
      ok: true, status: 'started', verification: 'process_spawned',
    })
    expect(invoke).toHaveBeenCalledWith('desktop_action', { action: 'launch_calculator' })
    delete window.__TAURI__
  })

  it('does not execute desktop actions in browser mode', async () => {
    delete window.__TAURI__
    await expect(executeDesktopAction('launch_calculator')).resolves.toMatchObject({
      ok: false, status: 'failed', verification: 'unavailable',
    })
  })
})


describe('desktop awareness bridge', () => {
  it('does not expose desktop metadata in browser mode', async () => {
    delete window.__TAURI__
    await expect(getDesktopContext()).resolves.toBeNull()
  })

  it('requests desktop metadata from the native host', async () => {
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
