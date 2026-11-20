// What the browser can do for the robot: the reduced-motion preference and WebGL 2. Kept apart from robot.ts (pure data).

import { useEffect, useState } from 'react'

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

let webgl: boolean | null = null
/**
 * WebGL 2 is there (the Clay Robot needs it). Without it, the dock shows only its button. Asked once per page: the probe's
 * context is released at once, so mounting Otto again and again never piles up WebGL contexts (browsers allow ~16).
 */
export function hasWebGL(): boolean {
  if (webgl !== null) return webgl
  try {
    const canvas = document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    webgl = !!gl
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
  } catch {
    webgl = false
  }
  return webgl
}
