// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSpotlight } from './spotlight'

const rings = () => document.querySelectorAll('[data-otto-spotlight]')
const box = (left: number, top: number, width = 100, height = 40) => {
  const el = document.createElement('button')
  el.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect
  document.body.appendChild(el)
  return el
}

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('spotlight', () => {
  it('rings the target in viewport px, decorative and out of the pointer\'s way', () => {
    const s = createSpotlight({ reducedMotion: () => false })
    s.show(box(200, 300))
    const [ring] = rings() as unknown as HTMLElement[]
    expect(ring.getAttribute('aria-hidden')).toBe('true')
    expect(ring.style.position).toBe('fixed')
    expect(ring.style.pointerEvents).toBe('none')
    expect([ring.style.left, ring.style.top, ring.style.width, ring.style.height]).toEqual(['194px', '294px', '112px', '52px'])
    expect(ring.style.opacity).toBe('1')
    expect(ring.style.transition).toContain('opacity')
    s.dispose()
  })

  it('reduced motion: it appears in place, no fade or glide', () => {
    const s = createSpotlight({ reducedMotion: () => true })
    s.show(box(0, 0))
    expect((rings()[0] as HTMLElement).style.transition).toBe('none')
    s.dispose()
  })

  it('Escape or a press dismisses it (and says so); a stale off() leaves a newer ring alone', () => {
    const onDismiss = vi.fn()
    const s = createSpotlight({ onDismiss })
    const a = box(0, 0), b = box(300, 0)
    const offA = s.show(a)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(s.target).toBeNull()
    expect(onDismiss).toHaveBeenCalledTimes(1)
    s.show(b)
    offA()
    expect(s.target).toBe(b)
    window.dispatchEvent(new Event('pointerdown'))
    expect(s.target).toBeNull()
    expect(onDismiss).toHaveBeenCalledTimes(2)
    s.dispose()
  })

  it('dispose() leaves nothing behind: no ring, no frame loop, no listeners', () => {
    const add = vi.spyOn(window, 'addEventListener')
    const remove = vi.spyOn(window, 'removeEventListener')
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame')
    const s = createSpotlight()
    s.show(box(0, 0))
    s.dispose()
    expect(rings()).toHaveLength(0)
    expect(cancel).toHaveBeenCalled()
    const added = add.mock.calls.map(c => c[0]).sort()
    const removed = remove.mock.calls.map(c => c[0]).sort()
    expect(removed).toEqual(added)
    s.show(box(0, 0)) // after dispose: nothing
    expect(rings()).toHaveLength(0)
  })

  it('a target with no box hides the ring instead of drawing it at 0,0', () => {
    const s = createSpotlight()
    s.show(box(0, 0, 0, 0))
    expect((rings()[0] as HTMLElement).style.opacity).toBe('0')
    s.dispose()
  })
})
