import { renderToString } from 'react-dom/server'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { OttoEventMap } from '../element/createOtto'
import { createHandle, EVENT_PROPS, listen, toAttributes } from './bridge'
import { OttoMascot } from './index'

describe('OttoMascot on the server', () => {
  it('renders a plain <otto-mascot> with its attributes and touches no browser global', () => {
    const g = globalThis as Record<string, unknown>
    expect([g.window, g.document, g.customElements]).toEqual([undefined, undefined, undefined])
    const html = renderToString(<OttoMascot theme="midnight" soundEnabled={false} hotkey={null} className="m" onReady={() => {}} config={{ name: 'X' }} />)
    expect(html).toMatch(/^<otto-mascot /)
    expect(html).toContain('theme="midnight"')
    expect(html).toContain('sound-enabled="false"')
    expect(html).toContain('hotkey="none"')
    expect(html).toContain('class="m"')
    expect(html).not.toContain('movement-enabled')
    expect(html).not.toContain('config')
  })
})

describe('toAttributes', () => {
  it('maps booleans to "true"/"false", hotkey null to "none", and leaves undefined out', () => {
    expect(toAttributes({})).toEqual({})
    expect(toAttributes({ soundEnabled: true, movementEnabled: false, hotkey: null, face: null, state: 'talking', placement: 'inline' }))
      .toEqual({ 'sound-enabled': 'true', 'movement-enabled': 'false', hotkey: 'none', state: 'talking', placement: 'inline' })
    expect(toAttributes({ hotkey: 'o', face: 'sad', theme: 'cyber' })).toEqual({ hotkey: 'o', face: 'sad', theme: 'cyber' })
  })
})

describe('events', () => {
  it('covers every OttoEventMap event', () => {
    expectTypeOf<(typeof EVENT_PROPS)[keyof typeof EVENT_PROPS]>().toEqualTypeOf<keyof OttoEventMap>()
    expect(new Set(Object.values(EVENT_PROPS)).size).toBe(10)
  })

  it('calls the latest callback with the detail, and stops after unsubscribe', () => {
    const target = new EventTarget()
    const first = vi.fn(), second = vi.fn()
    let callbacks = { onMove: first }
    const off = listen(target, () => callbacks)
    callbacks = { onMove: second }
    target.dispatchEvent(new CustomEvent('otto:move', { detail: { type: 'arrive', x: 0.5 } }))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith({ type: 'arrive', x: 0.5 })
    off()
    target.dispatchEvent(new CustomEvent('otto:move', { detail: { type: 'arrive', x: 0 } }))
    expect(second).toHaveBeenCalledTimes(1)
  })
})

describe('createHandle without an element', () => {
  it('returns the element fallbacks and never throws', async () => {
    for (const otto of [createHandle(() => null), createHandle(() => ({}) as HTMLElement)]) {
      expect(otto.playSound('chime' as never)).toBe(false)
      expect(await otto.moveToX(0.5)).toBe(false)
      expect(await otto.moveToElement('#x')).toBe(false)
      expect(await otto.goHome()).toBe(false)
      expect(await otto.speakText('hi')).toBe(false)
      expect(typeof otto.connectAudioNode({} as AudioNode)).toBe('function')
      const task = otto.task('t')
      expect(() => { task.succeed(); task.fail(); task.done() }).not.toThrow()
      expect(() => {
        otto.playGesture('welcomeWave'); otto.lookAt(null); otto.interrupt(); otto.setFace(null); otto.setState('idle')
        otto.notify({ type: 'success' } as never)
      }).not.toThrow()
    }
    expect(createHandle(() => null).element).toBeNull()
  })
})
