// EDIT THIS FILE for each new project: Otto's name, your pages, and the commands Otto may run.
// PAGES and COMMANDS must match server/app/voice/app_config.py (server/tests/test_voice.py checks it).

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

/** Otto's colours: the body shell and the light in its eyes and mouth. */
export const ROBOT_COLORS = {
  shell: '#3c4046',
  glow: '#f2f0e8',
}

/** The URL of the server. Empty in development: Vite proxies /api to it (vite.config.ts). Set VITE_API_URL in production. */
export function apiBase(): string {
  return (import.meta.env.VITE_API_URL ?? '').trim().replace(/\/+$/, '')
}
