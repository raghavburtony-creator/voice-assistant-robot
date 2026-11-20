// Two channels from one reply: what Otto says (and his bubble shows), and what belongs on screen. Pure (core).
//
//   spoken   short plain sentences: no URLs, no code, no markdown symbols, so a voice (the browser's speech synthesis, or
//            Otto's bubble and lip-sync) reads naturally
//   visual   the parts taken out: code blocks and links, for the panel
//
//   toSpoken('Run `npm ci`, see [the docs](https://x.dev).')   // 'Run npm ci, see the docs.'
//   const split = createChannelSplitter()
//   split.push('Here: ```js\nconst a')   // { spoken: 'Here:', visual: [] }   (the open code block is held back)
//   split.push(' = 1\n```')              // { spoken: '', visual: [{ kind: 'code', lang: 'js', text: 'const a = 1' }] }
//   split.flush()                         // whatever was held back, at the end of the turn
//
// Where it matters: a text reply spoken by a TTS (or shown in the bubble). A native-audio model speaks for itself, so its
// audio can't be filtered: it is told not to say these things (prompt.ts), and its transcript is cleaned the same way.
// Links are data, never trusted: only http(s) URLs are kept, and a host must still check one before making it clickable
// (D-02). Nothing here builds HTML.

export type VisualPart = { kind: 'code'; text: string; lang?: string } | { kind: 'link'; url: string; label?: string }
export type ChannelChunk = { spoken: string; visual: VisualPart[] }

const FENCE = '```'
const LONG_INLINE = 24
const URL_RE = /\bhttps?:\/\/[^\s<>()[\]"'`]+[^\s<>()[\]"'`.,;:!?]/gi
const MD_LINK = /\[([^\]\n]{1,120})\]\((https?:\/\/[^\s)]+)\)/gi

/** A word that could still grow into a URL. */
const URL_START = /^(?:h(?:t(?:t(?:ps?(?::\/{0,2}\S*)?)?)?)?|www\.\S*)$/i

const isHttp = (url: string) => /^https?:\/\//i.test(url)

/** Markdown and links out of plain text (no code fences in it). */
function clean(text: string, visual: VisualPart[]): string {
  let t = text.replace(MD_LINK, (_m, label: string, url: string) => {
    if (isHttp(url)) visual.push({ kind: 'link', url, label: label.trim() })
    return label
  })
  t = t.replace(URL_RE, url => { visual.push({ kind: 'link', url }); return '' })
  // Inline code: short ones are read as words, long ones go to the panel.
  t = t.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    if (code.length <= LONG_INLINE) return code
    visual.push({ kind: 'code', text: code })
    return ''
  })
  t = t
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')        // headings
    .replace(/^\s{0,3}>\s?/gm, '')             // quotes
    .replace(/^\s*(?:[-*+]|\d{1,3}[.)])\s+/gm, '') // list markers
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-*:?\s*$/gm, '') // table rules
    .replace(/\|/g, ', ')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')        // bold
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, '$1$2') // italics
    .replace(/[*_~]{2,}/g, '')
  return t
}

const tidy = (t: string) => t.replace(/\s+([.,;:!?])/g, '$1').replace(/(,\s*){2,}/g, ', ').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim()

/** The whole of `text`, split. */
export function splitChannels(text: string): ChannelChunk {
  const visual: VisualPart[] = []
  const spokenParts: string[] = []
  let rest = text
  for (;;) {
    const open = rest.indexOf(FENCE)
    if (open < 0) { spokenParts.push(clean(rest, visual)); break }
    spokenParts.push(clean(rest.slice(0, open), visual))
    const after = rest.slice(open + 3)
    const close = after.indexOf(FENCE)
    const body = close < 0 ? after : after.slice(0, close)
    const nl = body.indexOf('\n')
    const head = nl < 0 ? '' : body.slice(0, nl).trim()
    const lang = /^[\w+#.-]{1,20}$/.test(head) ? head : undefined
    const code = (lang || (nl >= 0 && !head) ? body.slice(nl + 1) : body).replace(/\s+$/, '')
    if (code.trim()) visual.push(lang ? { kind: 'code', lang, text: code } : { kind: 'code', text: code })
    if (close < 0) break
    rest = after.slice(close + 3)
  }
  return { spoken: tidy(spokenParts.join(' ')), visual }
}

/** Only the spoken channel. */
export function toSpoken(text: string): string { return splitChannels(text).spoken }

export type ChannelSplitter = {
  /** The next piece of a streaming reply: what can be said and shown now. An open code block or a half link waits. */
  push(chunk: string): ChannelChunk
  /** The end of the turn: everything held back. */
  flush(): ChannelChunk
  reset(): void
}

export function createChannelSplitter(): ChannelSplitter {
  let buffer = ''
  const cut = (): number => {
    // Inside a code block (an odd number of fences): hold from its opening fence.
    const fences = buffer.split(FENCE).length - 1
    if (fences % 2 === 1) return buffer.lastIndexOf(FENCE)
    // A fence may be half-arrived.
    if (/`{1,2}$/.test(buffer)) return buffer.search(/`{1,2}$/)
    // An unclosed inline code or [label](url): hold from its start.
    const tick = buffer.lastIndexOf('`')
    if (tick >= 0 && (buffer.slice(0, tick).split('`').length - 1) % 2 === 0 && !buffer.slice(tick + 1).includes('`')) return tick
    const bracket = buffer.lastIndexOf('[')
    if (bracket >= 0 && !/\]\([^)]*\)/.test(buffer.slice(bracket))) return bracket
    // The last word may be the start of a URL ("htt", "https://exa"): hold only that, until whitespace follows.
    if (/\s$/.test(buffer)) return buffer.length
    const space = Math.max(buffer.lastIndexOf(' '), buffer.lastIndexOf('\n'))
    return URL_START.test(buffer.slice(space + 1)) ? space + 1 : buffer.length
  }
  return {
    push(chunk) {
      buffer += chunk
      const at = cut()
      const ready = buffer.slice(0, at)
      buffer = buffer.slice(at)
      return ready ? splitChannels(ready) : { spoken: '', visual: [] }
    },
    flush() {
      const ready = buffer
      buffer = ''
      return ready ? splitChannels(ready) : { spoken: '', visual: [] }
    },
    reset() { buffer = '' },
  }
}
