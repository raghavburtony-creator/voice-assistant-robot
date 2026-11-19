// Plays a sound cue when a gesture starts (SOUND_SETTINGS.gestureCues). Sound follows the robot's body language through
// gesture events only: nothing in the voice state or a render loop plays sound. Returns the controller, for direct cues.

import { useEffect, useRef } from 'react'
import { SOUND_SETTINGS } from '../otto.config'
import type { GestureChannel, GestureName } from './robot/gestures'
import { SoundController, type SoundCue } from './sound'

export type GestureSoundSettings = { enabled: boolean; volume: number; cues: Partial<Record<GestureName, SoundCue | null>> }

const DEFAULTS: GestureSoundSettings = {
  enabled: SOUND_SETTINGS.soundEnabled, volume: SOUND_SETTINGS.soundVolume, cues: SOUND_SETTINGS.gestureCues,
}

/**
 * One SoundController for as long as the component is mounted (made in an effect, so React's StrictMode re-run gets a
 * fresh one rather than a closed one), hearing `channel`'s gesture starts. `settings` may change between renders.
 */
export function useGestureSounds(channel: GestureChannel, settings: GestureSoundSettings = DEFAULTS) {
  const sound = useRef<SoundController | null>(null)
  const latest = useRef(settings)
  useEffect(() => { latest.current = settings })

  useEffect(() => {
    const controller = new SoundController({ enabled: latest.current.enabled, volume: latest.current.volume })
    sound.current = controller
    const off = channel.onEvent(event => {
      if (event.type !== 'start') return
      const cue = latest.current.cues[event.name]
      if (cue) controller.play(cue)
    })
    return () => { off(); controller.dispose(); if (sound.current === controller) sound.current = null }
  }, [channel])

  useEffect(() => { sound.current?.setEnabled(settings.enabled) }, [settings.enabled])
  useEffect(() => { sound.current?.setVolume(settings.volume) }, [settings.volume])
  return sound
}
