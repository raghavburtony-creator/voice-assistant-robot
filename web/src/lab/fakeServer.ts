// A stand-in for Otto's voice server, for the lab: no backend, no Gemini key. It speaks the server's protocol
// (server/app/voice/route.py) over an object that behaves like a WebSocket, so the real useVoiceAssistant, SpeechPlayer,
// mouth analyzer, speech bubble and barge-in run exactly as they do live.
//
//   reply(text)   Otto answers: the transcript in pieces and synthetic speech (24 kHz PCM16) streamed faster than real time,
//                 in chunks, as Gemini Live does, then turn_complete
//   bargeIn()     the server hears the visitor over Otto (Gemini's own voice detection): it stops and sends `interrupted`

export type ServerLog = (line: string) => void

const RATE = 24000
const CHUNK_S = 0.1   // seconds of audio per chunk
const SEND_MS = 40    // a chunk every 40 ms: 2.5x real time, like a fast connection
const CPS = 15        // the made-up voice says about 15 characters a second

/**
 * Speech-like audio: a voiced buzz (pitch ~140 Hz, harmonics shaped by two drifting formants) in syllables of ~4 a second,
 * some with a consonant burst or a hiss (2-4 kHz noise), words separated by short pauses. Deterministic for a given seed.
 */
export function fakeSpeechPcm(seconds: number, seed = 1): Int16Array {
  const n = Math.round(seconds * RATE)
  const out = new Int16Array(n)
  let s = seed >>> 0 || 1
  const noise = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0xffffffff * 2 - 1 }
  let phase = 0, prevN = 0, hp = 0
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    const word = t % 1.6, inWord = word < 1.25 && t < seconds - 0.15
    const sylF = (t * 4.3) % 1, syl = Math.floor(t * 4.3)
    const vowel = inWord ? Math.sin(Math.PI * Math.min(1, sylF / 0.85)) ** 1.5 : 0
    const consonant = inWord && syl % 2 === 0 ? Math.max(0, 1 - sylF / 0.12) : 0
    const hiss = inWord && syl % 3 === 1 ? Math.max(0, (sylF - 0.7) / 0.3) : 0
    const f0 = 140 + 25 * Math.sin(t * 2.1)
    const f1 = 550 + 200 * Math.sin(syl * 1.7), f2 = 1500 + 400 * Math.sin(syl * 2.3)
    phase += f0 / RATE
    let voiced = 0
    for (let k = 1; k <= 24; k++) {
      const hz = k * f0
      if (hz > 4500) break
      const g = Math.exp(-(((hz - f1) / 180) ** 2)) + 0.55 * Math.exp(-(((hz - f2) / 260) ** 2)) + 0.25 * Math.exp(-(((hz - f0) / 60) ** 2))
      voiced += (g / k) * Math.sin(2 * Math.PI * k * phase)
    }
    // High-passed noise for the consonants and hiss.
    const w = noise()
    hp = 0.6 * (hp + w - prevN)
    prevN = w
    const sample = 0.32 * vowel * voiced + 0.16 * (consonant + hiss) * hp
    out[i] = Math.max(-1, Math.min(1, sample)) * 0x7fff
  }
  return out
}

type Listener = ((event: { data: unknown }) => void) | null

class FakeSocket {
  readyState = 0
  binaryType = 'arraybuffer'
  onopen: (() => void) | null = null
  onmessage: Listener = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  private server: FakeVoiceServer
  constructor(server: FakeVoiceServer) { this.server = server }
  send(data: unknown) { this.server.receive(this, data) }
  close() {
    if (this.readyState === 3) return
    this.readyState = 3
    this.server.disconnect(this)
  }
  deliver(data: unknown) { if (this.readyState === 1) this.onmessage?.({ data }) }
}

export class FakeVoiceServer {
  private socket: FakeSocket | null = null
  private streaming: number | undefined
  private timers = new Set<number>()
  /** Microphone frames received (the lab shows them flowing again after a barge-in). */
  micFrames = 0
  connected = false
  speaking = false
  private log: ServerLog
  constructor(log: ServerLog = () => {}) { this.log = log }

  /** Pass to <Otto createSocket={server.createSocket} />. */
  readonly createSocket = (url: string): WebSocket => {
    const socket = new FakeSocket(this)
    this.socket = socket
    this.log(`connect ${new URL(url).pathname}`)
    this.later(() => { socket.readyState = 1; socket.onopen?.() }, 300)
    return socket as unknown as WebSocket
  }

  receive(socket: FakeSocket, data: unknown) {
    if (socket !== this.socket) return
    if (data instanceof ArrayBuffer) { this.micFrames++; return }
    if (typeof data !== 'string') return
    const message = JSON.parse(data) as { type: string; text?: string }
    if (message.type !== 'context') this.log(`client: ${message.type}${message.text ? ` "${message.text}"` : ''}`)
    if (message.type === 'start') this.later(() => { this.connected = true; this.send({ type: 'ready', limitSeconds: 600 }) }, 500)
    else if (message.type === 'text') {
      const text = (message.text ?? '').trim()
      const ask = /^(show me|where is) /i.exec(text)
      if (ask) {
        const target = text.slice(ask[0].length).trim().toLowerCase().replace(/\s+/g, '-')
        this.later(() => { this.send({ type: 'action', action: 'guide', target }); this.reply(`Here is ${target.replace(/-/g, ' ')}.`) }, 400)
      } else this.later(() => this.reply(), 400)
    }
    else if (message.type === 'stop') socket.close()
  }

  disconnect(socket: FakeSocket) {
    if (socket !== this.socket) return
    this.stopStreaming()
    this.socket = null
    this.connected = false
    this.log('disconnected')
  }

  /** Otto answers. */
  reply(text = 'Sure! I can open pages for you, run the app\'s commands, and answer questions about what is on screen. Just ask.') {
    if (!this.socket || !this.connected) return false
    this.stopStreaming()
    const seconds = Math.max(1.2, text.length / CPS)
    const pcm = fakeSpeechPcm(seconds, text.length)
    const per = Math.round(CHUNK_S * RATE)
    const words = text.split(/(?<=\s)/)
    let sent = 0, said = 0, wordAt = 0
    this.speaking = true
    this.log(`reply: ${seconds.toFixed(1)} s of audio in ${Math.ceil(pcm.length / per)} chunks`)
    this.streaming = window.setInterval(() => {
      if (!this.socket) return this.stopStreaming()
      if (sent < pcm.length) {
        const chunk = pcm.slice(sent, sent + per)
        sent += chunk.length
        this.socket.deliver(chunk.buffer)
        // The transcript arrives alongside its audio, a few words at a time.
        const due = Math.round(text.length * Math.min(1, sent / pcm.length))
        let piece = ''
        while (wordAt < words.length && said + words[wordAt].length <= due) { piece += words[wordAt]; said += words[wordAt++].length }
        if (piece) this.send({ type: 'transcript', role: 'assistant', text: piece })
        return
      }
      if (wordAt < words.length) this.send({ type: 'transcript', role: 'assistant', text: words.slice(wordAt).join('') })
      this.send({ type: 'turn_complete' })
      this.log('turn_complete')
      this.stopStreaming()
    }, SEND_MS)
    return true
  }

  /** The server hears the visitor talking over Otto: it stops the turn and says so. */
  bargeIn() {
    if (!this.socket || !this.speaking) return false
    this.stopStreaming()
    this.send({ type: 'interrupted' })
    this.log('interrupted (the server heard the visitor)')
    return true
  }

  dispose() {
    this.stopStreaming()
    this.timers.forEach(t => window.clearTimeout(t))
    this.timers.clear()
    this.socket?.close()
  }

  private send(message: object) { this.socket?.deliver(JSON.stringify(message)) }
  private stopStreaming() {
    window.clearInterval(this.streaming)
    this.streaming = undefined
    this.speaking = false
  }
  private later(fn: () => void, ms: number) {
    const t = window.setTimeout(() => { this.timers.delete(t); fn() }, ms)
    this.timers.add(t)
  }
}
