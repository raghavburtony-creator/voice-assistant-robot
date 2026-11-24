// The panel's screen and camera share (D-21): Share screen and Show camera buttons, the notice before the browser's
// prompt, and while it runs a "Sharing your screen" or "Camera on" line with Stop, as text the whole time (D-06). One
// share at a time. The capture itself is useScreenShare.ts.

import { useEffect, useRef } from 'react'
import { ASSISTANT_NAME } from '../otto.config'
import type { CaptureSource, CaptureStopReason } from './capture'
import { Button, Icon } from './ui'
import { useScreenShare, type ScreenSharePhase } from './useScreenShare'

const TEXT = {
  screen: {
    button: 'Share screen', title: 'Share your screen?', confirm: 'Share screen', on: 'Sharing your screen', stop: 'Stop sharing',
    declined: 'Screen not shared.', stopped: 'Screen sharing stopped.',
    hidden: 'Screen sharing stopped because you left this tab. Share again to show more.',
  },
  camera: {
    button: 'Show camera', title: 'Show your camera?', confirm: 'Show camera', on: 'Camera on', stop: 'Turn camera off',
    declined: 'Camera not shared.', stopped: 'Camera turned off.',
    hidden: 'Camera turned off because you left this tab. Turn it on again to show more.',
  },
} as const satisfies Record<CaptureSource, Record<string, string>>

const stoppedText = (source: CaptureSource, reason: CaptureStopReason) => (reason === 'hidden' ? TEXT[source].hidden : TEXT[source].stopped)

/** Where the browser can share a screen, or show a camera; elsewhere that button is not shown. */
export const canShareScreen = () => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
export const canShowCamera = () => typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
export const canShare = () => canShareScreen() || canShowCamera()
/** Only Chrome's Capture Handle tells this tab apart, so only there does the notice promise covered fields. */
const canTellThisTab = () => typeof (navigator.mediaDevices as { setCaptureHandleConfig?: unknown } | undefined)?.setCaptureHandleConfig === 'function'

export default function ScreenShare({ open, sendCapture, sendFrame }: {
  open: boolean
  sendCapture: (source: CaptureSource | null) => boolean
  sendFrame: (data: string) => boolean
}) {
  const share = useScreenShare({ open, sendCapture, sendFrame })
  const text = TEXT[share.source]
  const before = useRef<ScreenSharePhase>(share.phase)
  const asking = share.phase === 'notice' || share.phase === 'starting'

  // The control that had focus goes away at each step, so focus moves to the one that replaces it.
  useEffect(() => {
    const from = before.current
    before.current = share.phase
    const id = share.phase === 'notice' ? 'voice-share-title'
      : share.phase === 'on' ? 'voice-share-stop'
      : share.phase === 'off' && from !== 'off' ? `voice-${share.source}-button` : null
    if (id) document.getElementById(id)?.focus()
  }, [share.phase, share.source])

  if (!open && share.phase === 'off') return null
  const said = share.phase === 'on' ? `${text.on}.` : share.declined ? text.declined : share.stopped ? stoppedText(share.source, share.stopped) : ''
  return <>
    {asking && <section className="voice-assistant__consent" role="region" aria-labelledby="voice-share-title">
      <h3 id="voice-share-title" tabIndex={-1}>{text.title}</h3>
      {share.source === 'camera'
        ? <p>
          {ASSISTANT_NAME} sends still pictures from your camera to Google's Gemini while this is on, about one a second.
          Nothing is saved. Everything in view is sent.
        </p>
        : <p>
          {ASSISTANT_NAME} sends still pictures of the screen you pick to Google's Gemini while this is on, about one a second.
          Nothing is saved. {canTellThisTab()
            ? <>Pick this tab and private fields are covered over; pick another tab or window and {ASSISTANT_NAME} sees everything in it.</>
            : <>{ASSISTANT_NAME} sees everything on the screen you pick.</>}
        </p>}
      <div className="voice-assistant__consent-actions">
        <Button variant="tonal" disabled={share.phase === 'starting'} onClick={() => void share.share()}>{text.confirm}</Button>
        <Button variant="tonal" disabled={share.phase === 'starting'} onClick={share.cancel}>Cancel</Button>
      </div>
    </section>}

    {/* Announces the start, every way a share ends, and a refused prompt. */}
    <p className="ui-visually-hidden" role="status">{said}</p>
    {share.phase === 'on' && <div className="otto-notice otto-notice--warning">
      <span>
        <strong>{text.on}</strong>
        {share.source === 'camera' ? ` ${ASSISTANT_NAME} sees what your camera sees.`
          : share.ownTab ? ' Private fields and this panel are covered over.' : ` ${ASSISTANT_NAME} sees everything in this window.`}
      </span>
      <Button id="voice-share-stop" variant="text" onClick={share.stop}><Icon className="voice-assistant__icon" name="stop" size={20} />{text.stop}</Button>
    </div>}
    {share.phase === 'off' && share.stopped === 'hidden' && <p className="voice-assistant__why">{text.hidden}</p>}
    {share.phase === 'off' && open && <div className="voice-assistant__actions">
      {canShareScreen() && <Button id="voice-screen-button" variant="tonal" onClick={() => share.ask('screen')}>{TEXT.screen.button}</Button>}
      {canShowCamera() && <Button id="voice-camera-button" variant="tonal" onClick={() => share.ask('camera')}>{TEXT.camera.button}</Button>}
    </div>}
  </>
}
