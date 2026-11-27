import { describe, expect, it } from 'vitest'
import { DEFAULT_OTTO_CONFIG } from '../config'
import { createOttoEvents, type OttoEvent } from './events'
import { attentionAnnouncement, createReactor, type AwarenessSettings } from './reactions'

const SETTINGS = DEFAULT_OTTO_CONFIG.awareness
const AWAKE = { self: { asleep: false, talking: false, walking: false, mayMove: true }, user: { present: true, idle: false } }
const make = (over: Partial<AwarenessSettings> = {}) => createReactor({ ...SETTINGS, ...over })
/** Events far enough apart that no cooldown applies. */
const SPACED = 60_000

describe('reaction size follows importance', () => {
  it('a minor success is a glance, a normal one a small celebration, a major one walks there and celebrates', () => {
    const r = make()
    expect(r.decide({ type: 'success', importance: 'minor', where: '#a', topic: 'a' }, AWAKE, 0)).toMatchObject({ size: 'glance', look: '#a' })
    const normal = r.decide({ type: 'success', where: '#b', topic: 'b' }, AWAKE, SPACED)
    expect(normal).toMatchObject({ size: 'gesture', gesture: 'celebrate', face: 'excited' })
    expect(normal.gestureIntensity).toBeLessThan(1)
    expect(normal.walk).toBeUndefined()
    expect(r.decide({ type: 'success', importance: 'major', where: '#c', topic: 'c' }, AWAKE, 2 * SPACED))
      .toMatchObject({ size: 'big', gesture: 'celebrate', gestureIntensity: 1, walk: '#c' })
  })

  it('a failure looks toward it, concerned, and shakes his head; a major one also says what went wrong', () => {
    const r = make()
    expect(r.decide({ type: 'failure', where: '#form' }, AWAKE, 0)).toMatchObject({ size: 'gesture', gesture: 'headShake', look: '#form', turn: true })
    expect(r.decide({ type: 'failure', importance: 'major', message: 'Upload failed', topic: 'x' }, AWAKE, SPACED))
      .toMatchObject({ size: 'big', face: 'alert', say: 'Upload failed' })
  })

  it('some events never get big: a section is a curious look, leaving gets nothing', () => {
    const r = make()
    expect(r.decide({ type: 'section', importance: 'major', where: '#panel' }, AWAKE, 0)).toMatchObject({ size: 'gesture', look: '#panel' })
    expect(r.decide({ type: 'leave' }, AWAKE, SPACED).size).toBe('none')
  })
})

describe('not annoying', () => {
  it('repeats shrink, and the third in the window is ignored', () => {
    const r = make()
    const e: OttoEvent = { type: 'success', topic: 'save' }
    expect(r.decide(e, AWAKE, 0).size).toBe('gesture')
    expect(r.decide(e, AWAKE, 6000).size).toBe('glance')
    expect(r.decide(e, AWAKE, 7500).size).toBe('none')
    // A different topic is not a repeat (only the gesture cooldown applies).
    expect(r.decide({ type: 'success', topic: 'upload' }, AWAKE, 13_000).size).toBe('gesture')
  })

  it('cooldowns make a reaction too soon after the last one smaller', () => {
    const r = make()
    expect(r.decide({ type: 'success', importance: 'major', topic: 'a' }, AWAKE, 0).size).toBe('big')
    const soon = r.decide({ type: 'success', importance: 'major', topic: 'b' }, AWAKE, 6000)
    expect(soon.size).toBe('gesture')
    expect(soon.why.join(' ')).toContain('big cooldown')
    expect(r.decide({ type: 'success', topic: 'c' }, AWAKE, 7300).size).toBe('glance') // gesture cooldown, glance's has passed
    expect(r.decide({ type: 'select', topic: 'd' }, AWAKE, 7400).size).toBe('none') // inside the glance cooldown
  })

  it('a flood of events costs at most gesturesPerMinute gestures', () => {
    const r = make({ cooldownMs: { glance: 0, gesture: 0, big: 0 }, gesturesPerMinute: 3 })
    const sizes = Array.from({ length: 8 }, (_, i) => r.decide({ type: 'success', topic: `t${i}` }, AWAKE, i * 1000).size)
    expect(sizes.filter(s => s === 'gesture')).toHaveLength(3)
    expect(sizes.slice(3).every(s => s === 'glance')).toBe(true)
  })

  it('while talking with the visitor, a glance at most and the face is left to the voice', () => {
    const r = make()
    const talking = { ...AWAKE, self: { ...AWAKE.self, talking: true } }
    const out = r.decide({ type: 'success', importance: 'major', where: '#x' }, talking, 0)
    expect(out).toMatchObject({ size: 'glance', look: '#x' })
    expect(out.face).toBeUndefined()
    expect(out.gesture).toBeUndefined()
  })

  it('asleep, small news passes him by; a failure wakes him', () => {
    const r = make()
    const asleep = { ...AWAKE, self: { ...AWAKE.self, asleep: true } }
    expect(r.decide({ type: 'success' }, asleep, 0).size).toBe('none')
    expect(r.decide({ type: 'failure' }, asleep, SPACED)).toMatchObject({ size: 'gesture', wake: true })
  })

  it('nobody watching: nothing now, and a failure is kept for when they are back', () => {
    const r = make()
    const away = { ...AWAKE, user: { present: false, idle: false } }
    expect(r.decide({ type: 'failure', message: 'Sync failed' }, away, 0).size).toBe('none')
    expect(r.decide({ type: 'success' }, away, 1).size).toBe('none')
    expect(r.takeMissed()).toEqual([{ type: 'failure', message: 'Sync failed' }])
    expect(r.takeMissed()).toEqual([])
  })

  it('stays put when he may not move', () => {
    const r = make()
    const out = r.decide({ type: 'success', importance: 'major', where: '#x' }, { ...AWAKE, self: { ...AWAKE.self, mayMove: false } }, 0)
    expect(out.size).toBe('big')
    expect(out.walk).toBeUndefined()
  })

  it("'quiet' liveliness keeps normal events to a glance", () => {
    expect(make({ liveliness: 'quiet' }).decide({ type: 'success' }, AWAKE, 0).size).toBe('glance')
  })
})

describe('context', () => {
  it('a task ending inherits where it ran and what it was about', () => {
    const r = make()
    r.decide({ type: 'task', task: 'job', topic: 'image generation', where: '#preview' }, AWAKE, 0)
    expect(r.awareness(AWAKE, 100).app.tasks).toHaveLength(1)
    expect(r.activeTask(100)).toBeNull()                 // not long enough to show
    expect(r.activeTask(2000)).toMatchObject({ id: 'job', ms: 2000 })
    const done = r.decide({ type: 'success', task: 'job' }, AWAKE, 3000)
    expect(done.look).toBe('#preview')
    expect(r.awareness(AWAKE, 3000).app.tasks).toHaveLength(0)
  })

  it('rules can react differently by topic, and dampers still apply to them', () => {
    const r = make({
      rules: [e => (e.type === 'success' && e.topic === 'upload' ? { size: 'glance', face: 'happy', look: '#files' } : undefined)],
    })
    expect(r.decide({ type: 'success', topic: 'upload' }, AWAKE, 0)).toMatchObject({ size: 'glance', look: '#files' })
    expect(r.decide({ type: 'success', topic: 'image generation' }, AWAKE, SPACED)).toMatchObject({ size: 'gesture', gesture: 'celebrate' })
  })

  it('task() handles end a task once, with its topic and place', () => {
    const events = createOttoEvents(), seen: OttoEvent[] = []
    events.subscribe(e => seen.push(e))
    const job = events.task('up', { topic: 'upload', where: '#drop' })
    job.succeed('Uploaded'); job.fail()
    expect(seen.map(e => `${e.type}:${e.task}:${e.topic}`)).toEqual(['task:up:upload', 'success:up:upload'])
  })
})


describe('accessible attention announcements', () => {
  it('announces permitted minor and normal attention events as text', () => {
    const event: OttoEvent = { type: 'attention', importance: 'minor', topic: 'object', message: 'A parcel is on the table.' }
    expect(attentionAnnouncement(event, { size: 'glance' })).toBe('A parcel is on the table.')
    expect(attentionAnnouncement({ ...event, importance: 'normal' }, { size: 'gesture' })).toBe('A parcel is on the table.')
  })

  it('does not announce suppressed reactions, other event types or missing messages', () => {
    const event: OttoEvent = { type: 'attention', message: 'A cable is across the path.' }
    expect(attentionAnnouncement(event, { size: 'none' })).toBeNull()
    expect(attentionAnnouncement({ ...event, type: 'success' }, { size: 'glance' })).toBeNull()
    expect(attentionAnnouncement({ type: 'attention' }, { size: 'glance' })).toBeNull()
    expect(attentionAnnouncement({ type: 'attention', message: '\u0000  ' }, { size: 'glance' })).toBeNull()
    expect(attentionAnnouncement({ type: 'attention', message: 5 } as unknown as OttoEvent, { size: 'glance' })).toBeNull()
  })

  it('cleans control characters and URLs and caps the announcement', () => {
    const cleaned = attentionAnnouncement({
      type: 'attention',
      message: '  A\u0000 parcel\n is here. See https://example.test/details now.  ',
    }, { size: 'glance' })
    expect(cleaned).toBe('A parcel is here. See now.')
    expect(attentionAnnouncement({ type: 'attention', message: 'x'.repeat(500) }, { size: 'glance' }))
      .toHaveLength(120)
  })
})
