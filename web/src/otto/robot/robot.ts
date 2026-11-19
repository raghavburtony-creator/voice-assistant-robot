// Otto's robot: shared types, and how each face looks on the Clay Robot's screen
// (web/src/components/originkit/ui/clay-robot.tsx, driven by ClayScene.tsx).

import { useEffect, useState } from 'react'

export type RobotPose = 'idle' | 'listening' | 'talking' | 'thinking'
export type RobotExpression = 'happy' | 'searching' | 'excited' | 'alert' | 'resting' | 'sad' | 'curious'

/** Characters a second for the speech bubble: about the pace of the Gemini voice. */
export const SPEAK_CPS = 16

/**
 * How each face looks on the robot's screen, eased toward whenever the face changes (ClayScene):
 *   open      how open the eyes are (1 = the robot's own); blinks multiply on top
 *   joy       0..1, bends the eyes into happy arcs
 *   lookX/Y   where the eyes look on the screen (head units)
 *   glow      eye glow strength; color: eye colour, or null for ROBOT_COLORS.eyes
 *   tilt      radians each eye turns about its centre, mirrored: + drops the outer corners (sad)
 *   scaleL/R  each eye's height (viewer's left / right), for an asymmetric look (curious)
 *   roll      head tilt, + crown toward the viewer's left; pitch: + chin down
 *   blink     how far apart blinks are (1 = the robot's own rhythm, 2 = half as often)
 */
export type FaceShape = {
  open: number; joy: number; lookX: number; lookY: number; glow: number; color: string | null
  tilt: number; scaleL: number; scaleR: number; roll: number; pitch: number; blink: number
}

const NEUTRAL = { tilt: 0, scaleL: 1, scaleR: 1, roll: 0, pitch: 0, blink: 1 }

export const FACES: Record<RobotExpression, FaceShape> = {
  happy: { ...NEUTRAL, open: 1, joy: 0, lookX: 0, lookY: 0, glow: 0.6, color: null },
  searching: { ...NEUTRAL, open: 0.7, joy: 0, lookX: 0.25, lookY: 0.18, glow: 0.6, color: '#8fc7ff', blink: 1.4 },
  excited: { ...NEUTRAL, open: 1, joy: 0.85, lookX: 0, lookY: 0.04, glow: 1, color: null, blink: 0.7 },
  alert: { ...NEUTRAL, open: 1.1, joy: 0, lookX: 0, lookY: 0, glow: 0.9, color: '#ff5a4f', blink: 2.2 },
  resting: { ...NEUTRAL, open: 0.12, joy: 0, lookX: 0, lookY: -0.12, glow: 0.25, color: null, blink: 3 },
  // Drooping: outer corners down, lids lower, eyes cast down, glow muted toward a grey-blue, head bowed a little.
  sad: { ...NEUTRAL, open: 0.62, joy: 0, lookX: 0, lookY: -0.2, glow: 0.28, color: '#a9b8d6', tilt: 0.3, pitch: 0.1, blink: 1.6 },
  // Asymmetric: one eye wider than the other, a slight head tilt and a glance up and aside.
  curious: { ...NEUTRAL, open: 1, joy: 0, lookX: 0.14, lookY: 0.1, glow: 0.7, color: null, scaleL: 1.2, scaleR: 0.8, roll: 0.12, blink: 1.25 },
}

/** What is left to say: the new part when the line carries on from what was said, otherwise the whole line. */
export function nextLine(said: string, text: string): string {
  if (!text) return ''
  return said && text.startsWith(said) ? text.slice(said.length).trim() : text.trim()
}

export const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The visitor's reduced-motion preference, kept up to date if they change it while the page is open. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(reducedMotion)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduced(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return reduced
}

/** WebGL 2 is there (the Clay Robot needs it). Without it, the dock shows only its button. */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!canvas.getContext('webgl2')
  } catch {
    return false
  }
}
