// A stand-in for Otto's voice server, for the lab: no backend, no Gemini key. It speaks the server's protocol
// (server/app/voice/route.py) over an object that behaves like a WebSocket, so the real useVoiceAssistant, SpeechPlayer,
// mouth analyzer, speech bubble and barge-in run exactly as they do live.
//
//   reply(text)   Otto answers: the transcript in pieces and synthetic speech (24 kHz PCM16) streamed faster than real time,
//                 in chunks, as Gemini Live does, then turn_complete
//   bargeIn()     the server hears the visitor over Otto (Gemini's own voice detection): it stops and sends `interrupted`
//   action(a)     a tool sends an action (guide, task, card), as tools.py does
//   context(key)  the last context the page sent under `key` (e.g. 'page': the privacy-filtered snapshot the model reads)
//
// Typed questions: "show me X" / "where is X" -> a guide action; "card" or "how do I install" -> a show_card action and a
// one-line spoken answer; "where am I?" / "where was I?" / "what's next?" -> the step from the guide_task_running context
// the page sent, as the model answers it; anything else -> the stock answer.

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
  /** What the page says it is sharing, and how many frames came (D-21): a count, never the pictures. */
  capture: 'camera' | 'screen' | null = null
  /** Current share generation (D-30): late environmental messages must belong to this share. */
  captureGeneration = 0
  imageFrames = 0
  connected = false
  speaking = false
  private log: ServerLog
  private contexts = new Map<string, unknown>()
  private continuitySeenRunning = false
  private memoryRequestCounter = 0
  /** The ids of the background tasks the lab's "server" has said are working, so a Stop can end one. */
  private workingTasks = new Set<string>()
  private pendingMemory: { request_id: string; content: string; kind: 'episodic' | 'semantic' } | null = null
  private resolvedMemory: string[] = []
  private readonly savedMemories: string[] = []
  private continuitySaved: { task: string; step: string; savedAt: number } | null = (() => {
    try { return JSON.parse(localStorage.getItem('otto-lab:continuity-task') || 'null') } catch { return null }
  })()
  constructor(log: ServerLog = () => {}) { this.log = log }

  /** What the page last sent under `key` (null when cleared, undefined when never sent). */
  context(key: string): unknown { return this.contexts.get(key) }

  /** Pass to <Otto createSocket={server.createSocket} />. */
  readonly createSocket = (url: string): WebSocket => {
    const socket = new FakeSocket(this)
    this.socket = socket
    this.log(`connect ${new URL(url).pathname}`)
    this.workingTasks.clear()
    this.later(() => { socket.readyState = 1; socket.onopen?.() }, 300)
    return socket as unknown as WebSocket
  }

  receive(socket: FakeSocket, data: unknown) {
    if (socket !== this.socket) return
    if (data instanceof ArrayBuffer) { this.micFrames++; return }
    if (typeof data !== 'string') return
    const message = JSON.parse(data) as {
      type: string; text?: string; key?: string; data?: unknown; source?: unknown; generation?: unknown;
      proposal?: unknown; request_id?: unknown; accepted?: unknown; id?: unknown;
    }
    if (message.type === 'memory_consent') {
      const pending = this.pendingMemory
      if (pending && message.request_id === pending.request_id && typeof message.accepted === 'boolean') {
        const status = message.accepted ? 'saved' : 'discarded'
        if (message.accepted) this.savedMemories.push(pending.content)
        this.pendingMemory = null
        this.resolvedMemory.push(pending.request_id)
        this.send({ type: 'memory_result', request_id: pending.request_id, status })
        this.log(`memory: ${status}`)
      } else if (
        typeof message.request_id === 'string' && /^[0-9a-f]{32}$/.test(message.request_id)
        && typeof message.accepted === 'boolean' && !this.resolvedMemory.includes(message.request_id)
      ) {
        // Like the server: a well-formed id that is not open (expired, or never staged) is answered, so the panel never
        // waits; a repeat of one already answered stays silent.
        this.send({ type: 'memory_result', request_id: message.request_id, status: 'expired' })
        this.log('memory: expired')
      }
      return
    }
    if (message.type === 'cancel_task') {
      // Like the server: only a task it is running can be stopped, and it says so the way it says any ending.
      if (typeof message.id === 'string' && this.workingTasks.has(message.id)) {
        this.avatar({ kind: 'failure', id: message.id, message: 'Cancelled.' })
        this.log(`cancelled ${message.id}`)
      }
      return
    }
    if (message.type === 'continuity_clear') { this.continuitySaved = null; try { localStorage.removeItem('otto-lab:continuity-task') } catch { /* ignored */ }; return }
    if (message.type === 'frame') { if (this.capture) this.imageFrames++; return }
    if (message.type === 'capture' && (message.source === 'camera' || message.source === 'screen' || message.source === null)) {
      if (typeof message.generation === 'number' && Number.isSafeInteger(message.generation) && message.generation > this.captureGeneration) {
        this.captureGeneration = message.generation
        this.capture = message.source
      }
    }
    if (message.type !== 'context') this.log(`client: ${message.type}${message.text ? ` "${message.text}"` : ''}`)
    else if (typeof message.key === 'string') {
      this.contexts.set(message.key, message.data ?? null)
      if (message.key === 'guide_task_running') {
        const running = message.data as { id?: unknown; stepId?: unknown } | null
        if (running && typeof running.id === 'string' && typeof running.stepId === 'string') {
          this.continuitySeenRunning = true
          this.continuitySaved = { task: running.id, step: running.stepId, savedAt: Date.now() }
          try { localStorage.setItem('otto-lab:continuity-task', JSON.stringify(this.continuitySaved)) } catch { /* lab persistence is best-effort */ }
        } else if (this.continuitySeenRunning) {
          this.continuitySaved = null
          try { localStorage.removeItem('otto-lab:continuity-task') } catch { /* lab persistence is best-effort */ }
        }
      }
      const saved = this.continuitySaved
      if (message.key === 'guide_tasks' && saved) {
        // The page sends the list under `tasks` (capList in Otto.tsx), not as a bare array.
        const tasks = (message.data as { tasks?: Array<{ id?: unknown; stepIds?: unknown }> } | null)?.tasks
        if (!tasks?.length) return
        const match = tasks.find(task => task.id === saved.task)
        if (!Array.isArray(match?.stepIds) || !match.stepIds.includes(saved.step)) {
          this.continuitySaved = null
          try { localStorage.removeItem('otto-lab:continuity-task') } catch { /* ignored */ }
        } else {
          this.send({ type: 'action', action: 'task_resume', task: saved.task, step: saved.step })
          this.continuitySaved = null
          try { localStorage.removeItem('otto-lab:continuity-task') } catch { /* ignored */ }
        }
      }
    }
    if (message.type === 'start') this.later(() => { this.connected = true; this.send({ type: 'ready', limitSeconds: 600 }) }, 500)
    else if (message.type === 'text') {
      // A new message while Otto is mid-sentence ends that turn: Gemini reports it as `interrupted` ([verify], Q-01).
      // It takes a round trip to say so, so the page cuts Otto off on its own first.
      if (this.speaking) {
        this.stopStreaming()
        this.later(() => { this.send({ type: 'interrupted' }); this.log('interrupted (a new message ended the turn)') }, 250)
      }
      const text = (message.text ?? '').trim()
      const ask = /^(show me|where is) /i.exec(text)
      const remember = /^(?:please\s+)?remember(?:\s+that)?\s+(.{1,600})$/i.exec(text)
      if (remember) {
        const request_id = (++this.memoryRequestCounter).toString(16).padStart(32, '0')
        const pending = { request_id, content: remember[1].trim(), kind: 'semantic' as const }
        this.pendingMemory = pending
        this.later(() => {
          if (this.pendingMemory?.request_id !== request_id) return
          this.send({ type: 'memory_proposal', ...pending, redacted: false })
          this.reply('I can save that to this app profile. Please review the memory request in the panel.')
        }, 400)
      } else if (/\bcard\b|how do i install/i.test(text)) {
        this.later(() => {
          this.send({ type: 'action', action: 'card', card: {
            title: 'Install the kit', body: 'Run these two commands in the web folder, then open the lab.',
            code: 'npm ci\nnpm run dev', follow_ups: ['What does the lab do?', 'Where is the server?'],
          } })
          this.reply("I've put the two commands in the panel.")
        }, 400)
      } else if (ask) {
        const target = text.slice(ask[0].length).trim().toLowerCase().replace(/\s+/g, '-')
        this.later(() => { this.send({ type: 'action', action: 'guide', target }); this.reply(`Here is ${target.replace(/-/g, ' ')}.`) }, 400)
      } else if (/\bwhere (am|was) i\b|\bwhat'?s next\b/i.test(text)) {
        // Only what the page reported (taskProgress in guidance/task.ts); nothing running is said, not guessed.
        const running = this.context('guide_task_running') as { title: string; step: number; total: number; say: string } | null | undefined
        this.later(() => this.reply(running
          ? `You're on step ${running.step} of ${running.total} of ${running.title}: ${running.say}`
          : 'No guided task is running right now.'), 400)
      } else this.later(() => this.reply(), 400)
    }
    else if (message.type === 'stop') socket.close()
  }

  disconnect(socket: FakeSocket) {
    if (socket !== this.socket) return
    this.stopStreaming()
    this.socket = null
    this.connected = false
    this.capture = null
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
  /** The model calls a tool that sends an action (as tools.py does), e.g. start_guided_task: { action: 'task', task }. */
  action(action: Record<string, unknown>) {
    if (!this.socket || !this.connected) return false
    this.send({ type: 'action', ...action })
    this.log(`action: ${JSON.stringify(action)}`)
    return true
  }

  /** Emit the bounded environmental message from the same server protocol used by Bridge.model_to_browser. */
  environmental(generation: number, proposal: Record<string, unknown>) {
    if (!this.socket || !this.connected || this.capture !== 'camera' || generation !== this.captureGeneration) return false
    this.send({ type: 'environmental', generation, proposal })
    this.log(`environmental: ${JSON.stringify(proposal)}`)
    return true
  }

  /** The server says how things are going (server/app/voice/avatar.py): working, asking permission, success... */
  avatar(event: Record<string, unknown>) {
    if (!this.socket || !this.connected) return false
    if (event.kind === 'working' && typeof event.id === 'string') this.workingTasks.add(event.id)
    if ((event.kind === 'success' || event.kind === 'failure') && typeof event.id === 'string') this.workingTasks.delete(event.id)
    this.send({ type: 'avatar', event })
    this.log(`avatar: ${JSON.stringify(event)}`)
    return true
  }

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
