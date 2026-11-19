// Otto anywhere, without React in the host page: createOtto(container, options) mounts the whole mascot (robot, stage,
// gestures, sound, lip-sync, idle life, awareness) into a shadow root on `container` and returns a controller. The
// <otto-mascot> element (element.ts) is a thin wrapper over this.
//
//   const otto = createOtto(document.body, { config: { theme: 'midnight' } })
//   otto.playGesture('celebrate'); await otto.moveToElement('#cart'); otto.notify({ type: 'success', where: '#cart' })
//   otto.dispose()
//
// Loading: nothing heavy runs at mount. The React tree mounts when the browser is idle (or after 1.5 s at most), and the
// robot's WebGL code is its own chunk, fetched after that. Everything is released by dispose(): React unmounts (the robot
// cancels its frame loop, disconnects its observers and gives its WebGL context back), sound contexts close, the audio tap
// is disconnected, and every listener this file added is removed.

import { StrictMode, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createOttoEvents, type OttoEvent, type OttoEvents, type TaskHandle } from '../awareness/events'
import type { Reaction } from '../awareness/reactions'
import { defineOttoConfig, OttoConfigProvider, useOttoConfig, type DeepPartial, type OttoConfig, type ThemeName } from '../config'
import { analyserMouth, fakeMouth, type MouthSource } from '../mouth'
import type { StageController, StagePlace } from '../movement/stage'
import { createOttoStage } from '../movement/useStage'
import OttoStage from '../OttoStage'
import { createGestureChannel, type GestureChannel, type GestureEndReason, type GestureName } from '../robot/gestures'
import type { RobotExpression, RobotPose } from '../robot/robot'
import type { SoundController, SoundCue } from '../sound'
import { useGestureSounds } from '../useGestureSounds'
import css from './mascot.css?inline'

export type OttoState = RobotPose

/** The detail of each event Otto dispatches on his container (bubbling, composed). */
export type OttoEventMap = {
  'otto:ready': { otto: OttoController }
  'otto:statechange': { state: OttoState; previous: OttoState }
  'otto:gesturestart': { name: GestureName; held: boolean }
  'otto:gestureend': { name: GestureName; held: boolean; reason: GestureEndReason }
  'otto:interrupt': { reason: 'api' }
  'otto:error': { reason: 'no-webgl' | 'failed'; message: string }
  /** The visitor clicked Otto, pressed his hotkey, or used his keyboard button. */
  'otto:activate': { via: 'click' | 'hotkey' | 'button' }
  /** Otto decided how to react to an event (size 'none' when he let it pass), and why. */
  'otto:reaction': { event: OttoEvent; reaction: Reaction }
  'otto:move': { type: 'depart' | 'arrive' | 'cancel'; x: number }
}

export type CreateOttoOptions = {
  /** Overrides on the defaults, theme preset included (`{ theme: 'cyber', colors: { eyes: '#fff' } }`). */
  config?: DeepPartial<OttoConfig>
  /** 'dock' (default): Otto stands along the bottom of the viewport. 'inline': inside the container's own box. */
  placement?: 'dock' | 'inline'
  /** Mount at once instead of when the browser is idle. */
  eager?: boolean
}

export type SpeakOptions = {
  /** How long to take (ms). Default: about 15 characters a second. */
  durationMs?: number
  /** Also say it aloud with the browser's own speech synthesis (the mouth is then procedural: the browser gives no audio to read). */
  voice?: boolean
}

export type OttoController = {
  readonly container: HTMLElement
  readonly events: OttoEvents
  readonly stage: StageController
  readonly gestures: GestureChannel
  setState(state: OttoState): void
  readonly state: OttoState
  /** A face to hold (null: back to the state's own, with passing moods from events). */
  setFace(face: RobotExpression | null): void
  setTheme(theme: ThemeName): void
  /** Merges into the current overrides (deeply) and applies them. */
  setConfig(overrides: DeepPartial<OttoConfig>): void
  /** Replaces the overrides outright. */
  replaceConfig(overrides: DeepPartial<OttoConfig>): void
  readonly config: OttoConfig
  playGesture(name: GestureName, options?: { intensity?: number; force?: boolean }): void
  stopGestures(): void
  /** False when sound is off, the volume is 0, or the visitor has not clicked or pressed a key yet. */
  playSound(cue: SoundCue): boolean
  moveToX(normalized: number): Promise<boolean>
  moveToElement(place: StagePlace, options?: { follow?: boolean }): Promise<boolean>
  goHome(): Promise<boolean>
  stopMoving(): void
  lookAt(place: StagePlace | null, seconds?: number): void
  /** Lip-sync to any Web Audio node (your TTS, a media element source...). While it sounds, Otto talks. Returns a disconnect. */
  connectAudioNode(node: AudioNode): () => void
  /** Show `text` in the bubble and for screen readers, mouthing it. Resolves true when done, false if interrupted. */
  speakText(text: string, options?: SpeakOptions): Promise<boolean>
  /** Cut Otto off: speech stops, the bubble goes, gestures stop and he nods; dispatches otto:interrupt. */
  interrupt(): void
  /** Tell Otto something happened in the app (see awareness/events.ts). */
  notify(event: OttoEvent): void
  task(id: string, details?: Omit<OttoEvent, 'type' | 'task'>): TaskHandle
  dispose(): void
  readonly disposed: boolean
}

type ViewProps = {
  config: OttoConfig
  stage: StageController
  gestures: GestureChannel
  events: OttoEvents
  placement: 'dock' | 'inline'
  pose: RobotPose
  face: RobotExpression | null
  say: string
  mouth: MouthSource
  speech: (() => { played: number; received: number } | null) | undefined
  onSound: (sound: { current: SoundController | null }) => void
  onReady: () => void
  onActivate: (via: 'click' | 'button') => void
  onError: (reason: 'no-webgl' | 'failed') => void
  onReaction: (event: OttoEvent, reaction: Reaction) => void
}

function View(props: ViewProps) {
  return <OttoConfigProvider config={props.config}><Inner {...props} /></OttoConfigProvider>
}

function Inner({ stage, gestures, events, placement, pose, face, say, mouth, speech, onSound, onReady, onActivate, onError, onReaction }: ViewProps) {
  const { name } = useOttoConfig()
  const sound = useGestureSounds(gestures)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => { onSound(sound) }, [sound, onSound])
  useEffect(() => { onReady() }, [onReady])
  return (
    <div className="otto-root" ref={box}>
      <OttoStage className={placement === 'inline' ? 'otto-stage--inline' : undefined} container={placement === 'inline' ? box : null}
        stage={stage} pose={pose} expression={face ?? (pose === 'thinking' ? 'searching' : pose === 'talking' ? 'excited' : 'happy')}
        say={say} mouth={mouth} speech={speech} gestures={gestures} events={events} busy={pose !== 'idle'}
        conversing={pose === 'listening' || pose === 'talking'}
        onActivate={() => onActivate('click')} onRobotError={onError} onReaction={onReaction}>
        <button type="button" className="otto-trigger" onClick={() => onActivate('button')}>{name}</button>
      </OttoStage>
    </div>
  )
}

const idle = (fn: () => void): (() => void) => {
  if (typeof requestIdleCallback === 'function') { const id = requestIdleCallback(fn, { timeout: 1500 }); return () => cancelIdleCallback(id) }
  const id = window.setTimeout(fn, 1); return () => window.clearTimeout(id)
}

export function createOtto(container: HTMLElement, options: CreateOttoOptions = {}): OttoController {
  let overrides: DeepPartial<OttoConfig> = options.config ?? {}
  let config = defineOttoConfig(overrides)
  const placement = options.placement ?? 'dock'

  // The shadow root: the container's own (an <otto-mascot>), or a new one; a container that cannot have one (an <img>,
  // say) gets Otto in its light DOM, with the styles still scoped by class names.
  let shadow: ShadowRoot | HTMLElement
  try { shadow = container.shadowRoot ?? container.attachShadow({ mode: 'open' }) } catch { shadow = container }
  const style = document.createElement('style')
  style.textContent = css
  const mount = document.createElement('div')
  shadow.append(style, mount)

  const events = createOttoEvents()
  const gestures = createGestureChannel()
  const stage = createOttoStage(config)
  let sound: { current: SoundController | null } = { current: null }

  // State that renders.
  let pose: RobotPose = 'idle'
  let held: RobotExpression | null = null
  let say = ''
  let speaking: { cancel: () => void } | null = null
  let fake: MouthSource | null = null
  let tap: { analyser: AnalyserNode; mouth: MouthSource; node: AudioNode; timer: number } | null = null
  let tapTalking = false
  let speechClock: ViewProps['speech']
  let root: Root | null = null
  let disposed = false
  const cleanups: (() => void)[] = []

  const dispatch = <K extends keyof OttoEventMap>(type: K, detail: OttoEventMap[K]) => {
    if (!disposed) container.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }))
  }

  // One mouth for whichever voice is on: speakText's procedural one, or the connected audio node.
  const mouth: MouthSource = () => (fake ? fake() : tap ? tap.mouth() : null)
  const shownPose = (): RobotPose => (pose === 'idle' && (speaking || tapTalking) ? 'talking' : pose)

  const ready = () => { if (!readied) { readied = true; dispatch('otto:ready', { otto: controller }) } }
  let readied = false
  const onSound = (s: { current: SoundController | null }) => { sound = s }
  const onActivate = (via: 'click' | 'button') => dispatch('otto:activate', { via })
  const onError = (reason: 'no-webgl' | 'failed') =>
    dispatch('otto:error', { reason, message: reason === 'no-webgl' ? 'WebGL 2 is not available: Otto is not drawn, his words still are.' : 'The robot could not be drawn.' })
  const onReaction = (event: OttoEvent, reaction: Reaction) => dispatch('otto:reaction', { event, reaction })

  function render() {
    if (!root || disposed) return
    root.render(<StrictMode><View config={config} stage={stage} gestures={gestures} events={events} placement={placement}
      pose={shownPose()} face={held} say={say} mouth={mouth} speech={speechClock} onSound={onSound} onReady={ready}
      onActivate={onActivate} onError={onError} onReaction={onReaction} /></StrictMode>)
  }

  const start = () => {
    if (disposed || root) return
    root = createRoot(mount)
    render()
  }
  if (options.eager) start()
  else cleanups.push(idle(start))

  // Gesture and movement events, out to the page.
  cleanups.push(gestures.onEvent(e => {
    if (e.type === 'start') dispatch('otto:gesturestart', { name: e.name, held: e.held })
    else dispatch('otto:gestureend', { name: e.name, held: e.held, reason: e.reason })
  }))
  cleanups.push(stage.onEvent(e => { if (e.type !== 'hidden') dispatch('otto:move', { type: e.type, x: e.type === 'depart' ? e.to : e.x }) }))

  // The hotkey: Alt+<key>, matched by physical key, except while typing in a field.
  const onKey = (event: KeyboardEvent) => {
    const key = config.hotkey
    if (!key || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const code = /^\d$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`
    if (event.code !== code) return
    const target = event.target as HTMLElement | null
    if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return
    event.preventDefault()
    dispatch('otto:activate', { via: 'hotkey' })
  }
  window.addEventListener('keydown', onKey)
  cleanups.push(() => window.removeEventListener('keydown', onKey))

  function setState(next: RobotPose) {
    if (next === pose) return
    const previous = pose
    pose = next
    render()
    dispatch('otto:statechange', { state: next, previous })
  }

  function endSpeech() {
    speaking = null
    fake = null
    say = ''
    speechClock = undefined
    render()
  }

  const controller: OttoController = {
    container, events, stage, gestures,
    get state() { return pose },
    get config() { return config },
    get disposed() { return disposed },
    setState,
    setFace(face) { held = face; render() },
    setTheme(theme) { controller.setConfig({ theme }) },
    setConfig(next) { controller.replaceConfig(mergeOverrides(overrides, next)) },
    replaceConfig(next) {
      overrides = next
      config = defineOttoConfig(overrides)
      render()
    },
    playGesture: (name, opts) => gestures.play(name, opts),
    stopGestures: () => gestures.stop(),
    playSound: cue => sound.current?.play(cue) ?? false,
    moveToX: n => stage.moveToX(n),
    moveToElement: (place, opts) => stage.moveToElement(place, opts),
    goHome: () => stage.goHome(),
    stopMoving: () => stage.stop(),
    lookAt: (place, seconds) => stage.lookAt(place, seconds),

    connectAudioNode(node) {
      disconnectTap()
      const analyser = node.context.createAnalyser()
      node.connect(analyser) // a tap: the node still plays wherever the page sends it
      const level = new Float32Array(analyser.fftSize)
      let quietSince = 0
      // Talks while it sounds (a cheap level check, 10 times a second); the mouth itself reads the speech bands.
      const timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(level)
        let sum = 0
        for (let i = 0; i < level.length; i++) sum += level[i] * level[i]
        const loud = Math.sqrt(sum / level.length) > 0.01
        const now = performance.now()
        if (loud) quietSince = 0
        else if (!quietSince) quietSince = now
        const talking = loud || (quietSince > 0 && now - quietSince < 400)
        if (talking !== tapTalking) { tapTalking = talking; render() }
      }, 100)
      tap = { analyser, node, timer, mouth: analyserMouth(analyser, () => tapTalking) }
      return disconnectTap
    },

    speakText(text, opts = {}) {
      speaking?.cancel()
      const clean = text.trim()
      if (!clean || disposed) return Promise.resolve(false)
      const ms = Math.max(800, opts.durationMs ?? (clean.length / 15) * 1000)
      const began = performance.now()
      let estimate = ms
      return new Promise<boolean>(resolve => {
        let timer: number | undefined
        let finished = false
        const finish = (done: boolean) => {
          if (finished) return
          finished = true
          window.clearTimeout(timer)
          if (speaking === handle) endSpeech()
          resolve(done)
        }
        const handle = {
          cancel: () => {
            if (utterance) speechSynthesis.cancel()
            finish(false)
          },
        }
        let utterance: SpeechSynthesisUtterance | null = null
        if (opts.voice && typeof speechSynthesis !== 'undefined') {
          utterance = new SpeechSynthesisUtterance(clean)
          utterance.onend = () => finish(true)
          utterance.onerror = () => finish(false)
          // Without the browser's own timing, the estimate is stretched as long as it keeps talking.
          timer = window.setTimeout(() => { estimate = Infinity }, ms)
          speechSynthesis.speak(utterance)
        } else timer = window.setTimeout(() => finish(true), ms)
        speaking = handle
        fake = fakeMouth()
        say = clean
        speechClock = () => {
          const played = (performance.now() - began) / 1000
          const total = estimate === Infinity ? played + 1 : estimate / 1000
          return { played: Math.min(played, total), received: total }
        }
        render()
      })
    },

    interrupt() {
      speaking?.cancel()
      gestures.stop()
      if (config.gestures.onInterrupt) gestures.play(config.gestures.onInterrupt, { force: true })
      if (pose === 'talking') setState('listening')
      // The page's own audio (connectAudioNode) is the page's to stop: this event is its cue.
      dispatch('otto:interrupt', { reason: 'api' })
    },

    notify: event => events.notify(event),
    task: (id, details) => events.task(id, details),

    dispose() {
      if (disposed) return
      speaking?.cancel()
      disconnectTap()
      disposed = true
      cleanups.forEach(fn => fn())
      cleanups.length = 0
      // Synchronous, so the WebGL context and audio are gone by the time dispose() returns.
      root?.unmount()
      root = null
      mount.remove()
      style.remove()
    },
  }

  function disconnectTap() {
    if (!tap) return
    window.clearInterval(tap.timer)
    try { tap.node.disconnect(tap.analyser) } catch { /* already disconnected */ }
    tap.analyser.disconnect()
    tap = null
    if (tapTalking) { tapTalking = false; render() }
  }

  return controller
}

/** Merges override objects the way the config merges (deep, arrays replaced). */
function mergeOverrides(a: DeepPartial<OttoConfig>, b: DeepPartial<OttoConfig>): DeepPartial<OttoConfig> {
  const out: Record<string, unknown> = { ...a }
  for (const [k, v] of Object.entries(b)) {
    const was = out[k]
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && was && typeof was === 'object' && !Array.isArray(was)
      ? mergeOverrides(was as DeepPartial<OttoConfig>, v as DeepPartial<OttoConfig>) : v
  }
  return out as DeepPartial<OttoConfig>
}
