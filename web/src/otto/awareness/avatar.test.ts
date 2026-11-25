import { describe, expect, it } from 'vitest'
import { DEFAULT_OTTO_CONFIG } from '../config'
import { GESTURE_NAMES } from '../robot/gestures'
import { ROBOT_EXPRESSIONS } from '../robot/robot'
import { AVATAR_KINDS, parseAvatarEvent, toOttoEvents, type AvatarEvent } from './avatar'
import { createReactor } from './reactions'

const SETTINGS = DEFAULT_OTTO_CONFIG.awareness
const AWAKE = { self: { asleep: false, talking: false, walking: false, mayMove: true }, user: { present: true, idle: false } }
const SPACED = 60_000

describe('parseAvatarEvent', () => {
  it('knows the twelve kinds of the issue', () => {
    expect([...AVATAR_KINDS]).toEqual(['thinking', 'listening', 'speaking', 'working', 'waiting', 'permission', 'success', 'failure',
      'interruption', 'emotion', 'gesture', 'movement'])
  })

  it('accepts each kind with its fields and drops the extras', () => {
    expect(parseAvatarEvent({ kind: 'listening', junk: 1 })).toEqual({ kind: 'listening' })
    expect(parseAvatarEvent({ kind: 'working', id: 'render-1', topic: 'image', message: 'Rendering', html: '<b>' }))
      .toEqual({ kind: 'working', id: 'render-1', topic: 'image', message: 'Rendering' })
    expect(parseAvatarEvent({ kind: 'permission', id: 'p1', state: 'asking', message: 'May I send it?' }))
      .toEqual({ kind: 'permission', id: 'p1', state: 'asking', message: 'May I send it?' })
    expect(parseAvatarEvent({ kind: 'success' })).toEqual({ kind: 'success' })
    expect(parseAvatarEvent({ kind: 'failure', id: 't:1', message: 'It broke' })).toEqual({ kind: 'failure', id: 't:1', message: 'It broke' })
    expect(parseAvatarEvent({ kind: 'emotion', expression: 'sad' })).toEqual({ kind: 'emotion', expression: 'sad' })
    expect(parseAvatarEvent({ kind: 'gesture', gesture: 'nod', intensity: 3 })).toEqual({ kind: 'gesture', gesture: 'nod', intensity: 1 })
    expect(parseAvatarEvent({ kind: 'movement', to: 'visitor' })).toEqual({ kind: 'movement', to: 'visitor' })
  })

  it('refuses what does not fit: unknown kinds, bad ids, names Otto does not have, places', () => {
    for (const bad of [null, 5, 'working', {}, { kind: 'dance' }, { kind: 'working' }, { kind: 'working', id: 'has space' },
      { kind: 'working', id: '../x' }, { kind: 'working', id: 'x'.repeat(65) }, { kind: 'permission', id: 'p', state: 'maybe' },
      { kind: 'permission', state: 'asking' }, { kind: 'success', id: '<script>' }, { kind: 'emotion', expression: 'furious' },
      { kind: 'gesture', gesture: 'backflip' }, { kind: 'movement', to: '#save' }, { kind: 'movement', to: 'https://x.test' }]) {
      expect(parseAvatarEvent(bad), JSON.stringify(bad)).toBeNull()
    }
  })

  it('keeps text plain and short: control characters go, long text is cut', () => {
    const e = parseAvatarEvent({ kind: 'waiting', message: `Line one\u0000\n  line two ${'x'.repeat(300)}` })
    expect(e).toMatchObject({ kind: 'waiting' })
    expect((e as { message: string }).message).not.toMatch(/[\u0000-\u001F]/)
    expect((e as { message: string }).message.length).toBe(140)
    expect(parseAvatarEvent({ kind: 'waiting', message: '   ' })).toEqual({ kind: 'waiting' })
  })

  it('accepts every face and gesture Otto has', () => {
    for (const expression of ROBOT_EXPRESSIONS) expect(parseAvatarEvent({ kind: 'emotion', expression })).not.toBeNull()
    for (const gesture of GESTURE_NAMES) expect(parseAvatarEvent({ kind: 'gesture', gesture })).not.toBeNull()
  })
})

describe('toOttoEvents: one event path, not a second one', () => {
  it('the voice turn states are not mapped again: the voice session already drives them', () => {
    for (const kind of ['listening', 'speaking', 'interruption'] as const) expect(toOttoEvents({ kind })).toEqual([])
  })

  it('maps each kind onto the events Otto already understands', () => {
    expect(toOttoEvents({ kind: 'thinking', id: 'turn' })).toEqual([{ type: 'task', task: 'turn' }])
    expect(toOttoEvents({ kind: 'working', id: 'r1', topic: 'render', message: 'Rendering' })).toEqual([{ type: 'task', task: 'r1', topic: 'render', message: 'Rendering' }])
    expect(toOttoEvents({ kind: 'waiting' })).toEqual([{ type: 'waiting' }])
    expect(toOttoEvents({ kind: 'permission', id: 'p1', state: 'asking', message: 'May I?' })).toEqual([{ type: 'permission', task: 'p1', message: 'May I?' }])
    expect(toOttoEvents({ kind: 'permission', id: 'p1', state: 'granted' })).toEqual([{ type: 'complete', task: 'p1', importance: 'minor', data: { permission: 'granted' } }])
    expect(toOttoEvents({ kind: 'success', id: 'r1' })).toEqual([{ type: 'success', importance: 'normal', task: 'r1' }])
    expect(toOttoEvents({ kind: 'failure' })).toEqual([{ type: 'failure', importance: 'normal' }])
    expect(toOttoEvents({ kind: 'emotion', expression: 'sad' })).toEqual([{ type: 'express', importance: 'minor', data: { expression: 'sad' } }])
    expect(toOttoEvents({ kind: 'movement', to: 'visitor' })).toEqual([{ type: 'express', importance: 'minor', data: { look: 'user' } }])
  })
})

/** What Otto does with a backend's events, through the reactor (the same judgement as for the app's own events). */
function play(events: AvatarEvent[], at = 0, state = AWAKE) {
  const reactor = createReactor(SETTINGS)
  return { reactor, out: events.flatMap(e => toOttoEvents(e)).map((e, i) => reactor.decide(e, state, at + i * SPACED)) }
}

describe('what the visitor sees', () => {
  it('a long task visibly changes Otto: it becomes the active task once it has run a while, and ends with the success', () => {
    const r = createReactor(SETTINGS)
    for (const e of toOttoEvents({ kind: 'working', id: 'render', topic: 'image' })) r.decide(e, AWAKE, 0)
    expect(r.activeTask(SETTINGS.taskNoticeMs - 1)).toBeNull() // a quick job is not announced
    expect(r.activeTask(SETTINGS.taskNoticeMs + 1)).toMatchObject({ id: 'render', topic: 'image' })
    const done = toOttoEvents({ kind: 'success', id: 'render' }).map(e => r.decide(e, AWAKE, 10_000))
    expect(done[0]).toMatchObject({ size: 'gesture', gesture: 'celebrate', face: 'excited' })
    expect(r.activeTask(10_001)).toBeNull()
  })

  it('a permission request is a state of its own: asked, held, then answered', () => {
    const r = createReactor(SETTINGS)
    const asked = toOttoEvents({ kind: 'permission', id: 'send', state: 'asking', message: 'May I send this?' }).map(e => r.decide(e, AWAKE, 0))[0]
    expect(asked).toMatchObject({ size: 'gesture', face: 'alert', gesture: 'nod', look: 'user', say: 'May I send this?' })
    expect(r.activeAsk(1)).toMatchObject({ id: 'send' }) // held: no notice delay, and no timer ends it
    expect(r.awareness(AWAKE, 1).app.asking).toMatchObject({ id: 'send' })
    expect(r.activeTask(SETTINGS.taskNoticeMs + 1)).toBeNull() // not a task
    toOttoEvents({ kind: 'permission', id: 'send', state: 'granted' }).forEach(e => r.decide(e, AWAKE, 5000))
    expect(r.activeAsk(5001)).toBeNull()
    expect(r.awareness(AWAKE, 5001).app.asking).toBeNull()
  })

  it('a refused request ends the hold without a smile; a granted one is a small nod', () => {
    const asked = (id: string) => toOttoEvents({ kind: 'permission', id, state: 'asking' })
    const r = createReactor(SETTINGS)
    asked('a').forEach(e => r.decide(e, AWAKE, 0))
    const denied = toOttoEvents({ kind: 'permission', id: 'a', state: 'denied' }).map(e => r.decide(e, AWAKE, SPACED))[0]
    expect(denied.face).toBeUndefined()
    expect(denied.gesture).toBeUndefined()
    asked('b').forEach(e => r.decide(e, AWAKE, 2 * SPACED))
    const granted = toOttoEvents({ kind: 'permission', id: 'b', state: 'granted' }).map(e => r.decide(e, AWAKE, 3 * SPACED))[0]
    expect(granted.size).toBe('glance')
    expect(granted.face).toBe('happy')
  })

  it('asking is seen and heard in the middle of a conversation (the voice keeps the face, but the question is tracked and spoken)', () => {
    const talking = { ...AWAKE, self: { ...AWAKE.self, talking: true } }
    const { reactor, out } = play([{ kind: 'permission', id: 'q', state: 'asking', message: 'OK to continue?' }], 0, talking)
    expect(out[0].size).toBe('glance') // never a gesture over his own speech
    expect(out[0].say).toBe('OK to continue?') // but screen readers still get the question
    expect(reactor.activeAsk(1)).not.toBeNull() // and the held state is set
  })

  it('asking wakes a sleeping Otto, and waits for a visitor who is away', () => {
    const asleep = { ...AWAKE, self: { ...AWAKE.self, asleep: true } }
    expect(play([{ kind: 'permission', id: 'w', state: 'asking' }], 0, asleep).out[0].wake).toBe(true)
    const away = { ...AWAKE, user: { present: false, idle: true } }
    const { reactor, out } = play([{ kind: 'permission', id: 'w', state: 'asking' }], 0, away)
    expect(out[0].size).toBe('none')
    expect(reactor.takeMissed()).toMatchObject([{ type: 'permission', task: 'w' }])
  })

  it('failures and successes react the same whoever reports them (the app, or a backend)', () => {
    const fromApp = createReactor(SETTINGS)
    const fromBackend = createReactor(SETTINGS)
    expect(toOttoEvents({ kind: 'failure', message: 'Nope' }).map(e => fromBackend.decide(e, AWAKE, 0))[0])
      .toEqual(fromApp.decide({ type: 'failure', importance: 'normal', message: 'Nope' }, AWAKE, 0))
    expect(toOttoEvents({ kind: 'success' }).map(e => fromBackend.decide(e, AWAKE, SPACED))[0])
      .toEqual(fromApp.decide({ type: 'success', importance: 'normal' }, AWAKE, SPACED))
  })

  it('an emotion is a passing face, a gesture a gesture, a movement a look at the visitor', () => {
    expect(play([{ kind: 'emotion', expression: 'sad' }]).out[0]).toMatchObject({ size: 'glance', face: 'sad' })
    expect(play([{ kind: 'gesture', gesture: 'celebrate', intensity: 0.8 }]).out[0])
      .toMatchObject({ size: 'gesture', gesture: 'celebrate', gestureIntensity: 0.8 })
    expect(play([{ kind: 'movement', to: 'visitor' }]).out[0]).toMatchObject({ size: 'glance', look: 'user' })
  })

  it('an express event only ever carries names Otto has (a hand-made event with others does nothing)', () => {
    const r = createReactor(SETTINGS)
    const out = r.decide({ type: 'express', importance: 'normal', data: { expression: 'furious', gesture: 'backflip', look: '#save' } }, AWAKE, 0)
    expect(out.face).toBeUndefined()
    expect(out.gesture).toBeUndefined()
    expect(out.look).toBeUndefined()
  })
})
