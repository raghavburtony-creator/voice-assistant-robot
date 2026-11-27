import { useCallback, useState } from 'react'
import { adjacentGestureDestination, type GestureNavigation, type SwipeDirection } from './gesture'
import { useGestureControl } from './useGestureControl'
import './gesture-control.css'

type Props = { currentPage: string; navigation: GestureNavigation }

export default function GestureControl({ currentPage, navigation }: Props) {
  const [navigationMessage, setNavigationMessage] = useState('Hand control is off.')
  const onSwipe = useCallback((direction: SwipeDirection) => {
    const destination = adjacentGestureDestination(navigation.destinations, currentPage, direction)
    if (!destination) {
      setNavigationMessage(direction === 'left' ? 'There is no previous registered view.' : 'There is no next registered view.')
      return
    }
    setNavigationMessage('Swiped ' + direction + '. Opening ' + destination.label + '.')
    navigation.onNavigate(destination.id)
  }, [currentPage, navigation])

  const { videoRef, canvasRef, phase, handStatus, error, start, stop } = useGestureControl({ onSwipe })
  const previewVisible = phase === 'starting' || phase === 'on'

  return <section className="gesture-control" aria-labelledby="gesture-control-title">
    <div className="gesture-control__heading">
      <div>
        <h3 id="gesture-control-title">Hand navigation</h3>
        <p>Point with your index finger, hold still briefly, then swipe left or right to move between this app's registered views.</p>
      </div>
      <span className={'gesture-control__indicator gesture-control__indicator--' + phase} aria-hidden="true" />
    </div>

    {previewVisible && <div className="gesture-control__preview">
      <video ref={videoRef} autoPlay muted playsInline aria-label="Local hand-tracking camera preview" />
      <canvas ref={canvasRef} aria-hidden="true" />
    </div>}

    <p className={error ? 'gesture-control__status is-error' : 'gesture-control__status'} role="status" aria-live="polite">
      {error ?? (phase === 'starting' ? 'Starting camera and loading the hand model…' : handStatus)}
    </p>
    <p className="gesture-control__navigation" role="status" aria-live="polite">{navigationMessage}</p>

    <div className="gesture-control__actions">
      {previewVisible
        ? <button type="button" className="otto-btn otto-btn--tonal" onClick={() => stop()}>Stop hand control</button>
        : <button type="button" className="otto-btn otto-btn--tonal" onClick={() => void start()}>
            {phase === 'error' ? 'Try hand control again' : 'Start hand control'}
          </button>}
    </div>

    <p className="gesture-control__privacy">
      Camera frames and hand landmarks are processed on this device and are not sent to Otto or Gemini. The MediaPipe runtime and model are downloaded from jsDelivr and Google when started; MediaPipe may send usage/performance metrics to Google. See the{' '}
      <a href="https://developers.google.com/edge/mediapipe/solutions/privacy" target="_blank" rel="noreferrer">MediaPipe privacy notice</a>.
    </p>
  </section>
}