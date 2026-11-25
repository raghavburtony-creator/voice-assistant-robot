/** Browser-side validation for the server's bounded environmental proposal (D-30). */
export const ENVIRONMENTAL_TOPICS = ["object", "activity", "scene_change", "potential_hazard"] as const
export type EnvironmentalTopic = (typeof ENVIRONMENTAL_TOPICS)[number]
export type EnvironmentalProposal = { topic: EnvironmentalTopic; message: string }
export type EnvironmentalAttention = { type: 'attention'; importance: 'minor'; topic: EnvironmentalTopic; message: string }

// eslint-disable-next-line no-control-regex
const cleanText = (value: unknown): string | null => {
  if (typeof value !== "string") return null
  const clean = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim()
    .replace(/(?:https?:\/\/|www\.)\S+/gi, "").replace(/\s+/g, " ").trim().slice(0, 120)
  return clean || null
}

/** Unknown fields and topics are dropped; this payload can only become a minor attention event. */
export function parseEnvironmentalProposal(value: unknown): EnvironmentalProposal | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const proposal = value as Record<string, unknown>
  const topic = ENVIRONMENTAL_TOPICS.find(item => item === proposal.topic)
  const message = cleanText(proposal.message)
  return topic && message ? { topic, message } : null
}

/** The browser's independent lifecycle gate: a screen share or a stopped camera cannot create an event. */
export function toEnvironmentalAttention(
  source: string | null,
  activeGeneration: number,
  messageGeneration: number,
  value: unknown,
): EnvironmentalAttention | null {
  if (source !== "camera" || !Number.isSafeInteger(activeGeneration) || messageGeneration !== activeGeneration) return null
  const proposal = parseEnvironmentalProposal(value)
  return proposal ? { type: "attention", importance: "minor", ...proposal } : null
}
