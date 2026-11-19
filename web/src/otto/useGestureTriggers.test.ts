import { describe, expect, it } from 'vitest'
import { gestureForTransition, type LifecycleSettings } from './useGestureTriggers'
import type { AssistantStatus } from './useVoiceAssistant'

const SETTINGS: LifecycleSettings = { enabled: true, onConnect: 'welcomeWave', onTurnEnd: 'nod', onDisconnect: 'goodbyeWave', onError: 'headShake' }

/** Feeds a sequence of statuses through the rules and lists what played. */
function session(statuses: AssistantStatus[], settings = SETTINGS) {
  let before = statuses[0], live = false
  const played: string[] = []
  for (const status of statuses.slice(1)) {
    const t = gestureForTransition(before, status, live, settings)
    if (t.gesture) played.push(`${t.gesture}${t.force ? '!' : ''}`)
    live = t.live
    before = status
  }
  return played
}

describe('voice lifecycle → gestures', () => {
  it('a whole conversation: wave hello, nod after each reply, wave goodbye', () => {
    expect(session(['idle', 'connecting', 'listening', 'speaking', 'listening', 'speaking', 'listening', 'idle']))
      .toEqual(['welcomeWave!', 'nod', 'nod', 'goodbyeWave!'])
  })

  it('the server ending the session says goodbye once, not again on the way back to idle', () => {
    expect(session(['idle', 'connecting', 'listening', 'ended', 'idle'])).toEqual(['welcomeWave!', 'goodbyeWave!'])
  })

  it('a start that never connects says no goodbye', () => {
    expect(session(['idle', 'connecting', 'idle'])).toEqual([])
  })

  it('an error shakes the head, live or not, and a reconnect waves hello again', () => {
    expect(session(['idle', 'connecting', 'error'])).toEqual(['headShake!'])
    expect(session(['idle', 'connecting', 'listening', 'error', 'connecting', 'listening'])).toEqual(['welcomeWave!', 'headShake!', 'welcomeWave!'])
  })

  it('the same status twice (a React re-run) does nothing', () => {
    expect(gestureForTransition('listening', 'listening', true, SETTINGS)).toEqual({ gesture: null, force: false, live: true })
  })

  it('null mappings and enabled: false play nothing but still track the session', () => {
    const quiet = { ...SETTINGS, onTurnEnd: null }
    expect(session(['idle', 'connecting', 'listening', 'speaking', 'listening', 'idle'], quiet)).toEqual(['welcomeWave!', 'goodbyeWave!'])
    const off = { ...SETTINGS, enabled: false }
    expect(session(['idle', 'connecting', 'listening', 'idle'], off)).toEqual([])
    expect(gestureForTransition('connecting', 'listening', false, off).live).toBe(true)
  })

  it('a barge-in stops whatever plays and nods (forced) instead of the turn-end nod', () => {
    const settings = { ...SETTINGS, onInterrupt: 'headShake' as const }
    expect(gestureForTransition('speaking', 'listening', true, settings, true))
      .toEqual({ gesture: 'headShake', force: true, live: true, cancel: true })
    // Without a barge-in the same change is a turn end.
    expect(gestureForTransition('speaking', 'listening', true, settings).gesture).toBe('nod')
    // No session, no barge-in.
    expect(gestureForTransition('idle', 'idle', false, settings, true).gesture).toBeNull()
  })
})
