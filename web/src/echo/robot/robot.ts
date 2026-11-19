// Echo's robot: shared types, where the model is, and how each face and pose looks.
// The model is built by blender/build_echo.py and served from public/echo/echo.glb.

export type RobotPose = 'idle' | 'listening' | 'talking' | 'thinking'
export type RobotExpression = 'happy' | 'searching' | 'excited' | 'alert' | 'resting'

export const ROBOT_MODEL = `${import.meta.env.BASE_URL}echo/echo.glb`

/** Characters a second for the speech bubble: about the pace of the Gemini voice. */
export const SPEAK_CPS = 16

/** How the eyes look for each face: width, height and where they look (x, y), in the eye's own units. */
export type EyeShape = { sx: number; sy: number; lookX: number; lookY: number }

export const EYES: Record<RobotExpression, EyeShape> = {
  happy: { sx: 1, sy: 1, lookX: 0, lookY: 0 },
  searching: { sx: 1, sy: 0.75, lookX: 0.035, lookY: 0.03 },
  excited: { sx: 1.15, sy: 1.2, lookX: 0, lookY: 0.01 },
  alert: { sx: 0.85, sy: 1.35, lookX: 0, lookY: 0 },
  resting: { sx: 1.15, sy: 0.14, lookX: 0, lookY: -0.03 },
}

/** The glow colour for each face (null: the configured glow colour), and how bright it is. */
export const GLOW: Record<RobotExpression, { color: string | null; intensity: number }> = {
  happy: { color: null, intensity: 3.5 },
  searching: { color: '#8fc7ff', intensity: 3.5 },
  excited: { color: null, intensity: 5 },
  alert: { color: '#ff5a4f', intensity: 4.5 },
  resting: { color: null, intensity: 1.2 },
}

/** What is left to say: the new part when the line carries on from what was said, otherwise the whole line. */
export function nextLine(said: string, text: string): string {
  if (!text) return ''
  return said && text.startsWith(said) ? text.slice(said.length).trim() : text.trim()
}

export const reducedMotion = () =>
  typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** WebGL is there (the robot needs it). Without it, the dock shows only its button. */
export function hasWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'))
  } catch {
    return false
  }
}
