// Wires a live voice session into Otto: the model's audio to his lip-sync, its words to his bubble, the session's life to
// his face, gestures and sounds. No React, no element code, no SDK: it drives any object shaped like VoiceBridgeTarget
// (<otto-mascot>, createOtto()'s controller, the React handle).

import type { OttoController, OttoState } from '../element/createOtto'
import type { GestureName } from '../robot/gestures'
import type { RobotExpression } from '../robot/robot'
import type { SoundCue } from '../soundCues'
import { SpeechPlayer, startRecorder, type Recorder } from '../audio'
import { DEFAULT_VAD, VoiceActivityDetector, type VadSettings } from './vad'
import type { VoiceDiagnostic } from '../speechGate'
import { createChannelSplitter, type VisualPart } from './channels'
import { openTransport, parseLiveMessage, assertNoApiKey, assertSecureProxyUrl, type BridgeEvent, type Transport, type TransportOptions } from './transports'

/** The part of Otto the bridge drives. */
export type VoiceBridgeTarget = Pick<OttoController, 'connectAudioNode' | 'speakText' | 'interrupt' | 'playGesture' | 'playSound' | 'setFace' | 'setState'>

export type BridgeState = 'idle' | 'connecting' | 'open' | 'closed'

export type GeminiVoiceBridgeOptions = {
  /** Omit for transport-less mode: you run the session (e.g. @google/genai's ai.live.connect) and call feed(message). */
  transport?: TransportOptions
  /** Open the microphone on connect() (call connect from a click). Default false. */
  microphone?: boolean
  /** Sent to the proxy in its start message. Default 'en'. */
  language?: string
  /** Sent to the proxy in its start message; the server falls back to its first page. */
  page?: string
  /** Show the model's words in Otto's bubble. Default true. The bubble gets the spoken channel only: no URLs, code or
   *  markdown symbols (channels.ts). */
  showText?: boolean
  /** End-of-turn detection on the microphone; override any part. Pass `false` to leave turn-taking to the server. */
  vad?: Partial<VadSettings> | false
  /** Privacy-safe voice events for your own log: speech start and end, the noise floor, turn complete, and why an interruption
   *  was accepted or rejected. Levels, durations and reasons only, never audio. */
  onDiagnostic?: (event: VoiceDiagnostic) => void
  /** Every frame's input level (RMS 0..1) while the detector listens, for a meter. */
  onLevel?: (rms: number) => void
  /** The visual channel: code blocks and links taken out of the model's words, for your own panel. Links are untrusted
   *  model output: check one against your own allow-list before making it clickable (D-02). */
  onVisual?: (parts: VisualPart[]) => void
  onError?: (error: Error) => void
  onState?: (state: BridgeState) => void
}

export type GeminiVoiceBridge = {
  /** Call from a click: audio and the microphone need a user gesture. Resolves once the session is ready. */
  connect(): Promise<void>
  /** Hand the bridge one Gemini Live server message (transport-less mode). */
  feed(message: unknown): void
  sendText(text: string): void
  startMic(): Promise<void>
  stopMic(): void
  /** Releases everything: socket, audio context and nodes, recorder, Otto's audio tap. Safe to call twice. */
  close(): void
  readonly state: BridgeState
}

export type OttoAction =
  | { do: 'gesture'; name: GestureName }
  | { do: 'face'; face: RobotExpression }
  | { do: 'sound'; cue: SoundCue }
  | { do: 'state'; state: OttoState }
  | { do: 'interrupt' }
  | { do: 'stopAudio' }

/**
 * What Otto does for each event. `audible`: his voice is sounding right now. The mic is held back then (D-05), so user
 * speech arriving while he is audible is a late transcript of earlier words, not a barge-in: barge-in is 'interrupted'.
 */
export function mapEvent(event: BridgeEvent, audible: boolean): OttoAction[] {
  switch (event.type) {
    case 'ready': return [{ do: 'gesture', name: 'welcomeWave' }, { do: 'face', face: 'happy' }, { do: 'state', state: 'listening' }]
    case 'userSpeech':
      return audible ? [] : [{ do: 'state', state: 'listening' }]
    case 'interrupted': return [{ do: 'interrupt' }, { do: 'stopAudio' }, { do: 'state', state: 'listening' }]
    case 'thinking': return [{ do: 'state', state: 'thinking' }, { do: 'gesture', name: 'thinkingHand' }]
    case 'audio': return [{ do: 'state', state: 'talking' }]
    case 'turnComplete': return [{ do: 'state', state: 'listening' }]
    case 'error': return [{ do: 'face', face: 'alert' }, { do: 'sound', cue: 'chirpNegative' }]
    case 'closed': return [{ do: 'gesture', name: 'goodbyeWave' }, { do: 'face', face: 'resting' }, { do: 'state', state: 'idle' }]
    case 'text': return []
  }
}

export function createGeminiVoiceBridge(otto: VoiceBridgeTarget, options: GeminiVoiceBridgeOptions = {}): GeminiVoiceBridge {
  assertNoApiKey(options)
  if (options.transport) assertNoApiKey(options.transport)
  if (options.transport?.type === 'proxy') assertSecureProxyUrl(options.transport.url)
  let state: BridgeState = 'idle'
  let transport: Transport | null = null
  let player: SpeechPlayer | null = null
  let disconnectAudio: (() => void) | null = null
  let recorder: Recorder | null = null
  let detector: VoiceActivityDetector | null = null
  let micAttempt = 0
  let roomFloor: number | undefined // the noise floor the last detector learned: a reopened mic starts knowing the room
  let micWanted = false // set once the mic is open, cleared by stopMic() and a no-speech cancel; gates the reopen after a turn
  let said = ''
  const split = createChannelSplitter()
  const spoken = (text: string) => { if (text) said = said ? `${said} ${text}` : text }
  const visual = (parts: VisualPart[]) => { if (parts.length) options.onVisual?.(parts) }
  let settle: { resolve: () => void; reject: (e: Error) => void } | null = null

  const setState = (next: BridgeState) => { if (state !== next) { state = next; options.onState?.(next) } }

  const ensureAudio = () => {
    if (player) return player
    player = new SpeechPlayer()
    void player.resume()
    disconnectAudio = otto.connectAudioNode(player.output)
    return player
  }

  const apply = (a: OttoAction) => {
    switch (a.do) {
      case 'gesture': otto.playGesture(a.name); break
      case 'face': otto.setFace(a.face); break
      case 'sound': otto.playSound(a.cue); break
      case 'state': otto.setState(a.state); break
      case 'interrupt': otto.interrupt(); break
      case 'stopAudio': player?.interrupt(); said = ''; split.reset(); break
    }
  }

  const release = () => {
    micWanted = false
    haltMic()
    const t = transport; transport = null; t?.close()
    disconnectAudio?.(); disconnectAudio = null
    player?.close(); player = null
  }

  const haltMic = () => {
    micAttempt++
    detector?.dispose(); detector = null
    recorder?.stop(); recorder = null
  }

  const startDetector = () => {
    if (!recorder || options.vad === false) return
    detector?.dispose()
    // Text and the microphone are separate inputs: this only decides when the visitor's *voice* turn ends.
    const settings = { ...DEFAULT_VAD, ...options.vad }
    detector = new VoiceActivityDetector(recorder.stream, settings, {
      onLevel: options.onLevel,
      onDiagnostic: options.onDiagnostic,
      // D-05: Otto's own voice leaks into the mic; it must not read as the visitor speaking.
      muted: () => !!player?.busy,
      onSpeechStart: () => apply({ do: 'state', state: 'listening' }),
      // Stop the mic first (the browser's recording light goes off), then tell the model; Otto thinks at once.
      onSpeechEnd: () => { remember(); haltMic(); transport?.endTurn(); handle({ type: 'thinking' }) },
      onNoSpeech: () => { remember(); micWanted = false; haltMic(); apply({ do: 'face', face: 'happy' }); apply({ do: 'state', state: 'idle' }) },
    }, recorder.context, roomFloor)
  }

  const remember = () => { if (detector) roomFloor = detector.noiseFloor }

  const handle = (event: BridgeEvent) => {
    if (state === 'closed') return
    // Otto's actions first: a barge-in's stopAudio must come before the endTurn that lets the next turn's audio in.
    mapEvent(event, !!player?.playing).forEach(apply)
    switch (event.type) {
      case 'ready':
        setState('open'); settle?.resolve(); settle = null; break
      case 'audio':
        ensureAudio().play(event.pcm); break
      case 'text': {
        const part = split.push(event.text)
        visual(part.visual)
        if (options.showText === false || !part.spoken) break
        spoken(part.spoken)
        // speakText has no bubble-only mode, so its procedural mouth briefly leads; the duration tracks the audio still to play.
        void otto.speakText(said, { durationMs: remainingMs(), mouth: false })
        break
      }
      case 'turnComplete': {
        // What the splitter held back (the last word, an unclosed block) goes out with the end of the turn.
        const rest = split.flush()
        visual(rest.visual)
        if (options.showText !== false && rest.spoken) { spoken(rest.spoken); void otto.speakText(said, { durationMs: remainingMs(), mouth: false }) }
        player?.endTurn(); said = ''
        options.onDiagnostic?.({ type: 'turn_complete' })
        // The VAD closed the mic at the end of the visitor's turn; reopen it for the next one, unless the caller muted it.
        if (micWanted && !recorder && state === 'open') {
          bridge.startMic().catch(e => {
            micWanted = false
            apply({ do: 'state', state: 'idle' })
            options.onError?.(e instanceof Error ? e : new Error(String(e)))
          })
        // The server answered before the client's silence timeout (its own VAD): that turn is over, so the detector starts afresh.
        } else if (recorder) { remember(); startDetector() }
        break
      }
      case 'interrupted':
        split.reset(); player?.endTurn(); said = ''; break
      case 'error':
        options.onError?.(new Error(event.message))
        settle?.reject(new Error(event.message)); settle = null
        break
      case 'closed':
        settle?.reject(new Error(`The voice session closed (${event.reason}).`)); settle = null
        release(); setState('closed')
        break
    }
  }

  const remainingMs = () => {
    const p = player?.progress()
    return p ? Math.max(800, (p.received - p.played) * 1000) : undefined
  }

  const bridge: GeminiVoiceBridge = {
    get state() { return state },

    connect() {
      if (state !== 'idle') return Promise.reject(new Error(`connect() was already called (state: ${state}).`))
      setState('connecting')
      ensureAudio() // inside the click, before any await
      if (!options.transport) { handle({ type: 'ready' }); return Promise.resolve() }
      const done = new Promise<void>((resolve, reject) => { settle = { resolve, reject } })
      try {
        transport = openTransport(options.transport, { language: options.language, page: options.page }, handle)
      } catch (cause) {
        settle = null
        release(); setState('closed')
        return Promise.reject(cause)
      }
      if (options.microphone) bridge.startMic().catch(e => options.onError?.(e instanceof Error ? e : new Error(String(e))))
      return done
    },

    feed(message) {
      if (state === 'idle') { setState('connecting'); ensureAudio() }
      parseLiveMessage(message).forEach(handle)
    },

    sendText(text) {
      const clean = text.trim()
      if (!clean || !transport) return
      transport.sendText(clean)
      handle({ type: 'thinking' })
    },

    async startMic() {
      if (!transport) throw new Error('The microphone needs a transport (proxy or live).')
      if (recorder) return
      const attempt = ++micAttempt
      const created = await startRecorder(frame => {
        // D-05: echo cancellation misses Web Audio playback, so nothing is sent while Otto is audible.
        // shortcut: no local barge-in by voice while he talks; the server's own VAD and 'interrupted' handle the rest.
        if (!player?.busy) transport?.sendAudio(frame)
      })
      if (attempt !== micAttempt || state === 'closed') { created.stop(); return }
      recorder = created
      micWanted = true
      startDetector()
    },

    stopMic() {
      micWanted = false
      haltMic()
    },

    close() {
      if (state === 'closed') return
      const wasLive = state !== 'idle'
      settle?.reject(new Error('Closed.')); settle = null
      release()
      setState('closed')
      if (wasLive) mapEvent({ type: 'closed', reason: 'client' }, false).forEach(apply)
    },
  }
  return bridge
}
