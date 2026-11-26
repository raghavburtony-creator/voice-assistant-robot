// Proves the subpath separation on the built files. Run by `npm run build:lib` (after all builds).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist-lib')
const problems = []
const fail = msg => problems.push(msg)
const read = p => readFileSync(resolve(dist, p), 'utf8')

/** An entry plus every chunk it statically or dynamically imports (relative specifiers), transitively. */
function closure(entry, seen = new Map()) {
  if (seen.has(entry)) return seen
  if (!existsSync(resolve(dist, entry))) { fail(`${entry} is missing`); return seen }
  const src = read(entry)
  seen.set(entry, src)
  for (const m of src.matchAll(/(?:from\s*|import\s*\(\s*|import\s+)["'](\.[^"']+)["']/g)) {
    // The adapters point at the root bundle on purpose; the closure of an adapter stops there.
    if (m[1] === './otto-mascot.js' && entry !== 'otto-mascot.js') continue
    closure(resolve(dirname(resolve(dist, entry)), m[1]).slice(dist.length + 1), seen)
  }
  return seen
}
const join = files => [...files.values()].join('\n')
const sizes = {}
const size = f => { const b = readFileSync(resolve(dist, f)); return `${f} ${(b.length / 1024).toFixed(1)} kB (${(gzipSync(b).length / 1024).toFixed(1)} kB gzip)` }

// String literals survive minification, identifiers do not.
const adapterMarkers = ['The microphone needs a transport', 'Gemini Live needs an ephemeral token', 'The voice connection failed.', 'onGestureStart']
const root = closure('otto-mascot.js')
for (const m of adapterMarkers) if (join(root).includes(m)) fail(`otto-mascot.js (or its chunks) contains adapter code: "${m}"`)

const react = closure('react.js')
const reactSrc = read('react.js')
if (!reactSrc.startsWith(`'use client'`) && !reactSrc.startsWith('"use client"')) fail(`react.js must start with 'use client'`)
if (!join(react).includes('onGestureStart')) fail('react.js lost its adapter code (marker onGestureStart missing)')
if (join(react).includes('customElements.define')) fail('react.js defines a custom element (element code bundled)')
for (const m of ['__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE', 'react.transitional.element', 'react-dom.production']) {
  if (join(react).includes(m)) fail(`react.js bundles React ("${m}")`)
}
if (!/from\s*["']react["']/.test(reactSrc)) fail(`react.js must import 'react' as a bare specifier`)
const refs = [...reactSrc.matchAll(/["']\.\/otto-mascot\.js["']/g)]
const dyn = [...reactSrc.matchAll(/import\(\s*["']\.\/otto-mascot\.js["']\s*\)/g)]
if (!dyn.length || refs.length !== dyn.length) fail(`react.js must reference ./otto-mascot.js only through a dynamic import (${dyn.length} dynamic of ${refs.length})`)

const gemini = closure('gemini.js')
for (const [f, src] of gemini) {
  if (/(?:from\s*|import\s*\(?\s*)["']react(?:-dom)?(?:\/[^"']*)?["']/.test(src)) fail(`${f} imports react`)
  if (src.includes('customElements')) fail(`${f} references customElements`)
}

// The lab's scripted sign reader (D-29) must not reach any published file. A string literal survives minification.
for (const f of readdirSync(dist).filter(n => n.endsWith('.js'))) {
  if (read(f).includes('the lab simulator (no camera is used)')) fail(`${f} contains the lab-only fake sign recognizer`)
}

for (const f of ['react', 'gemini', 'element'].map(n => `types/otto/${n}/index.d.ts`)) {
  if (!existsSync(resolve(dist, f))) fail(`${f} is missing (run tsc -p tsconfig.lib.json)`)
}

if (problems.length) {
  console.error('check-dist FAILED:\n- ' + problems.join('\n- '))
  process.exit(1)
}
console.log('check-dist OK\n  ' + ['otto-mascot.js', 'react.js', 'gemini.js'].map(size).join('\n  '))
