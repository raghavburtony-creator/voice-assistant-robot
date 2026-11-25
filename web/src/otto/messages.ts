// The messages the voice server sends (server/app/voice/route.py). They come from a model's server, so each one is checked
// before the page uses it. Anything that does not fit is dropped, never guessed at.

import { z } from 'zod'
import { COMMANDS, isPage, type CommandName } from '../otto.config'
import { GUIDE_TASK_MOVES, type GuideTaskMove } from './guidance/task'
import { isRuntimeId } from './runtimeId'
import { DESKTOP_DESTINATIONS, type DesktopDestination } from './desktop'

const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), limitSeconds: z.number().finite().positive().optional().catch(undefined) }),
  z.object({ type: z.literal('transcript'), role: z.enum(['user', 'assistant']), text: z.string() }),
  z.object({ type: z.literal('interrupted') }),
  z.object({ type: z.literal('turn_complete') }),
  z.object({ type: z.literal('action'), action: z.string(), page: z.unknown().optional(), name: z.unknown().optional(), target: z.unknown().optional(), task: z.unknown().optional(), move: z.unknown().optional(), card: z.unknown().optional(), destination: z.unknown().optional() }),
  z.object({ type: z.literal('avatar'), event: z.unknown() }),
  z.object({ type: z.literal('action'), action: z.string(), page: z.unknown().optional(), name: z.unknown().optional(), target: z.unknown().optional(), task: z.unknown().optional(), move: z.unknown().optional(), card: z.unknown().optional() }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
  z.object({ type: z.literal('ended'), reason: z.string() }),
])

export type ServerMessage = z.infer<typeof messageSchema>

/** The message in a text frame, or null for invalid JSON, an unknown type or a shape that does not fit. */
export function parseServerMessage(text: string): ServerMessage | null {
  let value: unknown
  try { value = JSON.parse(text) } catch { return null }
  const parsed = messageSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** A card for the voice panel (the show_card tool): plain text only, rendered as text, never as HTML or a link (D-18). */
export type AssistantCard = { title: string; body: string; code?: string; followUps?: string[] }

/** What Otto may make the page do. Add a variant here when you add a tool that sends a new kind of action. */
export type AssistantAction = { action: 'navigate'; page: string } | { action: 'command'; name: CommandName } | { action: 'guide'; target: string }
  | { action: 'task'; task: string } | { action: 'task_move'; move: GuideTaskMove } | { action: 'card'; card: AssistantCard } | { action: 'desktop_move'; destination: DesktopDestination }

// The same caps as server/app/voice/tools.py (CARD_*): the browser's own check, not a trust in the server's (D-02).
// eslint-disable-next-line no-control-regex
const line = (max: number) => z.string().transform(v => v.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max))
// eslint-disable-next-line no-control-regex
const block = (max: number) => z.string().transform(v => v.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ').replace(/\s+$/, '').slice(0, max))
const cardSchema = z.object({
  title: line(80), body: line(600), code: block(2000).optional(),
  follow_ups: z.array(z.unknown()).max(10).optional(),
}).transform(({ title, body, code, follow_ups }): AssistantCard | null => {
  if (!title || !body) return null
  const chips = (follow_ups ?? []).flatMap(f => (typeof f === 'string' ? [line(80).parse(f)] : [])).filter(Boolean).slice(0, 3)
  return { title, body, ...(code?.trim() ? { code } : {}), ...(chips.length ? { followUps: chips } : {}) }
})

/** The card in an action, checked and capped, or null. */
export function toAssistantCard(value: unknown): AssistantCard | null {
  const parsed = cardSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

const isMove = (value: unknown): value is GuideTaskMove => typeof value === 'string' && (GUIDE_TASK_MOVES as readonly string[]).includes(value)
const isCommand = (value: unknown): value is CommandName => typeof value === 'string' && (COMMANDS as readonly string[]).includes(value)
const isDesktopDestination = (value: unknown): value is DesktopDestination => typeof value === 'string' && (DESKTOP_DESTINATIONS as readonly string[]).includes(value)

/** The action in a server message, or null when it is unknown or unusable. This is the browser's own allow-list. */
export function toAssistantAction(message: { action: string; page?: unknown; name?: unknown; target?: unknown; task?: unknown; move?: unknown; card?: unknown; destination?: unknown },
  isTarget?: (id: string) => boolean, isTask?: (id: string) => boolean, isDestination?: (id: string) => boolean): AssistantAction | null {
  if (message.action === 'navigate' && isPage(message.page)) return { action: 'navigate', page: message.page }
  if (message.action === 'navigate' && isRuntimeId(message.page) && isDestination?.(message.page)) return { action: 'navigate', page: message.page }
  if (message.action === 'command' && isCommand(message.name)) return { action: 'command', name: message.name }
  // A target or task id must fit the runtime id rule (D-23) and still be in the page's own live registry.
  if (message.action === 'guide' && isRuntimeId(message.target) && isTarget?.(message.target)) return { action: 'guide', target: message.target }
  if (message.action === 'task' && isRuntimeId(message.task) && isTask?.(message.task)) return { action: 'task', task: message.task }
  if (message.action === 'task_move' && isMove(message.move)) return { action: 'task_move', move: message.move }
  if (message.action === 'card') { const card = toAssistantCard(message.card); return card ? { action: 'card', card } : null }
  if (message.action === 'desktop_move' && isDesktopDestination(message.destination)) return { action: 'desktop_move', destination: message.destination }
  return null
}
