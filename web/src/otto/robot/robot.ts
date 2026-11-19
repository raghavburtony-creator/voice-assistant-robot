// Otto's robot: shared types, and how each face looks on the Clay Robot's screen
// (web/src/components/originkit/ui/clay-robot.tsx, driven by ClayScene.tsx).

import { useEffect, useState } from 'react'

export type RobotPose = 'idle' | 'listening' | 'talking' | 'thinking'
export type RobotExpression = 'happy' | 'searching' | 'excited' | 'alert' | 'resting'

/** Characters a second for the speech bubble: about the pace of the Gemini voice. */
export const SPEAK_CPS = 16

/**
 * How the eyes look for each face: how open (1 = the robot's own), how much they bend into happy arcs (0..1), where
 * they look on the screen (head units), how strongly they glow, and their colour (null: ROBOT_COLORS.eyes).
 */
export type FaceShape = { open: number; joy: number; lookX: number; lookY: number; glow: number; color: string | null }

export const FACES: Record<RobotExpression, FaceShape> = {
  happy: { open: 1, joy: 0, lookX: 0, lookY: 0, glow: 0.6, color: null },
  searching: { open: 0.7, joy: 0, lookX: 0.25, lookY: 0.18, glow: 0.6, color: '#8fc7ff' },
  excited: { open: 1, joy: 0.85, lookX: 0, lookY: 0.04, glow: 1, color: null },
  alert: { open: 1.1, joy: 0, lookX: 0, lookY: 0, glow: 0.9, color: '#ff5a4f' },
  resting: { open: 0.12, joy: 0, lookX: 0, lookY: -0.12, glow: 0.25, color: null },
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
