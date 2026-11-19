// The messages the voice server sends (server/app/voice/route.py). They come from a model's server, so each one is checked
// before the page uses it. Anything that does not fit is dropped, never guessed at.

import { z } from 'zod'
import { COMMANDS, isPage, type CommandName, type PageId } from '../echo.config'

const messageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), limitSeconds: z.number().finite().positive().optional().catch(undefined) }),
  z.object({ type: z.literal('transcript'), role: z.enum(['user', 'assistant']), text: z.string() }),
  z.object({ type: z.literal('interrupted') }),
  z.object({ type: z.literal('turn_complete') }),
  z.object({ type: z.literal('action'), action: z.string(), page: z.unknown().optional(), name: z.unknown().optional() }),
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

/** What Echo may make the page do. Add a variant here when you add a tool that sends a new kind of action. */
export type AssistantAction = { action: 'navigate'; page: PageId } | { action: 'command'; name: CommandName }

const isCommand = (value: unknown): value is CommandName => typeof value === 'string' && (COMMANDS as readonly string[]).includes(value)

/** The action in a server message, or null when it is unknown or unusable. This is the browser's own allow-list. */
export function toAssistantAction(message: { action: string; page?: unknown; name?: unknown }): AssistantAction | null {
  if (message.action === 'navigate' && isPage(message.page)) return { action: 'navigate', page: message.page }
  if (message.action === 'command' && isCommand(message.name)) return { action: 'command', name: message.name }
  return null
}
