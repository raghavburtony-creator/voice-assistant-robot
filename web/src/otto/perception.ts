/** Provider-independent perception contracts used by Otto's browser boundary. */

export type PerceptionSource = 'camera' | 'screen' | 'browser' | 'document' | 'image'
export type PerceptionKind = 'frame' | 'context' | 'snapshot'
export type PerceptionConsent = 'granted' | 'revoked'

export type PerceptionEvent = {
  id: string
  source: PerceptionSource
  kind: PerceptionKind
  timestamp: number
  consent: PerceptionConsent
  metadata?: Record<string, unknown>
}

/** Build the metadata envelope sent by a browser provider to the perception boundary. */
export function perceptionEvent(
  source: PerceptionSource,
  kind: PerceptionKind,
  consent: PerceptionConsent,
  metadata: Record<string, unknown> = {},
  now = Date.now(),
): PerceptionEvent {
  return {
    id: crypto.randomUUID(),
    source,
    kind,
    timestamp: now,
    consent,
    metadata: { ...metadata },
  }
}

/** A provider may not emit observations after consent has been revoked. */
export function canPublishPerception(event: PerceptionEvent): boolean {
  return event.consent === 'granted'
}
