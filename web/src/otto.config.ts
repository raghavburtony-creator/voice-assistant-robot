// EDIT THIS FILE for each new project: Otto's name, your pages, and the commands Otto may run.
// PAGES and COMMANDS must match server/app/voice/app_config.py (server/tests/test_voice.py checks it).

import type { GestureName } from './otto/robot/gestures'
import type { SoundCue } from './otto/sound'

export const ASSISTANT_NAME = 'Otto'

/** Prefix for what is remembered in localStorage (mic choice, wake word), so two apps on one origin do not share it. */
export const STORAGE_PREFIX = 'otto-kit'

/**
 * The key that opens and closes the panel, pressed with Alt. A single letter or digit, matched by physical key (so it
 * works on any keyboard layout). Change it if Alt+O clashes with your app's own hotkeys, or set null to turn it off.
 */
export const SHORTCUT_KEY: string | null = 'O'

/** What the shortcut is called in the UI ("Alt+O"), or '' when it is off. */
export const SHORTCUT_LABEL = SHORTCUT_KEY ? `Alt+${SHORTCUT_KEY.toUpperCase()}` : ''

/** The language sent to the server and used by the wake-word recogniser. */
export const LANGUAGE = 'en'

export const PAGES = [
  { id: 'home', title: 'Home' },
  { id: 'features', title: 'Features' },
  { id: 'about', title: 'About' },
] as const

export type PageId = (typeof PAGES)[number]['id']

export const isPage = (value: unknown): value is PageId => PAGES.some(page => page.id === value)

/** Commands the server's `run_command` tool may send. Add yours here, in app_config.py COMMANDS, and in tools.py `Command`. */
export const COMMANDS = ['show_message', 'toggle_theme'] as const

export type CommandName = (typeof COMMANDS)[number]

/** How each command is described in the panel's "Otto did" list. */
export const COMMAND_LABELS: Record<CommandName, string> = {
  show_message: 'Showed a message',
  toggle_theme: 'Switched the theme',
}

/**
 * "Hey Otto", with spellings speech recognisers often write for the name. Change this if you rename Otto.
 * Group 1 is whatever was said after the phrase.
 */
export const WAKE_PHRASE = /\b(?:hey+|hay|hei|okay|ok)[\s,.!-]*(?:otto|ottos|auto|audo|oddo|odo|oto)\b[\s,.!?-]*(.*)$/i

/** Otto's colours (the Clay Robot): the clay of its helmet and body, the screen in its visor, and its eyes and mouth. */
export const ROBOT_COLORS = {
  clay: '#B5A1FF',
  visor: '#22225E',
  eyes: '#FFFFFF',
}

/**
 * The backdrop behind the robot. `transparent`: no backdrop, only the robot and its soft floor shadow over the page;
 * set it to false for the gradient card (top to bottom). `shadow` is the colour of the shadow on the floor.
 */
export const ROBOT_BACKGROUND = {
  transparent: true,
  top: '#909EA9',
  bottom: '#CCD0D3',
  shadow: '#2E4D6A',
}

/**
 * Otto's gestures (web/src/otto/robot/gestures.ts). Each lifecycle moment names the gesture it plays, or null for none.
 * Any gesture can also be played from code: `<Otto gestures={channel} />` with `channel.play('celebrate')`.
 */
export const GESTURE_SETTINGS = {
  enabled: true,
  /** Scales every gesture, 0 (still) to 1.5. */
  intensity: 1,
  /** With prefers-reduced-motion, one-shot gestures are skipped and held ones (thinkingHand) shown at this intensity. */
  reducedIntensity: 0.5,
  /** The same gesture is not restarted within this many seconds. */
  cooldown: 0.4,
  /** The voice session connected (the server said ready). */
  onConnect: 'welcomeWave',
  /** The voice session ended: closed, timed out, or the visitor stopped it. */
  onDisconnect: 'goodbyeWave',
  /** Otto finished a reply and is listening again. */
  onTurnEnd: 'nod',
  /** Something went wrong. */
  onError: 'headShake',
  /** Held while Otto is thinking (connecting). */
  whileThinking: 'thinkingHand',
  /** The visitor cut Otto off mid-sentence (barge-in): whatever he was doing stops, and he plays this instead. */
  onInterrupt: 'nod',
  /** Played now and then while nobody is doing anything (IDLE_SETTINGS), taking turns. Empty for none. */
  idle: ['lookAround', 'stretch'],
} as const satisfies {
  enabled: boolean; intensity: number; reducedIntensity: number; cooldown: number
  onConnect: GestureName | null; onDisconnect: GestureName | null; onTurnEnd: GestureName | null
  onError: GestureName | null; whileThinking: GestureName | null; onInterrupt: GestureName | null
  idle: readonly GestureName[]
}

/**
 * Otto's movement (web/src/otto/movement/stage.ts): he walks along the bottom of the page, steps aside for the voice panel
 * and walks back when it closes, and goes where your code sends him (`<Otto stage={stage} />`, `stage.moveToElement('#cart')`).
 * With prefers-reduced-motion he does not walk: he moves straight to the spot instead.
 */
export const MOVEMENT_SETTINGS = {
  /** Off: Otto stays at home, only stepping (without walking) clear of the panel; commands to go elsewhere are refused. */
  movementEnabled: true,
  /** Top walking speed, px a second. */
  moveSpeed: 260,
  /** Kept clear at the left and right edges of the page (px). */
  stageMargins: { left: 8, right: 8 },
  /** Where Otto normally stands, 0 (left) to 1 (right). */
  home: 1,
  /** Space kept between Otto and anything he keeps clear of (px). */
  obstacleGap: 16,
  /** Selectors of fixed parts of your page Otto should never stand in front of (a cookie bar, a chat button...). */
  avoid: [] as string[],
  /** Turn toward a click elsewhere on the page for a moment (his head already follows the cursor). */
  noticeClicks: true,
  /**
   * Wander a little near home while nobody is doing anything. Off by default: wherever Otto stands he covers the page
   * under him, and a robot strolling over your footer's buttons gets in the way.
   */
  roam: false,
}

/**
 * Otto on his own: after `idleLookAroundMs` with nothing happening he looks about now and then (GESTURE_SETTINGS.idle), and
 * after `sleepTimeoutMs` he dozes off (eyes shut, dim glow, slow breathing) until the cursor comes over him, a click, or a key.
 * A voice session keeps him awake.
 */
export const IDLE_SETTINGS = {
  idleLookAroundMs: 20_000,
  sleepTimeoutMs: 120_000,
}

/**
 * Otto's sound cues (web/src/otto/sound.ts): tiny synthesised chirps, no audio files. Each gesture names the cue it plays
 * when it starts, or null for none; any cue can also be played from code. Browsers only allow sound after the visitor's
 * first click or key press, so cues before that are skipped.
 */
export const SOUND_SETTINGS = {
  soundEnabled: true,
  /** 0 (silent) to 1. */
  soundVolume: 0.5,
  gestureCues: {
    welcomeWave: 'chirpConnect',
    nod: 'chirpAcknowledge',
    thinkingHand: 'chirpThinking',
    headShake: 'chirpNegative',
    celebrate: 'chirpCelebration',
    goodbyeWave: 'chirpGoodbye',
    lookAround: null,
    stretch: null,
  },
} as const satisfies { soundEnabled: boolean; soundVolume: number; gestureCues: Record<GestureName, SoundCue | null> }

/**
 * Cutting Otto off by talking over him (open mic). While Otto is audible the microphone sends nothing (browsers do not
 * cancel his echo reliably), so the page itself listens for a voice clearly louder than his echo: a frame peak of at
 * least `level` (0..1) held for `holdMs`. Raise `level` if Otto cuts himself off on loud speakers; lower it if talking
 * over him does not work. Pressing Talk (push-to-talk) or "Stop speaking" always cuts him off.
 */
export const BARGE_IN = {
  enabled: true,
  level: 0.22,
  holdMs: 200,
  /** The last frames held back (50 ms each) that are sent once he is cut off, so the first words reach the server. */
  keepFrames: 8,
}

/** The URL of the server. Empty in development: Vite proxies /api to it (vite.config.ts). Set VITE_API_URL in production. */
export function apiBase(): string {
  return (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '')
}
