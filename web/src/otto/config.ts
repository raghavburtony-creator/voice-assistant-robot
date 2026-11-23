// Otto's mascot settings: how he looks, moves, sounds and reacts. Standalone (nothing here knows about any app), per
// instance (each <Otto> or <otto-mascot> can have its own), with theme presets and a deep-merge helper:
//
//   const config = defineOttoConfig({ theme: 'midnight', colors: { eyes: '#ffd27a' }, sound: { soundVolume: 0.3 } })
//
// Every value has a default here; an override names only what it changes. Arrays (avoid, idle gestures, rules) are
// replaced, not merged. React code reads the active config with useOttoConfig() (useOttoConfig.ts).

import type { ReactionRule } from './awareness/reactions'
import type { GestureName } from './robot/gestures'
import type { SoundCue } from './soundCues'

export type ThemeName = 'default' | 'midnight' | 'cyber' | 'minimal'

export type OttoConfig = {
  /** What Otto is called in his own UI ("Talk to Otto"). */
  name: string
  /** The preset this config started from (informational; set by defineOttoConfig). */
  theme: ThemeName
  /** The clay of his helmet and body, the screen in his visor, his eyes and mouth. */
  colors: { clay: string; visor: string; eyes: string }
  /** Multiplies the eye glow of every face (1 = as designed). */
  glow: number
  /** No backdrop (only the robot and a soft floor shadow over the page), or a gradient card. Read when the robot starts. */
  background: { transparent: boolean; top: string; bottom: string; shadow: string }
  /** Alt+<key> (a letter or digit, matched by physical key) activates Otto; null for none. */
  hotkey: string | null
  gestures: {
    enabled: boolean
    /** Scales every gesture, 0 (still) to 1.5. */
    intensity: number
    /** With prefers-reduced-motion, one-shot gestures are skipped and held ones shown at this intensity. */
    reducedIntensity: number
    /** The same gesture is not restarted within this many seconds. */
    cooldown: number
    onConnect: GestureName | null
    onDisconnect: GestureName | null
    onTurnEnd: GestureName | null
    onError: GestureName | null
    whileThinking: GestureName | null
    onInterrupt: GestureName | null
    /** Idle behaviours, taking turns. */
    idle: readonly GestureName[]
  }
  sound: {
    soundEnabled: boolean
    /** 0 (silent) to 1. */
    soundVolume: number
    /** The cue each gesture plays as it starts, or null. */
    gestureCues: Record<GestureName, SoundCue | null>
  }
  movement: {
    /** Off: Otto stays at home, only stepping (without walking) clear of obstacles; commands to go elsewhere are refused. */
    movementEnabled: boolean
    /** Top walking speed, px a second. */
    moveSpeed: number
    /** Kept clear at the stage's left and right edges (px). */
    stageMargins: { left: number; right: number }
    /** Where Otto normally stands, 0 (left) to 1 (right). */
    home: number
    /** Space kept between Otto and what he keeps clear of (px). */
    obstacleGap: number
    /** Selectors of fixed parts of the page Otto should never stand in front of. */
    avoid: readonly string[]
    /** Turn toward a click elsewhere on the page for a moment. */
    noticeClicks: boolean
    /** Wander near home when idle (off by default: he covers whatever is under him). */
    roam: boolean
  }
  idle: {
    /** Quiet for this long: he looks about now and then. */
    idleLookAroundMs: number
    /** Quiet for this long: he dozes off until hover, a click or a key. */
    sleepTimeoutMs: number
  }
  /** How Otto reacts to what happens in the app (awareness/reactions.ts). */
  awareness: {
    enabled: boolean
    /** 'quiet': glances, and gestures only for major events; 'lively': a little more of everything. */
    liveliness: 'quiet' | 'normal' | 'lively'
    /** The least time between two reactions of each size (ms). A reaction too soon after the last is made smaller. */
    cooldownMs: { glance: number; gesture: number; big: number }
    /** The same kind of event within this window counts as a repeat: smaller reactions, then none (ms). */
    repeatWindowMs: number
    /** At most this many gestures a minute from events, however many events come. */
    gesturesPerMinute: number
    /** Walk toward where a major event happened (when he may move), and back home after `returnAfterMs`. */
    walkToEvents: boolean
    returnAfterMs: number
    /** A task shows on Otto only once it has run this long (a quick one goes unnoticed), and he thinks hard after `thinkingAfterMs`. */
    taskNoticeMs: number
    thinkingAfterMs: number
    /** Notice the visitor leaving the tab and coming back after at least `awayMs`. */
    noticePresence: boolean
    awayMs: number
    /** Your own rules, asked first: return a reaction (or 'none') to override the built-in one, undefined to defer. */
    rules: readonly ReactionRule[]
  }
  /** Showing the user where something is (point, look, walk toward it). */
  guidance: {
    /** Minimum ms between app-initiated (unrequested) guidance. */
    cooldownMs: number
    /** Offer before showing, for normal-importance app suggestions. */
    offerFirst: boolean
    /** Share of the viewport width beyond which Otto walks toward the target. */
    approachMinDistance: number
    /** Seconds Otto looks at the target. */
    lookSeconds: number
    /** An event naming a `help` target: offer help after this many failures of the same thing... */
    helpAfterFailures: number
    /** ...within this many ms. */
    helpWindowMs: number
    /** Off by default. On: Otto watches forms for friction (failed submits, sitting on an error) and offers help himself:
     *  a curious look and a "Need a hand with this?" chip, never speech, never focus (guidance/friction.ts). */
    proactiveHelpEnabled: boolean
    /** At least this long between two friction offers (ms). */
    frictionCooldownMs: number
    /** Focused on a field the page marks invalid, with no typing for this long, counts as friction (ms). */
    stallMs: number
  }
  /** What Otto may read of the page for the voice model (awareness/page.ts, collectPage.ts). Passwords, hidden and payment
   *  fields, and anything under [data-otto-private] are always left out, and typed values are never read. */
  pageContext: {
    /** Send the snapshot to the voice model while a conversation is open. */
    enabled: boolean
    /** The snapshot, as JSON, is cut to at most this many characters... */
    maxChars: number
    /** ...and this many items (headings, landmarks, errors, targets) in all. */
    maxNodes: number
    /** Include the text the visitor has selected. Off by default: it can be anything, and it goes to the model. */
    includeSelection: boolean
  }
}

const BASE: OttoConfig = {
  name: 'Otto',
  theme: 'default',
  colors: { clay: '#B5A1FF', visor: '#22225E', eyes: '#FFFFFF' },
  glow: 1,
  background: { transparent: true, top: '#909EA9', bottom: '#CCD0D3', shadow: '#2E4D6A' },
  hotkey: 'O',
  gestures: {
    enabled: true, intensity: 1, reducedIntensity: 0.5, cooldown: 0.4,
    onConnect: 'welcomeWave', onDisconnect: 'goodbyeWave', onTurnEnd: 'nod', onError: 'headShake',
    whileThinking: 'thinkingHand', onInterrupt: 'nod', idle: ['lookAround', 'stretch'],
  },
  sound: {
    soundEnabled: true,
    soundVolume: 0.5,
    gestureCues: {
      welcomeWave: 'chirpConnect', nod: 'chirpAcknowledge', thinkingHand: 'chirpThinking', headShake: 'chirpNegative',
      celebrate: 'chirpCelebration', goodbyeWave: 'chirpGoodbye', lookAround: null, stretch: null, pointLeft: null, pointRight: null,
    },
  },
  movement: {
    movementEnabled: true, moveSpeed: 260, stageMargins: { left: 8, right: 8 }, home: 1, obstacleGap: 16,
    avoid: [], noticeClicks: true, roam: false,
  },
  idle: { idleLookAroundMs: 20_000, sleepTimeoutMs: 120_000 },
  awareness: {
    enabled: true,
    liveliness: 'normal',
    cooldownMs: { glance: 1200, gesture: 5000, big: 25_000 },
    repeatWindowMs: 10_000,
    gesturesPerMinute: 6,
    walkToEvents: true,
    returnAfterMs: 4000,
    taskNoticeMs: 600,
    thinkingAfterMs: 4000,
    noticePresence: true,
    awayMs: 60_000,
    rules: [],
  },
  guidance: {
    cooldownMs: 20_000, offerFirst: true, approachMinDistance: 0.25, lookSeconds: 2.5, helpAfterFailures: 2, helpWindowMs: 60_000,
    proactiveHelpEnabled: false, frictionCooldownMs: 60_000, stallMs: 20_000,
  },
  pageContext: { enabled: true, maxChars: 3000, maxNodes: 60, includeSelection: false },
}

export type DeepPartial<T> = T extends readonly unknown[] ? T : T extends (...args: never[]) => unknown ? T
  : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T

/** Built-in looks and personalities. Each is an override of the default. */
export const THEMES: Record<ThemeName, DeepPartial<OttoConfig>> = {
  default: {},
  // Deep blue clay, warm glowing eyes; calmer: softer gestures and sound, slower to doze off.
  midnight: {
    colors: { clay: '#4A4F8C', visor: '#0B0D24', eyes: '#FFD27A' }, glow: 1.25,
    background: { shadow: '#0A0F24', top: '#1B2140', bottom: '#2C3360' },
    gestures: { intensity: 0.85 }, sound: { soundVolume: 0.35 }, idle: { sleepTimeoutMs: 180_000 },
  },
  // Graphite with neon eyes; livelier and a little quicker.
  cyber: {
    colors: { clay: '#3A3A48', visor: '#05050C', eyes: '#3CFFD0' }, glow: 1.4,
    background: { shadow: '#00140F', top: '#0E1116', bottom: '#1C2230' },
    gestures: { intensity: 1.1 }, movement: { moveSpeed: 320 }, awareness: { liveliness: 'lively' },
  },
  // Pale and quiet: no sound, small gestures, few reactions, no turning toward clicks.
  minimal: {
    colors: { clay: '#E6E3DC', visor: '#2A2A2E', eyes: '#F5F5F5' }, glow: 0.45,
    background: { shadow: '#6B6B6B' },
    gestures: { intensity: 0.6, idle: ['lookAround'] }, sound: { soundEnabled: false },
    movement: { noticeClicks: false }, awareness: { liveliness: 'quiet', walkToEvents: false },
  },
}

export const THEME_NAMES = Object.keys(THEMES) as ThemeName[]
export const isThemeName = (v: unknown): v is ThemeName => typeof v === 'string' && v in THEMES

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype

/** `base` with `over` merged in, key by key; arrays and functions are replaced. Neither is changed. */
export function deepMerge<T>(base: T, over: DeepPartial<T> | undefined): T {
  if (over === undefined) return base
  if (!isPlain(base) || !isPlain(over)) return over as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue
    out[k] = isPlain(v) && isPlain(out[k]) ? deepMerge(out[k], v) : v
  }
  return out as T
}

/**
 * A full config, in three layers: the defaults, the theme preset (`overrides.theme`, default 'default'), your overrides.
 * To re-theme a config later, call it again with the same overrides and another theme.
 */
export function defineOttoConfig(overrides: DeepPartial<OttoConfig> = {}): OttoConfig {
  const theme = isThemeName(overrides.theme) ? overrides.theme : 'default'
  return deepMerge<OttoConfig>(deepMerge<OttoConfig>(BASE, THEMES[theme]), { ...overrides, theme })
}

export const DEFAULT_OTTO_CONFIG = BASE
