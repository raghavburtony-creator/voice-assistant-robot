// The panel's sign input (D-29): a Sign to Otto button, its own notice before anything starts, a persistent "Signing is on"
// line with Stop, and the reading as text: the provisional words, then a result the visitor confirms, corrects or discards.
// Shown only when the app plugs in a recognizer (the kit ships none). Otto's replies stay in the panel's text channel.
// Everything here is text and focusable controls (D-06); nothing moves, so reduced motion needs nothing (D-07).

import { useEffect, useRef, useState } from 'react'
import { ASSISTANT_NAME } from '../../otto.config'
import { Button, Icon } from '../ui'
import { SIGN_BUFFER_LIMITS, SIGN_MAX_SECONDS, SIGN_TEXT_MAX_CHARS, isLowConfidence, type SignDraft, type SignStopReason } from './sign'
import { useSign } from './useSign'
import { useSignRecognizer } from './useSignRecognizer'

const STOPPED: Record<SignStopReason, string> = {
  visitor_stop: 'Signing stopped.',
  conversation_end: 'Signing stopped because the conversation ended.',
  hidden_tab: 'Signing stopped because you left this tab. Start again to go on.',
  failure: 'Signing stopped because the sign reader failed. Start again to retry.',
  session_limit: `Signing stopped after ${SIGN_MAX_SECONDS} seconds. Start again to go on.`,
}

export default function SignInput({ open, sendText }: { open: boolean; sendText: (text: string) => boolean }) {
  const configured = useSignRecognizer()
  const sign = useSign({ open, recognizer: configured, sendText })
  // While a capture runs this is the reader that was started, even if the app's has since gone: the "Signing is on" line never vanishes.
  const recognizer = sign.recognizer
  const [editingFor, setEditingFor] = useState<SignDraft | null>(null)
  const [draft, setDraft] = useState('')
  const [notSent, setNotSent] = useState(false)
  const { phase } = sign.state
  const pending = sign.text.pending
  // Editing belongs to one reading: if a newer final replaces it (or it is answered) the edit ends and the new reading is shown.
  const editing = editingFor !== null && editingFor === pending

  // Focus moves only on the visitor's own step (Start, Cancel, Stop, Sign to Otto), or when focus was lost because the control
  // that had it went away by itself. A stop in the background (time limit, hidden tab, failure) never pulls focus out of a field
  // the visitor is typing in.
  const stepped = useRef(false)
  const before = useRef(phase)
  const step = (fn: () => void) => () => { stepped.current = true; fn() }
  useEffect(() => {
    const from = before.current
    before.current = phase
    if (from === phase) return
    const byVisitor = stepped.current
    stepped.current = false
    const active = document.activeElement
    const lost = !active || active === document.body || !active.isConnected
    if (!byVisitor && !lost) return
    const id = phase === 'consenting' ? 'voice-sign-title' : phase === 'active' ? 'voice-sign-stop' : 'voice-sign-button'
    // The conversation ended under the notice: no sign button is left, so focus goes to the panel title rather than the page body.
    ;(document.getElementById(id) ?? document.getElementById('voice-assistant-title'))?.focus()
  }, [phase])

  // Confirm, Discard, Back, or a replaced reading remove the control that had focus: put it on the next useful one, never on the page body.
  const hadPending = useRef(false)
  const wasEditing = useRef(false)
  useEffect(() => {
    const resolved = hadPending.current && !pending
    const backed = wasEditing.current && !editing && !!pending
    hadPending.current = !!pending
    wasEditing.current = editing
    const lost = !document.activeElement || document.activeElement === document.body
    if (!lost) return
    if (backed) document.getElementById('voice-sign-correct')?.focus()
    else if (resolved) document.getElementById(phase === 'active' ? 'voice-sign-stop' : 'voice-sign-button')?.focus()
  }, [pending, editing, phase])
  // A new reading starts clean: an earlier "Not sent" does not apply to it.
  useEffect(() => { setNotSent(false) }, [pending])

  if (!recognizer && phase !== 'stopped') return null
  if (!open && phase === 'idle') return null
  const remote = recognizer?.processing === 'remote'
  const who = recognizer?.recipient ?? ''
  const where = remote
    ? `The video is sent over the internet to ${who}, which analyses it.`
    : `The video is analysed on this device (${who}) and is not sent anywhere.`
  // Announced once per change: the start, every way signing ends, and a result waiting for the visitor's check.
  const said = phase === 'active' ? 'Signing is on.' : phase === 'stopped' ? STOPPED[sign.state.reason] : ''
  const ready = pending ? ` A reading is ready to check: ${pending.text}. Confirm, correct or discard it.` : ''
  const limits = SIGN_BUFFER_LIMITS

  const edit = () => { setDraft(pending?.text ?? ''); setNotSent(false); setEditingFor(pending) }
  // sendText refused (the connection is not ready): keep the reading pending and say so, so nothing looks sent.
  const sendEdit = () => { if (sign.correct(draft)) setEditingFor(null); else setNotSent(true) }
  const sendConfirm = () => { if (sign.confirm()) setNotSent(false); else setNotSent(true) }

  return <>
    {phase === 'consenting' && recognizer && <section className="voice-assistant__consent" role="region" aria-labelledby="voice-sign-title">
      <h3 id="voice-sign-title" tabIndex={-1}>Sign to {ASSISTANT_NAME}?</h3>
      <p>
        Your camera is turned on and watches you sign, so {ASSISTANT_NAME} can read it as text. {where} Only the words it reads come back.
        They are sent on to {ASSISTANT_NAME}'s voice service, as if you had typed them, only after you confirm them.
      </p>
      <p>
        {ASSISTANT_NAME} holds at most {limits.maxSeconds} seconds of video in memory at once and the oldest is dropped. This stops by itself
        after {SIGN_MAX_SECONDS} seconds, when you press Stop, leave this tab or end the conversation. {ASSISTANT_NAME} saves no video and
        writes none to storage or logs. This notice is for this one time: you will be asked again next time.
        {remote && ` ${ASSISTANT_NAME} cannot control what ${who} does with the video, including whether it keeps it.`}
      </p>
      <div className="voice-assistant__consent-actions">
        <Button variant="tonal" onClick={step(sign.consent)}>Start signing</Button>
        <Button variant="tonal" onClick={step(sign.decline)}>Cancel</Button>
      </div>
    </section>}

    {/* Announces the start and every way signing ends. */}
    <p className="ui-visually-hidden" role="status">{said}{ready}</p>
    {phase === 'active' && recognizer && <div className="otto-notice otto-notice--warning" role="group" aria-label="Signing">
      <span><strong>Signing is on</strong>{` Your camera is on; the video is analysed ${remote ? `by ${who}` : 'on this device'}.`}</span>
      <Button id="voice-sign-stop" variant="text" onClick={step(sign.stop)}><Icon className="voice-assistant__icon" name="stop" size={20} />Stop signing</Button>
    </div>}
    {phase === 'stopped' && <p className="voice-assistant__why">{STOPPED[sign.state.reason]}</p>}

    {/* The changing partial is not live: read aloud on every update it would drown out everything else. The result to check is announced above. */}
    {(phase === 'active' || phase === 'stopped') && <div className="voice-assistant__sign-reading">
      {sign.text.partial && <p className="voice-assistant__why">Reading so far (may change, not final): {sign.text.partial.text}</p>}
      {sign.text.unrecognized && <p role="status" className="voice-assistant__why">That could not be read. Try signing it again, or type it below.</p>}
    </div>}

    {pending && <section className="voice-assistant__consent" role="region" aria-labelledby="voice-sign-result-title">
      <h3 id="voice-sign-result-title">Is this what you signed?</h3>
      {editing
        ? <>
          <label className="ui-visually-hidden" htmlFor="voice-sign-edit">Correct what you signed</label>
          <input id="voice-sign-edit" className="voice-assistant__input" value={draft} maxLength={SIGN_TEXT_MAX_CHARS} autoComplete="off" autoFocus
            onChange={event => setDraft(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); sendEdit() } }} />
          <div className="voice-assistant__consent-actions">
            <Button variant="tonal" disabled={!draft.trim()} onClick={sendEdit}>Send correction</Button>
            <Button variant="tonal" onClick={() => setEditingFor(null)}>Back</Button>
          </div>
        </>
        : <>
          <p>{pending.text}</p>
          {isLowConfidence(pending) && <p className="voice-assistant__why">The reader was not sure about this one.</p>}
          <p className="voice-assistant__why">This is a reading, and it may be wrong. Nothing is sent to {ASSISTANT_NAME} until you choose.</p>
          <div className="voice-assistant__consent-actions">
            <Button variant="tonal" disabled={!open} onClick={sendConfirm}>Confirm and send</Button>
            <Button id="voice-sign-correct" variant="tonal" onClick={edit}>Correct</Button>
            <Button variant="tonal" onClick={sign.discard}>Discard</Button>
          </div>
        </>}
      <p role="status" className={notSent ? 'voice-assistant__why' : 'ui-visually-hidden'}>{notSent ? 'Not sent, try again' : ''}</p>
    </section>}

    {(phase === 'idle' || phase === 'stopped') && open && sign.available && <div className="voice-assistant__actions">
      <Button id="voice-sign-button" variant="tonal" onClick={step(sign.ask)}>Sign to {ASSISTANT_NAME}</Button>
    </div>}
  </>
}
