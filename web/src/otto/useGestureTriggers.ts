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
import type { GestureChannel, GestureName } from './robot/gestures.js'
import type { AssistantStatus } from './useVoiceAssistant'

/** `channel` should be stable (create it once); a new object each render still works. */
export function useGestureTriggers(status: AssistantStatus, channel: GestureChannel): void {
  const previous = useRef<AssistantStatus>(status)
  const live = useRef(false)
  useEffect(() => {
    const before = previous.current
    // Same status again (a StrictMode re-run, or a re-render for another reason): nothing happened.
    if (before === status) return
    previous.current = status
    if (!GESTURE_SETTINGS.enabled) return

    const fire = (name: GestureName | null, force: boolean) => { if (name) channel.play(name, force ? { force: true } : undefined) }

    if (status === 'listening') {
      if (!live.current) { live.current = true; fire(GESTURE_SETTINGS.onConnect, true) }
      else if (before === 'speaking') fire(GESTURE_SETTINGS.onTurnEnd, false)
    } else if (status === 'idle' || status === 'ended') {
      if (live.current) { live.current = false; fire(GESTURE_SETTINGS.onDisconnect, true) }
    } else if (status === 'error') {
      live.current = false
      fire(GESTURE_SETTINGS.onError, true)
    }
  }, [status, channel]) // a new channel alone re-runs this with the same status, which does nothing
}
