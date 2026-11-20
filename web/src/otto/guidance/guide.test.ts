import { describe, expect, it } from 'vitest'
import { createOttoGuide, MISSING_SAY, planGuide, type GuideCommand, type GuideEvent, type GuideRequest, type GuideSettings, type GuideSituation } from './guide'
import type { GuideTaskSpec } from './task'

const SETTINGS: GuideSettings = { cooldownMs: 20_000, offerFirst: true, approachMinDistance: 0.25, lookSeconds: 2.5, helpAfterFailures: 2, helpWindowMs: 60_000 }
const TARGET = { id: 'save', label: 'the Save button' }
const SIT: GuideSituation = {
  side: 'right', distance: 0.5, visible: true, tabVisible: true, idle: 'awake', conversing: false, movementEnabled: true,
  now: 100_000, lastAppGuideAt: null,
}
const plan = (req: Partial<GuideRequest> = {}, sit: Partial<GuideSituation> = {}, settings: Partial<GuideSettings> = {}, target: typeof TARGET | null = TARGET) =>
  planGuide({ target: 'save', ...req }, target, { ...SIT, ...sit }, { ...SETTINGS, ...settings })
const LOOK = { do: 'look', seconds: 2.5 }
const asked = { reason: 'asked' } as const

describe('planGuide: a missing target', () => {
  it('the visitor asked: a sad face and an apology (unless the voice speaks)', () => {
    expect(plan(asked, {}, {}, null)).toMatchObject({ size: 'explain', steps: [{ do: 'face', face: 'sad' }, { do: 'say', text: MISSING_SAY }] })
    expect(plan({ ...asked, say: null }, {}, {}, null).steps).toEqual([{ do: 'face', face: 'sad' }])
  })
  it('a task step: like asking', () => {
    expect(plan({ reason: 'task' }, {}, {}, null).steps).toEqual([{ do: 'face', face: 'sad' }, { do: 'say', text: MISSING_SAY }])
    expect(plan({ reason: 'task', say: null }, {}, {}, null).steps).toEqual([{ do: 'face', face: 'sad' }])
  })
  it('the app suggested it: nothing', () => {
    expect(plan({}, {}, {}, null).size).toBe('skip')
  })
})

describe('planGuide: respecting attention', () => {
  it('a hidden tab skips everything, even when asked', () => {
    for (const reason of ['asked', 'task', 'app'] as const) expect(plan({ reason }, { tabVisible: false })).toMatchObject({ size: 'skip', steps: [] })
  })
  it('an unrequested guide waits out the cooldown', () => {
    expect(plan({}, { lastAppGuideAt: SIT.now - 5_000 }).size).toBe('skip')
    expect(plan({}, { lastAppGuideAt: SIT.now - 20_000 }).size).toBe('offer')
    expect(plan(asked, { lastAppGuideAt: SIT.now - 5_000 }).size).toBe('approach') // asking ignores it
  })
  it('asleep: only a major suggestion goes through', () => {
    expect(plan({}, { idle: 'asleep' }).size).toBe('skip')
    expect(plan({ importance: 'major' }, { idle: 'asleep' }).size).toBe('approach')
    expect(plan(asked, { idle: 'asleep' }).size).toBe('approach')
  })
  it('in a conversation an unrequested guide is a glance at most', () => {
    expect(plan({ importance: 'major' }, { conversing: true }).size).toBe('glance')
    expect(plan({ mode: 'point' }, { conversing: true }).size).toBe('glance')
    expect(plan(asked, { conversing: true }).size).toBe('approach')
  })
})

describe('planGuide: size by importance (app)', () => {
  it('minor is a glance', () => {
    expect(plan({ importance: 'minor' })).toMatchObject({ size: 'glance', steps: [{ do: 'face', face: 'curious' }, LOOK] })
  })
  it('normal offers first, with no movement', () => {
    const p = plan()
    expect(p.size).toBe('offer')
    expect(p.steps).toEqual([{ do: 'face', face: 'curious' }, LOOK, { do: 'say', text: 'Want me to show you the Save button?' }])
  })
  it('normal points straight away when offerFirst is off', () => {
    expect(plan({}, {}, { offerFirst: false }).size).toBe('point')
  })
  it('major is treated like asked', () => {
    expect(plan({ importance: 'major' }).size).toBe('approach')
    expect(plan({ importance: 'major' }, { distance: 0.1 }).size).toBe('point')
  })
})

describe('planGuide: asked and task steps', () => {
  it('approach when far and free to move, else point', () => {
    expect(plan(asked).steps).toEqual([
      { do: 'face', face: 'happy' }, { do: 'move' }, LOOK, { do: 'gesture', name: 'pointRight' }, { do: 'say', text: "Here's the Save button." },
    ])
    expect(plan({ reason: 'task' }).size).toBe('approach')
    expect(plan(asked, { distance: 0.2 }).size).toBe('point')
    expect(plan(asked, { movementEnabled: false }).size).toBe('point')
  })
})

describe('planGuide: explicit modes', () => {
  it('glance, point, approach and explain', () => {
    expect(plan({ ...asked, mode: 'glance' }).steps).toEqual([{ do: 'face', face: 'curious' }, LOOK])
    expect(plan({ ...asked, mode: 'point' }).steps.map(s => s.do)).toEqual(['face', 'look', 'gesture', 'say'])
    expect(plan({ ...asked, mode: 'approach' }, { distance: 0 }).steps.map(s => s.do)).toEqual(['face', 'move', 'look', 'gesture', 'say'])
    expect(plan({ ...asked, mode: 'explain' }).steps.map(s => s.do)).toEqual(['face', 'look', 'say'])
  })
  it('approach falls back to point when movement is off', () => {
    expect(plan({ ...asked, mode: 'approach' }, { movementEnabled: false }).size).toBe('point')
  })
  it('an app guide with a mode still obeys the skip rules', () => {
    expect(plan({ mode: 'point' }, { lastAppGuideAt: SIT.now - 1 }).size).toBe('skip')
    expect(plan({ mode: 'point' }, { idle: 'asleep' }).size).toBe('skip')
    expect(plan({ mode: 'point' }).size).toBe('point')
  })
  it('an app guide with a mode is capped at point unless major', () => {
    expect(plan({ mode: 'approach' }).size).toBe('point')
    expect(plan({ mode: 'explain', importance: 'minor' }).size).toBe('point')
    expect(plan({ mode: 'approach', importance: 'major' }).size).toBe('approach')
    expect(plan({ mode: 'explain', importance: 'major' }).size).toBe('explain')
    expect(plan({ mode: 'approach', importance: 'major' }, { lastAppGuideAt: SIT.now - 1 }).size).toBe('skip')
  })
})

describe('planGuide: steps', () => {
  it('scrolls first when the target is off screen', () => {
    expect(plan(asked, { visible: false }).steps[0]).toEqual({ do: 'scroll' })
    expect(plan(asked).steps.some(s => s.do === 'scroll')).toBe(false)
  })
  it('points toward the side, and nods straight ahead', () => {
    const gesture = (side: GuideSituation['side']) => plan({ ...asked, mode: 'point' }, { side }).steps.find(s => s.do === 'gesture')
    expect(gesture('left')).toEqual({ do: 'gesture', name: 'pointLeft' })
    expect(gesture('right')).toEqual({ do: 'gesture', name: 'pointRight' })
    expect(gesture('center')).toEqual({ do: 'gesture', name: 'nod' })
  })
  it('says request.say, else the description, else the label; null says nothing', () => {
    const said = (req: Partial<GuideRequest>, target = TARGET as typeof TARGET & { description?: string }) =>
      plan({ ...asked, mode: 'point', ...req }, {}, {}, target).steps.find(s => s.do === 'say')
    expect(said({ say: 'Press here.' })).toEqual({ do: 'say', text: 'Press here.' })
    expect(said({}, { ...TARGET, description: 'Saves your work.' })).toEqual({ do: 'say', text: 'Saves your work.' })
    expect(said({})).toEqual({ do: 'say', text: "Here's the Save button." })
    expect(said({ say: null })).toBeUndefined()
    expect(plan({ say: null }).steps.some(s => s.do === 'say')).toBe(false) // an offer too
  })
  it('explains every decision', () => {
    expect(plan().why.length).toBeGreaterThan(1)
    expect(plan({}, { idle: 'asleep' }).why.at(-1)).toMatch(/asleep/)
  })
})

describe('createOttoGuide', () => {
  const SPEC: GuideTaskSpec = { id: 'a', title: 'A', steps: [{ id: 's1', target: 'x', say: 'One' }, { id: 's2', target: 'y', say: 'Two' }] }
  const setup = () => {
    const guide = createOttoGuide()
    const commands: GuideCommand[] = []
    const events: GuideEvent[] = []
    guide.subscribe(c => commands.push(c))
    guide.onEvent(e => events.push(e))
    return { guide, commands, events }
  }

  it('show() sends a request to Otto; a string is a target id', () => {
    const { guide, commands } = setup()
    guide.show('save')
    guide.show({ target: 'x', mode: 'point', reason: 'asked' })
    expect(commands).toEqual([{ type: 'show', request: { target: 'save' } }, { type: 'show', request: { target: 'x', mode: 'point', reason: 'asked' } }])
  })

  it("emit() reaches the host, not Otto", () => {
    const { guide, commands, events } = setup()
    guide.emit({ type: 'shown', target: 'save', size: 'point' })
    expect(events).toEqual([{ type: 'shown', target: 'save', size: 'point' }])
    expect(commands).toEqual([])
  })

  it('task events go to Otto as commands and to the host as events', () => {
    const { guide, commands, events } = setup()
    const t = guide.startTask(SPEC)
    expect(t.status).toBe('active')
    expect(t.step?.id).toBe('s1')
    t.complete()
    t.back()
    t.goTo('s2')
    t.complete()
    expect(events.map(e => e.type === 'step' ? e.via : e.type)).toEqual(['start', 'next', 'back', 'goto', 'done'])
    expect(commands).toEqual(events.map(event => ({ type: 'task', event, spec: SPEC })))
    expect(t.status).toBe('done')
  })

  it('a new task replaces the active one; the old handle goes quiet', () => {
    const { guide, events } = setup()
    const first = guide.startTask(SPEC)
    guide.startTask({ ...SPEC, id: 'b' })
    expect(events.slice(1)).toMatchObject([{ type: 'cancelled', task: 'a', reason: 'replaced' }, { type: 'step', task: 'b', via: 'start' }])
    first.complete()
    expect(events).toHaveLength(3)
  })

  it('a bad spec throws and leaves the active task alone', () => {
    const { guide } = setup()
    const t = guide.startTask(SPEC)
    expect(() => guide.startTask({ ...SPEC, steps: [] })).toThrow()
    expect(t.status).toBe('active')
  })

  it('stop() cancels the task (user) and tells Otto to stop', () => {
    const { guide, commands, events } = setup()
    const t = guide.startTask(SPEC)
    guide.stop()
    expect(events.at(-1)).toEqual({ type: 'cancelled', task: 'a', reason: 'user' })
    expect(commands.at(-1)).toEqual({ type: 'stop' })
    expect(t.status).toBe('cancelled')
    guide.stop()
    expect(commands.at(-1)).toEqual({ type: 'stop' })
    expect(events).toHaveLength(2)
  })

  it('unsubscribing stops delivery', () => {
    const guide = createOttoGuide()
    const seen: unknown[] = []
    const off = guide.subscribe(c => seen.push(c))
    const offEvent = guide.onEvent(e => seen.push(e))
    off(); offEvent()
    guide.show('x')
    guide.emit({ type: 'missing', target: 'x' })
    expect(seen).toEqual([])
  })
})
