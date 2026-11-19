import { describe, expect, it } from 'vitest'
import { DEFAULT_OTTO_CONFIG, deepMerge, defineOttoConfig, THEMES } from './config'

describe('defineOttoConfig', () => {
  it('fills everything from the defaults', () => {
    expect(defineOttoConfig()).toEqual(DEFAULT_OTTO_CONFIG)
  })

  it('layers a theme, then the overrides, merging deeply and leaving the rest', () => {
    const c = defineOttoConfig({ theme: 'midnight', colors: { eyes: '#ff0000' }, sound: { soundVolume: 0.1 } })
    expect(c.theme).toBe('midnight')
    expect(c.colors).toEqual({ ...THEMES.midnight.colors, eyes: '#ff0000' })
    expect(c.sound.soundVolume).toBe(0.1)
    expect(c.sound.gestureCues).toEqual(DEFAULT_OTTO_CONFIG.sound.gestureCues)
    expect(c.idle.sleepTimeoutMs).toBe(180_000) // from the theme
    expect(c.idle.idleLookAroundMs).toBe(DEFAULT_OTTO_CONFIG.idle.idleLookAroundMs)
  })

  it('replaces arrays instead of merging them, and never changes its inputs', () => {
    const before = JSON.stringify(DEFAULT_OTTO_CONFIG)
    const c = defineOttoConfig({ movement: { avoid: ['.cookie'] }, gestures: { idle: [] } })
    expect(c.movement.avoid).toEqual(['.cookie'])
    expect(c.gestures.idle).toEqual([])
    expect(JSON.stringify(DEFAULT_OTTO_CONFIG)).toBe(before)
  })

  it('an unknown theme falls back to the default', () => {
    expect(defineOttoConfig({ theme: 'neon' as never }).theme).toBe('default')
  })

  it('deepMerge skips undefined', () => {
    expect(deepMerge({ a: 1, b: { c: 2 } }, { a: undefined, b: { c: 3 } })).toEqual({ a: 1, b: { c: 3 } })
  })
})
