import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOttoGuide, MISSING_SAY, type GuideEvent, type GuideSettings } from './guide'
import { attachGuide, type GuideRunnerDeps } from './runner'
import { findGuideTarget, listGuideTargets, onGuideTargetsChange, registerGuideTarget } from './targets'

const SETTINGS: GuideSettings = { cooldownMs: 20_000, offerFirst: false, approachMinDistance: 0.25, lookSeconds: 2.5, helpAfterFailures: 2, helpWindowMs: 60_000, proactiveHelpEnabled: false, frictionCooldownMs: 60_000, stallMs: 20_000 }

type FakeEl = Element & { attrs: Map<string, string> }
const el = (left: number, attrs: Record<string, string> = {}, text = ''): FakeEl => {
  const map = new Map(Object.entries(attrs))
  return {
    attrs: map, isConnected: true, textContent: text,
    getAttribute: (k: string) => map.get(k) ?? null,
    setAttribute: (k: string, v: string) => { map.set(k, v) },
    removeAttribute: (k: string) => { map.delete(k) },
    getBoundingClientRect: () => ({ left, right: left + 40, top: 100, bottom: 140 }),
    scrollIntoView: vi.fn(),
  } as unknown as FakeEl
}

const tick = () => new Promise(r => setTimeout(r, 0))

function setup(targets: Record<string, Element>, over: Partial<GuideRunnerDeps> = {}) {
  const guide = createOttoGuide()
  const calls: string[] = []
  const events: GuideEvent[] = []
  guide.onEvent(e => events.push(e))
  let clock = 0
  const deps: GuideRunnerDeps = {
    stage: {
      moveToElement: vi.fn(async () => { calls.push('move') }),
      lookAt: vi.fn((e: Element | null) => { calls.push(e ? 'look' : 'look:null') }),
      stop: vi.fn(() => { calls.push('stop') }),
      goHome: vi.fn(async () => { calls.push('home') }),
    },
    playGesture: n => { calls.push(`gesture:${n}`) },
    setFace: f => { calls.push(`face:${f}`) },
    speak: t => { calls.push(`say:${t}`) },
    settings: () => SETTINGS,
    situation: () => ({ idle: 'awake', conversing: false, movementEnabled: true }),
    ottoRect: () => ({ left: 0, right: 100, top: 600, bottom: 700 }),
    find: id => (targets[id] ? { element: targets[id], info: { id, label: id } } : null),
    now: () => clock,
    viewport: () => ({ width: 1000, height: 800 }),
    reducedMotion: () => true,
    ...over,
  }
  const detach = attachGuide(guide, deps)
  return { guide, deps, calls, events, detach, advance: (ms: number) => { clock += ms } }
}

describe('attachGuide', () => {
  it('runs a plan in order: face, move, look, gesture, say', async () => {
    const save = el(800)
    const { guide, calls, events } = setup({ save })
    guide.show({ target: 'save', reason: 'asked', say: 'Press here.' })
    await tick()
    expect(calls).toEqual(['face:happy', 'move', 'look', 'gesture:pointRight', 'say:Press here.', 'face:null'])
    expect(events).toEqual([{ type: 'shown', target: 'save', size: 'approach' }])
  })

  it('marks the target while guiding', async () => {
    const save = el(800)
    let release!: () => void
    const { guide } = setup({ save }, { stage: { moveToElement: () => new Promise<void>(r => { release = r }), lookAt: () => {} } })
    guide.show({ target: 'save', reason: 'asked' })
    expect(save.attrs.has('data-otto-guiding')).toBe(true)
    release()
    await tick()
    expect(save.attrs.has('data-otto-guiding')).toBe(false)
  })

  it('a second show cancels the first between steps and restores the face', async () => {
    const a = el(800), b = el(10)
    const looked: Element[] = []
    let release!: () => void
    const faces: (string | null)[] = []
    const { guide } = setup({ a, b }, {
      stage: { moveToElement: e => (e === a ? new Promise<void>(r => { release = r }) : Promise.resolve()), lookAt: e => { if (e) looked.push(e) } },
      setFace: f => faces.push(f),
    })
    guide.show({ target: 'a', reason: 'asked' })
    guide.show({ target: 'b', reason: 'asked', mode: 'point' })
    expect(a.attrs.has('data-otto-guiding')).toBe(false)
    release()
    await tick()
    expect(looked).toEqual([b])
    expect(faces).toEqual(['happy', null, 'happy', null])
  })

  it('cancelling a run mid-walk stops the walk; a run past its walk does not', async () => {
    const a = el(800), b = el(10)
    let release!: () => void
    const stop = vi.fn()
    const { guide } = setup({ a, b }, {
      stage: { moveToElement: e => (e === a ? new Promise<void>(r => { release = r }) : Promise.resolve()), lookAt: () => {}, stop },
    })
    guide.show({ target: 'a', reason: 'asked' })
    guide.show({ target: 'b', reason: 'asked', mode: 'point' })
    expect(stop).toHaveBeenCalledTimes(1)
    release()
    await tick()
    guide.show({ target: 'b', reason: 'asked', mode: 'point' })
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('an offer emits offered with the request, and a yes shows it', async () => {
    const save = el(800)
    const { guide, calls, events } = setup({ save }, { settings: () => ({ ...SETTINGS, offerFirst: true }) })
    guide.show('save')
    await tick()
    expect(calls).toContain('say:Want me to show you save?')
    expect(events).toEqual([{ type: 'offered', target: 'save', request: { target: 'save' } }])
    const offer = events[0] as Extract<GuideEvent, { type: 'offered' }>
    guide.show({ ...offer.request, reason: 'asked' })
    await tick()
    expect(events[1]).toEqual({ type: 'shown', target: 'save', size: 'approach' })
  })

  it('a missing target emits missing; asked says so', async () => {
    const { guide, calls, events } = setup({})
    guide.show({ target: 'nope', reason: 'app' })
    await tick()
    expect(calls).toEqual([])
    guide.show({ target: 'nope', reason: 'asked' })
    await tick()
    expect(calls).toContain(`say:${MISSING_SAY}`)
    expect(events).toEqual([{ type: 'missing', target: 'nope', reason: 'not_found' }, { type: 'missing', target: 'nope', reason: 'not_found' }])
    expect(calls).toContain('gesture:headShake')
  })

  it('a target that is there but not drawn is missing (hidden): sad, a head shake, no move, no ring', async () => {
    const menu = el(800)
    const highlight = vi.fn(() => () => {})
    const { guide, calls, events } = setup({ menu }, { isHidden: () => true, highlight })
    guide.show({ target: 'menu', reason: 'asked' })
    await tick()
    expect(events).toEqual([{ type: 'missing', target: 'menu', reason: 'hidden' }])
    expect(calls).toEqual(['face:sad', 'gesture:headShake', `say:${MISSING_SAY}`, 'face:null'])
    expect(highlight).not.toHaveBeenCalled()
  })

  it('rings the target for a point, approach or explain, never for an offer or a glance; the ring goes when it ends', async () => {
    const save = el(800)
    const off = vi.fn()
    const highlight = vi.fn(() => off)
    const { guide, advance } = setup({ save }, { highlight, settings: () => ({ ...SETTINGS, offerFirst: true }) })
    guide.show({ target: 'save', reason: 'asked', mode: 'point' })
    await tick()
    expect(highlight).toHaveBeenCalledTimes(1)
    expect(off).toHaveBeenCalledTimes(1)
    for (const importance of ['minor', 'normal'] as const) {
      advance(SETTINGS.cooldownMs)
      guide.show({ target: 'save', importance }) // a glance, then an offer
      await tick()
    }
    expect(highlight).toHaveBeenCalledTimes(1)
  })

  it('a newer command takes the ring away at once', async () => {
    const save = el(800)
    const off = vi.fn()
    let release = () => {}
    const { guide } = setup({ save }, { highlight: () => off, speak: () => new Promise<void>(r => { release = r }) })
    guide.show({ target: 'save', reason: 'asked', mode: 'point', say: 'Here.' })
    await tick()
    expect(off).not.toHaveBeenCalled()
    guide.stop()
    expect(off).toHaveBeenCalledTimes(1)
    release()
  })

  it('honours the app cooldown', async () => {
    const save = el(800)
    const { guide, events, advance } = setup({ save })
    guide.show({ target: 'save', importance: 'major' })
    await tick()
    advance(1000)
    guide.show({ target: 'save', importance: 'major' })
    await tick()
    expect(events).toHaveLength(1)
    advance(SETTINGS.cooldownMs)
    guide.show({ target: 'save', importance: 'major' })
    await tick()
    expect(events.filter(e => e.type === 'shown')).toHaveLength(2)
  })

  it('scrolls an off-screen target into view first', async () => {
    const far = el(800)
    far.getBoundingClientRect = () => ({ left: 800, right: 840, top: 2000, bottom: 2040 }) as DOMRect
    const { guide, calls } = setup({ far })
    guide.show({ target: 'far', reason: 'asked', mode: 'point' })
    await new Promise(r => setTimeout(r, 100))
    expect(far.scrollIntoView).toHaveBeenCalledWith({ block: 'center', behavior: 'auto' })
    expect(calls).toContain('look')
  })

  it('runs a task: intro and first step, next step, done, cancelled', async () => {
    const a = el(800), b = el(10)
    const { guide, calls } = setup({ a, b })
    const t = guide.startTask({ id: 't', title: 'T', intro: 'Two steps.', doneSay: 'Nice!', steps: [{ id: '1', target: 'a', say: 'Open this.' }, { id: '2', target: 'b', say: 'Then this.' }] })
    await tick()
    expect(calls.indexOf('say:Two steps.')).toBeLessThan(calls.indexOf('say:Open this.'))
    t.complete()
    await tick()
    expect(calls).toContain('say:Then this.')
    t.complete()
    await tick()
    expect(calls.slice(-4)).toEqual(['face:excited', 'gesture:celebrate', 'say:Nice!', 'face:null'])

    calls.length = 0
    guide.startTask({ id: 'u', title: 'U', steps: [{ id: '1', target: 'a', say: 'x' }] })
    guide.stop()
    await tick()
    expect(calls).toContain('stop')
    expect(calls).toContain('home')
  })

  it('detach cancels and unsubscribes', async () => {
    const save = el(800)
    let release!: () => void
    const { guide, calls, detach } = setup({ save }, {
      stage: { moveToElement: () => new Promise<void>(r => { release = r }), lookAt: () => { calls.push('look') } },
    })
    guide.show({ target: 'save', reason: 'asked' })
    detach()
    expect(save.attrs.has('data-otto-guiding')).toBe(false)
    release()
    guide.show({ target: 'save', reason: 'asked' })
    await tick()
    expect(calls).toEqual(['face:happy', 'face:null'])
  })
})

describe('guide targets', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('finds marked-up and registered targets; the registry wins', () => {
    const marked = el(0, { 'data-otto-target': 'save', 'aria-label': 'Save it' })
    const other = el(0, { 'data-otto-target': 'help' }, '  Get   help  ')
    vi.stubGlobal('document', { querySelectorAll: () => [marked, other], querySelector: () => null })
    expect(findGuideTarget('save')?.info).toEqual({ id: 'save', label: 'Save it' })
    expect(listGuideTargets()).toEqual([{ id: 'save', label: 'Save it' }, { id: 'help', label: 'Get help' }])

    const changes = vi.fn()
    const off = onGuideTargetsChange(changes)
    const mine = el(0)
    const unregister = registerGuideTarget('save', mine, { label: 'the Save button', description: 'Saves.' })
    expect(findGuideTarget('save')).toEqual({ element: mine, info: { id: 'save', label: 'the Save button', description: 'Saves.' } })
    expect(listGuideTargets().map(t => t.label)).toEqual(['the Save button', 'Get help'])
    unregister()
    expect(findGuideTarget('save')?.element).toBe(marked)
    expect(changes).toHaveBeenCalledTimes(2)
    off()
  })

  it('cleans page text: no control characters, collapsed spaces, capped', () => {
    const long = 'x'.repeat(300)
    const marked = el(0, { 'data-otto-target': 'a', 'data-otto-label': 'Save\u0000\n\t now\u007F', 'data-otto-description': long }, '')
    vi.stubGlobal('document', { querySelectorAll: () => [marked], querySelector: () => null })
    const info = findGuideTarget('a')!.info
    expect(info.label).toBe('Save now')
    expect(info.description).toHaveLength(200)
    const off = registerGuideTarget('b', el(0), { label: `  ${'y'.repeat(100)}\u0007`, description: 'a\r\nb' })
    expect(findGuideTarget('b')!.info).toEqual({ id: 'b', label: 'y'.repeat(60), description: 'a b' })
    off()
  })

  it('skips disconnected elements and works without a document', () => {
    const gone = el(0, { 'data-otto-target': 'x' })
    ;(gone as { isConnected: boolean }).isConnected = false
    vi.stubGlobal('document', { querySelectorAll: () => [gone], querySelector: () => null })
    expect(findGuideTarget('x')).toBeNull()
    vi.unstubAllGlobals()
    expect(listGuideTargets()).toEqual([])
  })
})
