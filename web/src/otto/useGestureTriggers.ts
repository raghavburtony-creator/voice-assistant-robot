// Turns the voice session's lifecycle into one-shot gestures. It only watches AssistantStatus transitions and asks the channel
// to play what GESTURE_SETTINGS names (null = nothing); no gesture name and no animation math lives here.
//
//   previous -> status                    gesture
//   not live -> listening (server ready)  onConnect (forced); now live
//   speaking -> listening, while live     onTurnEnd
//   live     -> idle | ended              onDisconnect (forced); not live   (idle covers stop() from closing the panel)
//   anything -> error                     onError (forced); not live
//
// "live" means the session reached listening. A start that ends or fails before that says goodbye to nobody (error still shakes).

import { useEffect, useRef } from 'react'
import { GESTURE_SETTINGS } from '../otto.config'
import type { GestureChannel, GestureName } from './robot/gestures'
import type { AssistantStatus } from './useVoiceAssistant'

/** The parts of GESTURE_SETTINGS the lifecycle reads (so tests can pass their own). */
export type LifecycleSettings = {
  enabled: boolean
  onConnect: GestureName | null
  onTurnEnd: GestureName | null
  onDisconnect: GestureName | null
  onError: GestureName | null
}

/** What one status change means: the gesture to play (or null), whether it is forced, and whether the session is live after it. */
export type Transition = { gesture: GestureName | null; force: boolean; live: boolean }

/** The lifecycle rules as a pure function of the previous status, the new one, and whether the session was live. */
export function gestureForTransition(before: AssistantStatus, status: AssistantStatus, live: boolean,
  settings: LifecycleSettings = GESTURE_SETTINGS): Transition {
  const none = (nowLive: boolean): Transition => ({ gesture: null, force: false, live: nowLive })
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

/** `channel` should be stable (create it once); a new object each render still works. */
export function useGestureTriggers(status: AssistantStatus, channel: GestureChannel): void {
  const previous = useRef<AssistantStatus>(status)
  const live = useRef(false)
  useEffect(() => {
    const before = previous.current
    // Same status again (a StrictMode re-run, or a re-render for another reason): nothing happened.
    if (before === status) return
    previous.current = status
    const next = gestureForTransition(before, status, live.current)
    live.current = next.live
    if (next.gesture) channel.play(next.gesture, next.force ? { force: true } : undefined)
  }, [status, channel]) // a new channel alone re-runs this with the same status, which does nothing
}
