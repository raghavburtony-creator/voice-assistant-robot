import { describe, expect, it } from 'vitest'
import { getDesktopStatus, isDesktopRuntime, onDesktopError, onDesktopReady } from './desktop'

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
