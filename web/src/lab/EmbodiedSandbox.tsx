// The lab's Embodied Assistant sandbox: everything the voice model can make Otto do with the page, offline. A sample form
// (with fields the page snapshot must never read), the simulated tool calls (show a target, a card, a finished step, a
// missing, hidden or disabled target), the two-channel split of a reply, and form friction.
//
// With "Use the real Otto" on, the tool calls go through the simulated server (fakeServer.ts) and the real panel, and the
// snapshot shown is what that server last received. Otherwise the lab's own robot runs them, and the snapshot is collected
// here, exactly as <Otto> collects it.

import { useMemo, useState, type FormEvent } from 'react'
import { collectPageContext } from '../otto/awareness/collectPage'
import type { OttoConfig } from '../otto/config'
import { createChannelSplitter, splitChannels, type VisualPart } from '../otto/gemini/channels'
import type { OttoGuide } from '../otto/guidance/guide'
import { toAssistantCard, type AssistantCard } from '../otto/messages'
import { VoiceCard } from '../otto/VoiceAssistant'
import type { FakeVoiceServer } from './fakeServer'

const SAMPLE_REPLY = 'Sure! To install it, run:\n```bash\nnpm ci\nnpm run dev\n```\nThen open **the lab** at http://localhost:5173/lab.html, '
  + 'or read [the README](https://github.com/example/otto#readme) for more.'
const SAMPLE_CARD = { title: 'Fix the email', body: 'An email address needs an @ and a domain, like name@example.com.', code: 'name@example.com', follow_ups: ['Why do you need my email?'] }

type Props = {
  guide: OttoGuide
  full: boolean
  server: FakeVoiceServer
  config: OttoConfig
  proactive: boolean
  setProactive: (on: boolean) => void
  say: (text: string) => void
  log: (line: string) => void
}

export function EmbodiedSandbox({ guide, full, server, config, proactive, setProactive, say, log }: Props) {
  const btn = 'otto-btn otto-btn--tonal'
  const [errors, setErrors] = useState<{ name?: string; email?: string }>({})
  const [submitDisabled, setSubmitDisabled] = useState(false)
  const [snapshot, setSnapshot] = useState('')
  const [card, setCard] = useState<AssistantCard | null>(null)
  const [reply, setReply] = useState(SAMPLE_REPLY)
  const [split, setSplit] = useState<{ spoken: string; visual: VisualPart[] } | null>(null)
  const [submits, setSubmits] = useState(0)
  const splitter = useMemo(createChannelSplitter, [])

  // The app's own validation (noValidate): it marks fields aria-invalid, which the snapshot and the friction observer read.
  const validate = (form: HTMLFormElement) => {
    const data = new FormData(form)
    const next: typeof errors = {}
    if (!String(data.get('name') ?? '').trim()) next.name = 'Enter your name.'
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(data.get('email') ?? ''))) next.email = 'Enter an email like name@example.com.'
    setErrors(next)
    return Object.keys(next).length === 0
  }
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSubmits(n => n + 1)
    log(validate(e.currentTarget) ? 'form: submitted' : 'form: refused (invalid fields)')
  }
  const friction = () => {
    const form = document.getElementById('lab-form') as HTMLFormElement | null
    if (!form) return
    ;(form.elements.namedItem('name') as HTMLInputElement).value ||= 'Ada'
    ;(form.elements.namedItem('email') as HTMLInputElement).value = 'not-an-email'
    // Two refused submits, a moment apart, as a stuck visitor would do.
    form.requestSubmit()
    window.setTimeout(() => form.requestSubmit(), 300)
    log(`friction: two refused submits${proactive ? '' : ' (proactive help is off: no offer)'}`)
  }

  const takeSnapshot = () => {
    const sent = full ? server.context('page') : undefined
    const value = sent !== undefined ? sent : collectPageContext({ ...config.pageContext, includeTargets: true })
    const text = JSON.stringify(value, null, 2)
    setSnapshot(`${full ? (sent === undefined ? 'Not sent yet (open a conversation). Collected here instead:\n' : 'What the simulated server last received:\n') : ''}${text}`)
    log(`snapshot: ${JSON.stringify(value).length} characters (budget ${config.pageContext.maxChars})`)
  }

  // A model tool call, simulated: through the server (the real Otto) or straight to the guide (the lab's robot).
  const tool = (name: string, action: Record<string, unknown>, offline: () => void) => {
    log(`tool: ${name}`)
    if (full) { if (!server.action(action)) log('not connected: open the panel and start first') }
    else offline()
  }
  const showTarget = (target: string) => tool(`show_target(${target})`, { action: 'guide', target },
    () => guide.show({ target, reason: 'asked', say: null }))
  const showCard = () => tool('show_card', { action: 'card', card: SAMPLE_CARD }, () => {
    const checked = toAssistantCard(SAMPLE_CARD)
    setCard(checked)
    if (checked) say('I\'ve put it in the panel.')
  })
  // There is no "celebrate" tool on purpose: Otto celebrates what he saw the visitor finish. This runs a one-step task
  // and completes it, which is exactly that path (excited face, celebrate gesture and its chirpCelebration).
  const celebrate = () => {
    log('a guided step finished: Otto celebrates')
    const t = guide.startTask({ id: 'lab-celebrate', title: 'One step', doneSay: 'You did it!', steps: [{ id: 'one', target: 'lab-submit', say: 'Press Send.' }] })
    window.setTimeout(() => t.complete(), 600)
  }

  const runSplit = () => {
    const whole = splitChannels(reply)
    setSplit(whole)
    log(`split: ${whole.spoken.length} characters spoken, ${whole.visual.length} visual part(s)`)
  }
  const streamReply = () => {
    if (full) { if (!server.reply(reply)) log('not connected: open the panel and start first'); else log('stream: the bubble shows the spoken channel, the panel the full reply'); return }
    // Offline: the reply in 12-character pieces through the streaming splitter, as transcript chunks would arrive.
    splitter.reset()
    let said = ''
    const visual: VisualPart[] = []
    for (let i = 0; i < reply.length; i += 12) {
      const part = splitter.push(reply.slice(i, i + 12))
      if (part.spoken) said = said ? `${said} ${part.spoken}` : part.spoken
      visual.push(...part.visual)
    }
    const rest = splitter.flush()
    if (rest.spoken) said = said ? `${said} ${rest.spoken}` : rest.spoken
    visual.push(...rest.visual)
    setSplit({ spoken: said, visual })
    say(said)
  }

  return <fieldset><legend>Embodied Assistant sandbox</legend>
    <p className="lab-hint">A sample form, the model's tool calls simulated offline, the spoken and visual channels, and friction. The decision log is under Guidance.</p>

    <form id="lab-form" className="lab-form" noValidate aria-label="Sample sign-up" onSubmit={onSubmit}>
      <div data-otto-target="lab-name" data-otto-label="the Name field">
        <label htmlFor="lab-name-input">Name</label>
        <input id="lab-name-input" name="name" autoComplete="off" aria-invalid={errors.name ? 'true' : undefined} aria-errormessage="lab-name-error" />
        {errors.name && <span id="lab-name-error" className="lab-error">{errors.name}</span>}
      </div>
      <div data-otto-target="lab-email" data-otto-label="the Email field" data-otto-description="Where we send the receipt.">
        <label htmlFor="lab-email-input">Email</label>
        <input id="lab-email-input" name="email" type="email" autoComplete="off" aria-invalid={errors.email ? 'true' : undefined} aria-errormessage="lab-email-error" />
        {errors.email && <span id="lab-email-error" className="lab-error">{errors.email}</span>}
      </div>
      <div>
        <label htmlFor="lab-password">Password (never read)</label>
        <input id="lab-password" name="password" type="password" autoComplete="new-password" defaultValue="hunter2" />
      </div>
      <div>
        <label htmlFor="lab-card">Card number (never read)</label>
        <input id="lab-card" name="card" autoComplete="cc-number" inputMode="numeric" defaultValue="4111 1111 1111 1111" />
      </div>
      <div data-otto-private="">
        <label htmlFor="lab-notes">Private notes (data-otto-private: never read)</label>
        <textarea id="lab-notes" name="notes" defaultValue="My appointment is on Tuesday." />
      </div>
      <input type="hidden" name="csrf" value="token-never-read" />
      <div className="lab-row">
        <button type="submit" className="otto-btn otto-btn--filled" data-otto-target="lab-submit" data-otto-label="the Send button" disabled={submitDisabled}>Send</button>
        <button type="button" className={btn} data-otto-target="lab-hidden" style={{ display: 'none' }}>A hidden button</button>
        <label className="lab-inline"><input type="checkbox" checked={submitDisabled} onChange={e => setSubmitDisabled(e.target.checked)} /> Disable Send</label>
        <span className="lab-hint" role="status">{submits ? `${submits} submit(s)` : ''}</span>
      </div>
    </form>

    <div className="lab-row"><span className="lab-hint">Page context:</span>
      <button type="button" className={btn} onClick={takeSnapshot}>Snapshot what the model sees</button>
    </div>
    {snapshot && <pre className="lab-pre" aria-label="Page snapshot">{snapshot}</pre>}

    <div className="lab-row"><span className="lab-hint">Tool calls:</span>
      <button type="button" className={btn} onClick={() => showTarget('lab-email')}>show_target (Email: scroll, walk, look, point, ring)</button>
      <button type="button" className={btn} onClick={showCard}>show_card</button>
      <button type="button" className={btn} onClick={celebrate}>A step finished (celebrate)</button>
    </div>
    <div className="lab-row"><span className="lab-hint">Fallbacks:</span>
      <button type="button" className={btn} onClick={() => showTarget('missing-target')}>Missing target</button>
      <button type="button" className={btn} onClick={() => showTarget('lab-hidden')}>Hidden target</button>
      <button type="button" className={btn} onClick={() => { setSubmitDisabled(true); showTarget('lab-submit') }}>Disabled target (shown; the model is told)</button>
    </div>
    {card && !full && <div className="lab-card"><VoiceCard card={card} onAsk={q => { log(`follow-up chosen: "${q}"`); return true }} /></div>}

    <label className="lab-block">A model reply <textarea className="lab-reply" value={reply} rows={4} onChange={e => setReply(e.target.value)} /></label>
    <div className="lab-row">
      <button type="button" className={btn} onClick={runSplit}>Split into spoken and visual</button>
      <button type="button" className={btn} onClick={streamReply}>Stream it (Otto says the spoken part)</button>
    </div>
    {split && <div className="lab-split">
      <p><strong>Spoken:</strong> <span>{split.spoken || '(nothing)'}</span></p>
      <p><strong>Visual:</strong></p>
      <ul>{split.visual.map((p, i) => <li key={i}>{p.kind === 'code' ? <pre className="lab-pre">{p.text}</pre> : <span>link: {p.url}{p.label ? ` (${p.label})` : ''} (not clickable: model output)</span>}</li>)}</ul>
    </div>}

    <div className="lab-row"><span className="lab-hint">Friction:</span>
      <label className="lab-inline"><input type="checkbox" checked={proactive} onChange={e => setProactive(e.target.checked)} /> Proactive help (proactiveHelpEnabled)</label>
      <button type="button" className={btn} onClick={friction}>Trigger form friction</button>
      <span className="lab-hint">or focus the invalid Email and wait {Math.round(config.guidance.stallMs / 1000)} s</span>
    </div>
  </fieldset>
}
