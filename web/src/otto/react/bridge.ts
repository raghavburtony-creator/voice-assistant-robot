// Pure mapping between React props and <otto-mascot>: attributes, event callbacks, and a handle that is safe to call
// before the element is defined. No React, no browser globals; types only from the element.

import type { ThemeName } from '../config'
import type { OttoMascotElement } from '../element/element'
import type { OttoEventMap, OttoState } from '../element/createOtto'
import type { RobotExpression } from '../robot/robot'

export type OttoAttributeProps = {
  state?: OttoState
  /** A face to hold; null or undefined: the state's own. */
  face?: RobotExpression | null
  theme?: ThemeName
  soundEnabled?: boolean
  movementEnabled?: boolean
  /** One key that activates Otto; null turns the hotkey off. */
  hotkey?: string | null
  /** Read once, when the element connects. */
  placement?: 'dock' | 'inline'
}

export type OttoAttributes = Partial<Record<'state' | 'face' | 'theme' | 'sound-enabled' | 'movement-enabled' | 'hotkey' | 'placement', string>>

/** Props to the element's attributes. Undefined props are left out, so the element keeps its own defaults. */
export function toAttributes(p: OttoAttributeProps): OttoAttributes {
  const out: OttoAttributes = {}
  if (p.state !== undefined) out.state = p.state
  if (p.face) out.face = p.face
  if (p.theme !== undefined) out.theme = p.theme
  if (p.soundEnabled !== undefined) out['sound-enabled'] = String(p.soundEnabled)
  if (p.movementEnabled !== undefined) out['movement-enabled'] = String(p.movementEnabled)
  // The element reads "none" (or "") as "no hotkey".
  if (p.hotkey !== undefined) out.hotkey = p.hotkey === null ? 'none' : p.hotkey
  if (p.placement !== undefined) out.placement = p.placement
  return out
}

/** Callback prop → the element event it listens to. */
export const EVENT_PROPS = {
  onReady: 'otto:ready',
  onStateChange: 'otto:statechange',
  onGestureStart: 'otto:gesturestart',
  onGestureEnd: 'otto:gestureend',
  onInterrupt: 'otto:interrupt',
  onError: 'otto:error',
  onActivate: 'otto:activate',
  onReaction: 'otto:reaction',
  onMove: 'otto:move',
  onGuide: 'otto:guide',
} as const satisfies Record<string, keyof OttoEventMap>

export type OttoCallbacks = { [P in keyof typeof EVENT_PROPS]?: (detail: OttoEventMap[(typeof EVENT_PROPS)[P]]) => void }

/** Listens for every Otto event on `target` and calls the latest callback from `latest()`. Returns the unsubscribe. */
export function listen(target: EventTarget, latest: () => OttoCallbacks): () => void {
  const offs = (Object.keys(EVENT_PROPS) as (keyof typeof EVENT_PROPS)[]).map((prop) => {
    const fn = (e: Event) => (latest()[prop] as ((detail: unknown) => void) | undefined)?.((e as CustomEvent).detail)
    target.addEventListener(EVENT_PROPS[prop], fn)
    return () => target.removeEventListener(EVENT_PROPS[prop], fn)
  })
  return () => offs.forEach((off) => off())
}

type Methods = 'playGesture' | 'playSound' | 'moveToX' | 'moveToElement' | 'goHome' | 'lookAt' | 'connectAudioNode'
  | 'speakText' | 'interrupt' | 'setFace' | 'setState' | 'notify' | 'task'

export type OttoMascotHandle = Pick<OttoMascotElement, Methods> & {
  /** The <otto-mascot> node while mounted (it may not be upgraded yet), else null. */
  readonly element: HTMLElement | null
}

/** A handle over whatever node `getNode` returns. Until that node is an upgraded <otto-mascot>, every method returns the
 *  element's own "not connected" fallback (false, Promise<false>, a no-op). */
export function createHandle(getNode: () => HTMLElement | null): OttoMascotHandle {
  const el = () => {
    const node = getNode()
    return node && 'playSound' in node ? (node as OttoMascotElement) : null
  }
  return {
    get element() { return getNode() },
    playGesture: (name, options) => el()?.playGesture(name, options),
    playSound: (cue) => el()?.playSound(cue) ?? false,
    moveToX: (x) => el()?.moveToX(x) ?? Promise.resolve(false),
    moveToElement: (place, options) => el()?.moveToElement(place, options) ?? Promise.resolve(false),
    goHome: () => el()?.goHome() ?? Promise.resolve(false),
    lookAt: (place, seconds) => el()?.lookAt(place, seconds),
    connectAudioNode: (node) => el()?.connectAudioNode(node) ?? (() => {}),
    speakText: (text, options) => el()?.speakText(text, options) ?? Promise.resolve(false),
    interrupt: () => el()?.interrupt(),
    setFace: (face) => el()?.setFace(face),
    setState: (state) => el()?.setState(state),
    notify: (event) => el()?.notify(event),
    task: (id, details) => el()?.task(id, details) ?? { succeed() {}, fail() {}, done() {} },
  }
}
