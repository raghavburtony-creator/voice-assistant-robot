// When something that happened is something the visitor may need help with. Pure (core): the event, the clock and the
// settings in, a guide request (or null) out; the shell passes the request to the guide, whose judgement (guide.ts) still
// decides how much of it to show, and whether it is too soon.
//
// Most events only get a reaction (awareness/reactions.ts). Help is for events that name a `help` target:
//   attention              "this needs you":         offer to show it (shown at once when major)
//   failure                once may be a slip, so:   nothing extra; the same failure again within helpWindowMs, or a
//                                                   major one: offer to show where to fix it
//   waiting (major)        stuck on a choice:        offer to show it
//   success / complete     the same topic worked:    its failures are forgotten
// A failure is "the same" when it has the same topic, else the same help target.

import type { OttoEvent } from '../awareness/events'
import type { GuideRequest, GuideSettings } from './guide'

export type HelpJudge = {
  /** The guide request this event deserves, or null to leave it to the reaction alone. */
  consider(event: OttoEvent, now: number): (GuideRequest & { why: string }) | null
}

export function createHelpJudge(settings: () => Pick<GuideSettings, 'helpAfterFailures' | 'helpWindowMs'>): HelpJudge {
  const failures = new Map<string, number[]>()
  const keyOf = (e: OttoEvent) => e.topic ?? e.help ?? ''
  return {
    consider(event, now) {
      const { helpAfterFailures, helpWindowMs } = settings()
      if (event.type === 'success' || event.type === 'complete') { failures.delete(keyOf(event)); return null }
      if (!event.help) return null
      const major = event.importance === 'major'
      const request = (why: string, importance: GuideRequest['importance'] = 'normal') =>
        ({ target: event.help!, reason: 'app' as const, importance, say: event.message, why })
      if (event.type === 'attention') return request(major ? 'attention (major): show it' : 'attention: offer', major ? 'major' : 'normal')
      if (event.type === 'waiting') return major ? request('waiting on the visitor (major): offer') : null
      if (event.type !== 'failure') return null
      const key = keyOf(event)
      const recent = (failures.get(key) ?? []).filter(t => now - t < helpWindowMs)
      recent.push(now)
      failures.set(key, recent)
      if (major) return request('a major failure: offer')
      if (recent.length >= helpAfterFailures) return request(`failed ${recent.length} times: offer`)
      return null
    },
  }
}
