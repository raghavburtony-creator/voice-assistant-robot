// <otto-mascot>: Otto as a custom element, for any page or framework (vanilla, React, Vue, Svelte...).
//
//   <script type="module" src="otto-mascot.js"></script>
//   <otto-mascot theme="midnight" state="idle"></otto-mascot>
//   <script> const otto = document.querySelector('otto-mascot'); otto.addEventListener('otto:ready', () => otto.playGesture('welcomeWave')) </script>
//
// Attributes (reactive): state, face, theme, sound-enabled, movement-enabled, hotkey, and placement ("dock" or "inline"; read
// when it connects). The `config` property takes a full override object. Methods mirror createOtto's controller. Events
// (otto:ready, otto:statechange, otto:gesturestart, otto:gestureend, otto:interrupt, otto:error, otto:activate,
// otto:reaction, otto:move, otto:guide) bubble and cross the shadow boundary. Removing the element disposes everything; adding it
// back starts again.

import type { OttoEvent, TaskHandle } from '../awareness/events'
import { isThemeName, type DeepPartial, type OttoConfig } from '../config'
import type { GuideRequest, GuideTaskHandle, OttoGuide } from '../guidance/guide'
import type { GuideTaskSpec } from '../guidance/task'
import type { StagePlace } from '../movement/stage'
import { isGestureName, type GestureName } from '../robot/gestures'
import { FACES, type RobotExpression } from '../robot/robot'
import type { SoundCue } from '../sound'
import { createOtto, type OttoController, type OttoEventMap, type OttoState, type SpeakOptions } from './createOtto'

const STATES: readonly OttoState[] = ['idle', 'listening', 'thinking', 'talking']
const isState = (v: unknown): v is OttoState => typeof v === 'string' && (STATES as readonly string[]).includes(v)
const isFace = (v: unknown): v is RobotExpression => typeof v === 'string' && v in FACES
const flag = (v: string | null) => (v === null ? undefined : v !== 'false' && v !== '0' && v !== 'off')

const ATTRIBUTES = ['state', 'face', 'theme', 'sound-enabled', 'movement-enabled', 'hotkey', 'placement'] as const

export class OttoMascotElement extends HTMLElement {
  static readonly observedAttributes = ATTRIBUTES
  private otto: OttoController | null = null
  private extra: DeepPartial<OttoConfig> = {}

  /** The controller while connected (null otherwise), for anything the element does not mirror. */
  get controller(): OttoController | null { return this.otto }

  /** Overrides on the defaults (deep-merged); attributes go on top. */
  get config(): DeepPartial<OttoConfig> { return this.extra }
  set config(value: DeepPartial<OttoConfig>) {
    this.extra = value ?? {}
    this.otto?.replaceConfig(this.fromAttributes())
  }

  connectedCallback() {
    if (this.otto && !this.otto.disposed) return
    // A property set before the element was defined shadows the setter: take it over.
    const own = Object.getOwnPropertyDescriptor(this, 'config')
    if (own) { delete (this as { config?: unknown }).config; this.extra = own.value ?? {} }
    this.otto = createOtto(this, { config: this.fromAttributes(), placement: this.getAttribute('placement') === 'inline' ? 'inline' : 'dock' })
    const state = this.getAttribute('state'), face = this.getAttribute('face')
    if (isState(state)) this.otto.setState(state)
    if (isFace(face)) this.otto.setFace(face)
  }

  disconnectedCallback() {
    this.otto?.dispose()
    this.otto = null
  }

  attributeChangedCallback(name: (typeof ATTRIBUTES)[number], _old: string | null, value: string | null) {
    const otto = this.otto
    if (!otto) return
    if (name === 'state') { if (isState(value)) otto.setState(value); else if (value === null) otto.setState('idle') }
    else if (name === 'face') otto.setFace(isFace(value) ? value : null)
    else if (name !== 'placement') otto.replaceConfig(this.fromAttributes())
  }

  private fromAttributes(): DeepPartial<OttoConfig> {
    const theme = this.getAttribute('theme')
    const sound = flag(this.getAttribute('sound-enabled'))
    const movement = flag(this.getAttribute('movement-enabled'))
    const hotkey = this.getAttribute('hotkey')
    const out: DeepPartial<OttoConfig> = { ...this.extra }
    if (isThemeName(theme)) out.theme = theme
    if (sound !== undefined) out.sound = { ...out.sound, soundEnabled: sound }
    if (movement !== undefined) out.movement = { ...out.movement, movementEnabled: movement }
    if (hotkey !== null) out.hotkey = hotkey === '' || hotkey === 'none' ? null : hotkey.slice(0, 1)
    return out
  }

  // The controller's methods. Before the element is connected they do nothing (and the promises resolve false).
  get state(): OttoState { return this.otto?.state ?? (isState(this.getAttribute('state')) ? this.getAttribute('state') as OttoState : 'idle') }
  setState(state: OttoState) { if (isState(state)) this.setAttribute('state', state) }
  setFace(face: RobotExpression | null) { if (face === null) this.removeAttribute('face'); else if (isFace(face)) this.setAttribute('face', face) }
  playGesture(name: GestureName, options?: { intensity?: number; force?: boolean }) { if (isGestureName(name)) this.otto?.playGesture(name, options) }
  stopGestures() { this.otto?.stopGestures() }
  playSound(cue: SoundCue): boolean { return this.otto?.playSound(cue) ?? false }
  moveToX(normalized: number): Promise<boolean> { return this.otto?.moveToX(normalized) ?? Promise.resolve(false) }
  moveToElement(place: StagePlace, options?: { follow?: boolean }): Promise<boolean> { return this.otto?.moveToElement(place, options) ?? Promise.resolve(false) }
  goHome(): Promise<boolean> { return this.otto?.goHome() ?? Promise.resolve(false) }
  stopMoving() { this.otto?.stopMoving() }
  lookAt(place: StagePlace | null, seconds?: number) { this.otto?.lookAt(place, seconds) }
  connectAudioNode(node: AudioNode): () => void { return this.otto?.connectAudioNode(node) ?? (() => {}) }
  speakText(text: string, options?: SpeakOptions): Promise<boolean> { return this.otto?.speakText(text, options) ?? Promise.resolve(false) }
  interrupt() { this.otto?.interrupt() }
  notify(event: OttoEvent) { this.otto?.notify(event) }
  task(id: string, details?: Omit<OttoEvent, 'type' | 'task'>): TaskHandle {
    return this.otto?.task(id, details) ?? { succeed() {}, fail() {}, done() {} }
  }
  /** The guide channel while connected (null otherwise). */
  get guide(): OttoGuide | null { return this.otto?.guide ?? null }
  showTarget(target: string | GuideRequest) { this.otto?.showTarget(target) }
  /** Throws before the element is connected: a task cannot be walked through by an Otto who is not there. */
  startGuide(spec: GuideTaskSpec): GuideTaskHandle {
    if (!this.otto) throw new Error('otto-mascot is not connected yet')
    return this.otto.startGuide(spec)
  }
}

/** Defines <otto-mascot> once; safe to call any number of times, from any number of bundles. */
export function defineOttoMascot(tag = 'otto-mascot') {
  if (typeof customElements === 'undefined') return
  if (!customElements.get(tag)) customElements.define(tag, tag === 'otto-mascot' ? OttoMascotElement : class extends OttoMascotElement {})
}

type OttoDomEvents = { [K in keyof OttoEventMap]: CustomEvent<OttoEventMap[K]> }

declare global {
  interface HTMLElementTagNameMap { 'otto-mascot': OttoMascotElement }
  // `addEventListener('otto:gestureend', e => e.detail.name)` is typed, on the element and on any ancestor.
  interface HTMLElementEventMap extends OttoDomEvents {}
  interface DocumentEventMap extends OttoDomEvents {}
  interface WindowEventMap extends OttoDomEvents {}
}
