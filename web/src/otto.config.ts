// EDIT THIS FILE for each new project: Otto's name, your pages, and the commands Otto may run.
// PAGES and COMMANDS must match server/app/voice/app_config.py (server/tests/test_voice.py checks it).

import { defineOttoConfig } from './otto/config'
import type { VadSettings } from './otto/gemini/vad'

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

/**
 * The mascot: Otto's look, gestures, sound, movement, idle life and reactions. Every setting and its default is in
 * web/src/otto/config.ts; name here only what this app changes. A theme preset ('default', 'midnight', 'cyber',
 * 'minimal') sets several at once, and your overrides go on top of it.
 */
export const OTTO_CONFIG = defineOttoConfig({
  name: ASSISTANT_NAME,
  theme: 'default',
  hotkey: SHORTCUT_KEY,
  // colors: { clay: '#B5A1FF', visor: '#22225E', eyes: '#FFFFFF' },
  // sound: { soundVolume: 0.5 },
  // movement: { avoid: ['.cookie-banner'] },
  // idle: { sleepTimeoutMs: 120_000 },
})

// The same settings by their older names, for code that reads them directly.
export const ROBOT_COLORS = OTTO_CONFIG.colors
export const ROBOT_BACKGROUND = OTTO_CONFIG.background
export const GESTURE_SETTINGS = OTTO_CONFIG.gestures
export const MOVEMENT_SETTINGS = OTTO_CONFIG.movement
export const IDLE_SETTINGS = OTTO_CONFIG.idle
export const SOUND_SETTINGS = OTTO_CONFIG.sound

/**
 * Cutting Otto off by talking over him (open mic). While Otto is audible the microphone sends nothing (browsers do not
 * cancel his echo reliably), so the page itself listens for a voice clearly louder than his echo and than the room: a
 * frame peak of at least `level` (0..1) AND `floorRatio` times the noise floor learned while he was silent (a fan sets that
 * floor, so it cannot cut him off), held for `holdMs`. A dip shorter than `gapMs` does not restart the run. A burst shorter
 * than `holdMs` is rejected. Raise `level` if Otto cuts himself off on loud speakers; lower it if talking over him does
 * not work. Right after the microphone opens (before `calibrationMs` of his silence) a voice cannot cut him off yet. Pressing Talk (push-to-talk) or "Stop speaking" always cuts him off.
 */
export const BARGE_IN = {
  enabled: true,
  level: 0.22,
  holdMs: 200,
  floorRatio: 4,
  gapMs: 100,
  /** No interruption is accepted until the room's floor has been learned from this much of Otto's silence. */
  calibrationMs: 400,
  /** The last frames held back (50 ms each) that are sent once he is cut off, so the first words reach the server. */
  keepFrames: 8,
}

/**
 * When the visitor has finished talking (the Gemini adapter's createGeminiVoiceBridge, passed as its `vad` option, and
 * the open mic's gate on this page). The page meters the microphone and follows the room's noise floor: speech starts when
 * the level stays above `enterRatio` times the floor (never below `speechThreshold`, RMS 0..1) for `speechOnsetMs`, holds
 * down to `exitRatio` times the floor, and the turn ends after `silenceTimeoutMs` below that, and Otto starts thinking.
 * A fan or a hum therefore does not keep a turn open; you do not raise `speechThreshold` for a noisy room, only for a
 * microphone that is hot in a silent one. `calibrationMs`: at the start only the floor is learned.
 */
export const VAD: VadSettings = {
  speechThreshold: 0.02,
  speechOnsetMs: 180,
  silenceTimeoutMs: 1000,
  noSpeechTimeoutMs: 6000,
  maxTurnDurationMs: 30_000,
  enterRatio: 2.5,
  exitRatio: 1.6,
  minExitLevel: 0.012,
  calibrationMs: 400,
}

/** The URL of the server. Empty in development: Vite proxies /api to it (vite.config.ts). Set VITE_API_URL in production. */
export function apiBase(): string {
  return (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '')
}
