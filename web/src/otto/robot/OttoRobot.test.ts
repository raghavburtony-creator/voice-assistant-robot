import { afterEach, describe, expect, it, vi } from 'vitest'
import { spokenLength } from './OttoRobot'

const TEXT = 'Hello there, I am Otto. Ask me anything.' // 40 characters

describe('speech bubble timing', () => {
  it('shows the share of the text that matches the share of audio played', () => {
    expect(spokenLength(TEXT, { played: 1, received: 2 }, 0)).toBe(20)
    expect(spokenLength(TEXT, { played: 2, received: 2 }, 0)).toBe(40)
  })

  it('never shows more than the audio could have said, when the transcript runs ahead of its audio', () => {
    // All the text, but only 0.5 s of 0.6 s received has played: 0.5 s at most 24 characters a second.
    expect(spokenLength(TEXT, { played: 0.5, received: 0.6 }, 0)).toBe(12)
  })

  it('never goes backwards, and holds still with no audio yet (or after it was cut off)', () => {
    expect(spokenLength(TEXT, { played: 0.1, received: 2 }, 30)).toBe(30)
    expect(spokenLength(TEXT, null, 12)).toBe(12)
  })
})

// hasWebGL caches its answer, so each case loads a fresh copy of environment.ts. The test runs in Node: no document.
describe('hasWebGL', () => {
  const load = async () => { vi.resetModules(); return (await import('./environment')).hasWebGL }
  const stubCanvas = (getContext: (id: string) => unknown) => {
    const createElement = vi.fn(() => ({ getContext }))
    vi.stubGlobal('document', { createElement })
    return createElement
  }
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

  it('is false without WebGL 2 (getContext gives null), and asks for webgl2', async () => {
    const asked: string[] = []
    stubCanvas(id => { asked.push(id); return null })
    expect((await load())()).toBe(false)
    expect(asked).toEqual(['webgl2'])
  })

  it('is false, without throwing, when the probe throws', async () => {
    stubCanvas(() => { throw new Error('blocked') })
    expect((await load())()).toBe(false)
  })

  it('is true with WebGL 2, releases the probe context at once, and asks only once per page', async () => {
    const loseContext = vi.fn()
    const createElement = stubCanvas(() => ({ getExtension: (n: string) => (n === 'WEBGL_lose_context' ? { loseContext } : null) }))
    const hasWebGL = await load()
    expect(hasWebGL()).toBe(true)
    expect(hasWebGL()).toBe(true)
    expect(createElement).toHaveBeenCalledTimes(1)
    expect(loseContext).toHaveBeenCalledTimes(1)
  })

  it('a context without the lose-context extension is still fine', async () => {
    stubCanvas(() => ({ getExtension: () => null }))
    expect((await load())()).toBe(true)
  })

  it('OttoRobot without WebGL renders its frame and bubble slot, draws no scene, and does not throw', async () => {
    stubCanvas(() => null)
    vi.resetModules()
    const { renderToString } = await import('react-dom/server')
    const { createElement } = await import('react')
    const { default: OttoRobot } = await import('./OttoRobot')
    const onError = vi.fn()
    let html = ''
    expect(() => { html = renderToString(createElement(OttoRobot, { pose: 'idle', expression: 'neutral', onError } as never)) }).not.toThrow()
    expect(html).toContain('otto-robot')
    expect(html).toContain('aria-hidden="true"')
    expect(html).not.toContain('<canvas')
  })
})

describe('reduced motion does not silence the mouth', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

  // Gap: ClayScene applies reduced motion inside its WebGL frame loop (it zeroes `look` and `squash`, and leaves
  // `mouth` bars alone); that is not reachable without a browser. What is reachable: the mouth source takes no
  // reduced-motion input at all, so it yields bars whatever the preference says.
  it('the lab voice source still yields non-zero bars with prefers-reduced-motion on', async () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    const { reducedMotion } = await import('./environment')
    expect(reducedMotion()).toBe(true)
    vi.useFakeTimers({ toFake: ['performance'] })
    const { fakeMouth } = await import('../mouth')
    const source = fakeMouth()
    let peak = 0
    for (let i = 0; i < 180; i++) {
      vi.advanceTimersByTime(1000 / 60)
      peak = Math.max(peak, ...Array.from(source()!))
    }
    expect(peak).toBeGreaterThan(0.3)
  })
})
