// Loading and driving the 3D robot that draws Echo: the myt Learning Hub's <robot-companion>, vendored in public/robot/
// (read public/robot/README.md before using it in a new project). Loaded once, after the first render, never from another site.

export type RobotPose = 'idle' | 'listening' | 'talking' | 'thinking'
export type RobotExpression = 'happy' | 'searching' | 'excited' | 'alert' | 'resting'

export const ROBOT_TAG = 'robot-companion'
const BASE = import.meta.env.BASE_URL
export const ROBOT_SCRIPT = `${BASE}robot/robot-companion.js`
export const ROBOT_THREE = `${BASE}robot/vendor/three.module.min.js`
export const ROBOT_LOGO = `${BASE}robot/echo-logo.png`

/** Characters a second for a spoken line in the bubble: about the pace of the Gemini voice. */
export const SPEAK_CPS = 16

let loading: Promise<boolean> | null = null

/** Adds the robot's script to the page once. Resolves true when the element is defined, false where custom elements are missing. */
export function loadRobot(): Promise<boolean> {
  if (loading) return loading
  const registry = typeof window === 'undefined' ? undefined : window.customElements
  if (!registry) return (loading = Promise.resolve(false))
  if (!registry.get(ROBOT_TAG) && !document.querySelector('script[data-robot]')) {
    const script = document.createElement('script')
    script.src = ROBOT_SCRIPT
    script.async = true
    script.dataset.robot = ''
    document.head.append(script)
  }
  loading = registry.whenDefined(ROBOT_TAG).then(() => true)
  return loading
}

/** Expressions as the robot's faces. The robot also has 'sad', 'angry', 'wink' and others: see robot-companion.js. */
export const FACE_FOR: Record<RobotExpression, string> = {
  happy: 'neutral',
  searching: 'think',
  excited: 'happy',
  alert: 'surprised',
  resting: 'sleepy',
}

/** A gesture as Echo changes what it is doing. Talking is the mouth; idle is the robot's own breathing. */
export const GESTURE_FOR: Record<RobotPose, string | null> = {
  idle: null,
  listening: 'nod',
  thinking: 'think',
  talking: null,
}

/** What is left to say: the new part when the line carries on from what was said, otherwise the whole line. */
export function nextLine(said: string, text: string): string {
  if (!text) return ''
  return said && text.startsWith(said) ? text.slice(said.length).trim() : text.trim()
}
