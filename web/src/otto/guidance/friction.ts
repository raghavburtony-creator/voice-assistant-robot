// When the visitor seems stuck on a form, and whether Otto should offer a hand. Pure (core): signals and the clock in, a
// guide request (or null) out. The shell (frictionObserver.ts) turns the page's forms into signals; the guide (guide.ts)
// still decides how much of the offer to show (tab hidden, asleep, in a conversation: a glance at most).
//
// Opt-in (`proactiveHelpEnabled`, off by default). An offer is always the smallest helpful thing: a curious look and
// "Need a hand with this?", with Show me and Not now. Never speech, never focus, never a sound of its own.
//
//   failedSubmit   a form refused (invalid fields)    `helpAfterFailures` of them within `helpWindowMs`: offer
//   stalled        sat on an invalid field, untyped   offer (the stall is itself the repeat)
//   fixed          the form went through              its failures are forgotten
// At most one offer per `frictionCooldownMs`, and none without a guidance target to show.

import type { GuideRequest, GuideSettings } from './guide'

export type FrictionSignal =
  | { kind: 'failedSubmit'; form: string; target?: string; message?: string }
  | { kind: 'stalled'; form: string; target?: string; message?: string }
  | { kind: 'fixed'; form: string }
export type FrictionSettings = Pick<GuideSettings, 'proactiveHelpEnabled' | 'frictionCooldownMs' | 'helpAfterFailures' | 'helpWindowMs'>
export type FrictionJudge = { consider(signal: FrictionSignal, now: number): (GuideRequest & { why: string }) | null }

export const FRICTION_OFFER = 'Need a hand with this?'

export function createFrictionJudge(settings: () => FrictionSettings): FrictionJudge {
  const failures = new Map<string, number[]>()
  let lastOfferAt: number | null = null
  return {
    consider(signal, now) {
      const s = settings()
      if (signal.kind === 'fixed') { failures.delete(signal.form); return null }
      let why: string
      if (signal.kind === 'failedSubmit') {
        const recent = (failures.get(signal.form) ?? []).filter(t => now - t < s.helpWindowMs)
        recent.push(now)
        failures.set(signal.form, recent)
        if (recent.length < s.helpAfterFailures) return null
        why = `failed ${recent.length} times`
      } else why = 'stalled on an invalid field'
      if (!s.proactiveHelpEnabled) return null
      if (!signal.target) return null
      if (lastOfferAt !== null && now - lastOfferAt < s.frictionCooldownMs) return null
      lastOfferAt = now
      return {
        target: signal.target, reason: 'app', importance: 'normal', mode: 'offer', offer: FRICTION_OFFER,
        ...(signal.message ? { say: signal.message } : {}), why: `${why}: offer`,
      }
    },
  }
}
