import { describe, expect, it } from 'vitest'
import { createChannelSplitter, splitChannels, toSpoken } from './channels'

describe('splitChannels: spoken vs visual', () => {
  it('a code block goes to the panel, and is not read out', () => {
    expect(splitChannels('Install it:\n```bash\nnpm ci\nnpm run dev\n```\nThen open the lab.')).toEqual({
      spoken: 'Install it: Then open the lab.',
      visual: [{ kind: 'code', lang: 'bash', text: 'npm ci\nnpm run dev' }],
    })
  })
  it('a markdown link is read by its label; a raw URL is not read at all; both are kept as links', () => {
    expect(splitChannels('See [the docs](https://example.com/docs) or https://example.com/faq.')).toEqual({
      spoken: 'See the docs or.',
      visual: [{ kind: 'link', url: 'https://example.com/docs', label: 'the docs' }, { kind: 'link', url: 'https://example.com/faq' }],
    })
  })
  it('only http(s) links count: javascript: and data: are plain text, and not linked', () => {
    const out = splitChannels('Click [here](javascript:alert(1)) now.')
    expect(out.visual).toEqual([])
  })
  it('markdown symbols go from speech: headings, lists, bold, italics, quotes, tables', () => {
    expect(toSpoken('## Steps\n- **Open** Settings\n- Pick a *theme*\n> Note: _saved_ at once\n| a | b |\n|---|---|')).toBe('Steps Open Settings Pick a theme Note: saved at once, a, b,')
  })
  it('short inline code is read as words; long inline code goes to the panel', () => {
    expect(splitChannels('Run `npm ci` then `docker compose -f deploy/prod.yml up -d`.')).toEqual({
      spoken: 'Run npm ci then.',
      visual: [{ kind: 'code', text: 'docker compose -f deploy/prod.yml up -d' }],
    })
  })
  it('plain speech passes through', () => {
    expect(toSpoken('Sure, I can help with that!')).toBe('Sure, I can help with that!')
  })
})

describe('createChannelSplitter: streaming', () => {
  it('holds an open code block until it closes, and a half URL until a space', () => {
    const s = createChannelSplitter()
    expect(s.push('Here you go: ```js\nconst a')).toEqual({ spoken: 'Here you go:', visual: [] })
    expect(s.push(' = 1\n``')).toEqual({ spoken: '', visual: [] })
    expect(s.push('` and see https://exa')).toEqual({ spoken: 'and see', visual: [{ kind: 'code', lang: 'js', text: 'const a = 1' }] })
    expect(s.push('mple.com/x for more. ')).toEqual({ spoken: 'for more.', visual: [{ kind: 'link', url: 'https://example.com/x' }] })
    expect(s.flush()).toEqual({ spoken: '', visual: [] })
  })
  it('a markdown link split across chunks is read by its label', () => {
    const s = createChannelSplitter()
    const a = s.push('Open [the set')
    const b = s.push('tings](https://e.x/s) page ')
    expect(a.spoken + ' ' + b.spoken).toBe('Open the settings page')
    expect(b.visual).toEqual([{ kind: 'link', url: 'https://e.x/s', label: 'the settings' }])
  })
  it('flush gives back what was held at the end of the turn, even an unclosed block', () => {
    const s = createChannelSplitter()
    expect(s.push('Last word').spoken).toBe('Last word') // a plain word is not held
    expect(s.push(' see htt').spoken).toBe('see')
    expect(s.flush().spoken).toBe('htt')
    s.push('```\nunfinished')
    expect(s.flush()).toEqual({ spoken: '', visual: [{ kind: 'code', text: 'unfinished' }] })
  })
})
