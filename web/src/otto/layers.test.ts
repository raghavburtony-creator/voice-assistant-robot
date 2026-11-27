// The kit's layers (docs/decisions.md D-13). Fails when an import crosses a layer the wrong way.
//   core   pure rules and data: no React, no packages, no browser globals, no app config; imports only core
//   shell  everything else in otto/: adapters (Web Audio, WebSocket, storage, speech) and React; may read otto.config.ts
//   app    otto.config.ts, App.tsx, the lab: may import the kit; the kit never imports them, except shell -> otto.config.ts

import { describe, expect, it } from 'vitest'

/** Core files, relative to src/otto. A new pure module goes here, with its test. */
const CORE = [
  'awareness/avatar.ts',
  'awareness/busy.ts',
  'awareness/events.ts',
  'awareness/environmental.ts',
  'awareness/page.ts',
  'awareness/reactions.ts',
  'capture.ts',
  'config.ts',
  'contextBudget.ts',
  'gemini/channels.ts',
  'gemini/prompt.ts',
  'gesture-control/gesture.ts',
  'guidance/friction.ts',
  'guidance/guide.ts',
  'guidance/help.ts',
  'guidance/task.ts',
  'idle.ts',
  'mouth.ts',
  'movement/stage.ts',
  'robot/gestures.ts',
  'robot/robot.ts',
  'runtimeId.ts',
  'soundCues.ts',
  'speechGate.ts',
  'sign/sign.ts',
  'signRecognition.ts',
]

const raw = import.meta.glob(['/src/**/*.{ts,tsx}', '!/src/**/*.test.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>
/** Sources keyed by path relative to src/, e.g. 'otto/idle.ts'. */
const SRC = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k.replace(/^\/src\//, ''), v]))

const BROWSER_GLOBALS = /\b(window|document|navigator|localStorage|sessionStorage|AudioContext|requestAnimationFrame|matchMedia|WebSocket)\b/

const stripComments = (code: string) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

function specifiers(code: string): string[] {
  const c = stripComments(code)
  return [...c.matchAll(/(?:from|import)\s*\(?\s*'([^']+)'/g)].map(m => m[1])
}

/** The src/-relative file an import points at, or the bare specifier for a package. */
function resolve(from: string, spec: string): string {
  if (!spec.startsWith('.')) return spec
  const parts = from.split('/').slice(0, -1)
  for (const seg of spec.split('?')[0].split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  const base = parts.join('/')
  return [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(p => p in SRC) ?? base
}

describe('layers', () => {
  it('lists only files that exist', () => {
    for (const f of CORE) expect(SRC, f).toHaveProperty(`otto/${f}`)
  })

  it.each(CORE)('core %s imports only core', file => {
    const path = `otto/${file}`
    const wrong = specifiers(SRC[path]).map(s => resolve(path, s)).filter(t => !CORE.includes(t.replace(/^otto\//, '')))
    expect(wrong, `${path} may import only core files`).toEqual([])
  })

  it.each(CORE)('core %s uses no browser globals', file => {
    expect(stripComments(SRC[`otto/${file}`]).match(BROWSER_GLOBALS)?.[0]).toBeUndefined()
  })

  it('the kit never imports the host app', () => {
    const app = /^(App|main|lab)(\.tsx?)?$|^lab\//
    const wrong = Object.keys(SRC).filter(f => f.startsWith('otto/'))
      .flatMap(f => specifiers(SRC[f]).map(s => [f, resolve(f, s)] as const))
      .filter(([, t]) => app.test(t))
    expect(wrong).toEqual([])
  })

  it('<otto-mascot> never reaches the app config', () => {
    const seen = new Set<string>()
    const walk = (f: string) => {
      if (seen.has(f) || !(f in SRC)) return
      seen.add(f)
      for (const s of specifiers(SRC[f])) walk(resolve(f, s))
    }
    walk('otto/element/index.ts')
    expect(seen.size).toBeGreaterThan(10)
    expect([...seen].filter(f => f === 'otto.config.ts')).toEqual([])
  })
})
