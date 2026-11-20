// Turns the voice session's lifecycle into one-shot gestures. It only watches AssistantStatus transitions and asks the channel
// to play what the config's gestures name (null = nothing); no gesture name and no animation math lives here.
//
//   previous -> status                    gesture
//   not live -> listening (server ready)  onConnect (forced); now live
//   speaking -> listening, while live     onTurnEnd
//   live     -> idle | ended              onDisconnect (forced); not live   (idle covers stop() from closing the panel)
//   anything -> error                     onError (forced); not live
//   a barge-in (the visitor cut Otto off)  whatever plays stops, then onInterrupt (forced), instead of onTurnEnd
//
// "live" means the session reached listening. A start that ends or fails before that says goodbye to nobody (error still shakes).

import { useEffect, useRef } from 'react'
import { DEFAULT_OTTO_CONFIG } from './config'
import { useOttoConfig } from './useOttoConfig'
import type { GestureChannel, GestureName } from './robot/gestures'
import type { AssistantStatus } from './useVoiceAssistant'

/** The parts of GESTURE_SETTINGS the lifecycle reads (so tests can pass their own). */
export type LifecycleSettings = {
  enabled: boolean
  onConnect: GestureName | null
  onTurnEnd: GestureName | null
  onDisconnect: GestureName | null
  onError: GestureName | null
  onInterrupt?: GestureName | null
}

/**
 * What one status change means: the gesture to play (or null), whether it is forced, whether whatever plays is stopped
 * first, and whether the session is live after it.
 */
export type Transition = { gesture: GestureName | null; force: boolean; live: boolean; cancel?: boolean }

/** The lifecycle rules as a pure function of the previous status, the new one, and whether the session was live. */
export function gestureForTransition(before: AssistantStatus, status: AssistantStatus, live: boolean,
  settings: LifecycleSettings = DEFAULT_OTTO_CONFIG.gestures, interrupted = false): Transition {
  const none = (nowLive: boolean): Transition => ({ gesture: null, force: false, live: nowLive })
  if (interrupted && live && (status === 'listening' || status === 'speaking')) {
    return { gesture: settings.enabled ? settings.onInterrupt ?? null : null, force: true, live: true, cancel: true }
  }
  if (before === status) return none(live)
  if (status === 'listening') {
    if (!live) return { gesture: settings.enabled ? settings.onConnect : null, force: true, live: true }
    if (before === 'speaking') return { gesture: settings.enabled ? settings.onTurnEnd : null, force: false, live: true }
    return none(true)
  }
  if (status === 'idle' || status === 'ended') {
    return live ? { gesture: settings.enabled ? settings.onDisconnect : null, force: true, live: false } : none(false)
  }
  if (status === 'error') return { gesture: settings.enabled ? settings.onError : null, force: true, live: false }
  return none(live)
}

/**
 * `channel` should be stable (create it once); a new object each render still works. `interruptions` counts barge-ins
 * (useVoiceAssistant's `interruptions`): each new one plays onInterrupt, with the status change it comes with.
 */
export function useGestureTriggers(status: AssistantStatus, channel: GestureChannel, interruptions = 0): void {
  const settings = useOttoConfig().gestures
  const previous = useRef<AssistantStatus>(status)
  const cuts = useRef(interruptions)
  const live = useRef(false)
  useEffect(() => {
    const before = previous.current
    const cut = interruptions !== cuts.current
    cuts.current = interruptions
    // Same status again (a StrictMode re-run, or a re-render for another reason): nothing happened.
    if (before === status && !cut) return
    previous.current = status
    const next = gestureForTransition(before, status, live.current, settings, cut)
    live.current = next.live
    if (next.cancel) channel.stop()
    if (next.gesture) channel.play(next.gesture, next.force ? { force: true } : undefined)
  }, [status, channel, interruptions]) // eslint-disable-line react-hooks/exhaustive-deps // a new channel alone re-runs this with the same status, which does nothing
}
