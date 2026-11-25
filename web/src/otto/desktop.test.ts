import { describe, expect, it, vi } from 'vitest'
import { getDesktopStatus, isDesktopRuntime, moveDesktopTo, onDesktopError, onDesktopMovement, onDesktopReady } from './desktop'
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

describe('desktop movement bridge', () => {
  it('validates and sends only a named destination to the native command', async () => {
    const invoke = vi.fn().mockResolvedValue({
      ok: true, destination: 'desktop-left', monitor: 'Display 1', x: 20, y: 40,
    })
    window.__TAURI__ = {
      core: { invoke },
      event: { listen: vi.fn().mockResolvedValue(() => undefined) },
    } as never

    await expect(moveDesktopTo('desktop-left')).resolves.toMatchObject({ ok: true, destination: 'desktop-left' })
    expect(invoke).toHaveBeenCalledWith('move_desktop_window', { destination: 'desktop-left' })

    delete window.__TAURI__
  })

  it('reports browser mode as unavailable instead of pretending movement succeeded', async () => {
    delete window.__TAURI__
    await expect(moveDesktopTo('home')).resolves.toMatchObject({ ok: false, destination: 'home' })
  })

  it('subscribes to structured native movement events', async () => {
    const listen = vi.fn().mockResolvedValue(() => undefined)
    window.__TAURI__ = { core: { invoke: vi.fn() }, event: { listen } } as never
    const unlisten = await onDesktopMovement(() => undefined)
    expect(listen).toHaveBeenCalledWith('otto://desktop-movement', expect.any(Function))
    expect(unlisten()).toBeUndefined()
    delete window.__TAURI__
  })

  it('accepts only the known movement action and destination', () => {
    expect(toAssistantAction({ action: 'desktop_move', destination: 'top' })).toEqual({
      action: 'desktop_move', destination: 'top',
    })
    expect(toAssistantAction({ action: 'desktop_move', destination: 'C:\\\\temp' })).toBeNull()
    expect(toAssistantAction({ action: 'desktop_move', destination: 12 })).toBeNull()
  })
})
