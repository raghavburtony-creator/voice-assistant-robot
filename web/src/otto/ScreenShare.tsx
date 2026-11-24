// The panel's screen share (D-21): a Share screen button, the notice before the browser's picker, and while it runs a
// "Sharing your screen" line with Stop, as text the whole time (D-06). The capture itself is useScreenShare.ts.

import { useEffect, useRef } from 'react'
import { ASSISTANT_NAME } from '../otto.config'
import type { CaptureStopReason } from './capture'
import { Button, Icon } from './ui'
import { useScreenShare, type ScreenSharePhase } from './useScreenShare'

const STOPPED: Record<CaptureStopReason, string> = {
  stop: 'Screen sharing stopped.',
  ended: 'Screen sharing stopped.',
  hidden: 'Screen sharing stopped because you left this tab. Share again to show more.',
  track_ended: 'Screen sharing stopped.',
}

/** True where the browser can share a screen at all; elsewhere the button is not shown. */
export const canShareScreen = () => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
/** Only Chrome's Capture Handle tells this tab apart, so only there does the notice promise covered fields. */
const canTellThisTab = () => typeof (navigator.mediaDevices as { setCaptureHandleConfig?: unknown } | undefined)?.setCaptureHandleConfig === 'function'

export default function ScreenShare({ open, sendCapture, sendFrame }: {
  open: boolean
  sendCapture: (source: 'screen' | null) => boolean
  sendFrame: (data: string) => boolean
}) {
  const share = useScreenShare({ open, sendCapture, sendFrame })
  const before = useRef<ScreenSharePhase>(share.phase)
  const asking = share.phase === 'notice' || share.phase === 'starting'

  // The control that had focus goes away at each step, so focus moves to the one that replaces it.
  useEffect(() => {
    const from = before.current
    before.current = share.phase
    const id = share.phase === 'notice' ? 'voice-share-title'
      : share.phase === 'on' ? 'voice-share-stop'
      : share.phase === 'off' && from !== 'off' ? 'voice-share-button' : null
    if (id) document.getElementById(id)?.focus()
  }, [share.phase])

  if (!open && share.phase === 'off') return null
  const said = share.phase === 'on' ? 'Sharing your screen.' : share.declined ? 'Screen not shared.' : share.stopped ? STOPPED[share.stopped] : ''
  return <>
    {asking && <section className="voice-assistant__consent" role="region" aria-labelledby="voice-share-title">
      <h3 id="voice-share-title" tabIndex={-1}>Share your screen?</h3>
      <p>
        {ASSISTANT_NAME} sends still pictures of the screen you pick to Google's Gemini while this is on, about one a second.
        Nothing is saved. {canTellThisTab()
          ? <>Pick this tab and private fields are covered over; pick another tab or window and {ASSISTANT_NAME} sees everything in it.</>
          : <>{ASSISTANT_NAME} sees everything on the screen you pick.</>}
      </p>
      <div className="voice-assistant__consent-actions">
        <Button variant="tonal" disabled={share.phase === 'starting'} onClick={() => void share.share()}>Share screen</Button>
        <Button variant="tonal" disabled={share.phase === 'starting'} onClick={share.cancel}>Cancel</Button>
      </div>
    </section>}

    {/* Announces the start, every way a share ends, and a refused picker. */}
    <p className="ui-visually-hidden" role="status">{said}</p>
    {share.phase === 'on' && <div className="otto-notice otto-notice--warning">
      <span>
        <strong>Sharing your screen</strong>
        {share.ownTab ? ' Private fields and this panel are covered over.' : ` ${ASSISTANT_NAME} sees everything in this window.`}
      </span>
      <Button id="voice-share-stop" variant="text" onClick={share.stop}><Icon className="voice-assistant__icon" name="stop" size={20} />Stop sharing</Button>
    </div>}
    {share.phase === 'off' && share.stopped === 'hidden' && <p className="voice-assistant__why">{STOPPED.hidden}</p>}
    {share.phase === 'off' && open && <div className="voice-assistant__actions">
      <Button id="voice-share-button" variant="tonal" onClick={share.ask}>Share screen</Button>
    </div>}
  </>
}
