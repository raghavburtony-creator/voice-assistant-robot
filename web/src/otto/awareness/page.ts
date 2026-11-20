// What the voice model is told about the page: the snapshot's shape, how page text is cleaned, and the budget that keeps
// it small. Pure (core): the shell's collector (collectPage.ts) reads the DOM and hands the raw snapshot here.
//
// Budget, in priority order (what helps the visitor most survives longest):
//   path, title                        always
//   errors > open > targets > headings > landmarks > selection
// First `maxNodes` items in all, in that order; then, while the JSON is longer than `maxChars`, the lowest-priority list
// loses its last item. A cut snapshot says so (`truncated`), so the model knows there is more than it sees.

export type PageError = {
  /** The field's label (never its value). */
  field: string
  /** The page's or the browser's error text. */
  message: string
  /** The guidance target the field is in, if any: the model can show it. */
  target?: string
}
export type PageTarget = {
  id: string
  label: string
  role?: string
  /** On screen now (else Otto scrolls to it first). */
  visible: boolean
  disabled?: true
}
export type PageSnapshot = {
  /** The path, and a route-like hash; never the query string. */
  path: string
  title: string
  /** Rendered headings, h1 to h3, in order: "h2: Billing". */
  headings: string[]
  /** Named landmarks: "navigation: Pages", "main". */
  landmarks: string[]
  /** Open dialogs and expanded panels: "dialog: Settings", "expanded: Filters". */
  open: string[]
  errors: PageError[]
  targets?: PageTarget[]
  selection?: string
  truncated?: true
}
export type PageBudget = { maxChars: number; maxNodes: number }

/** Caps for one piece of text. */
export const PAGE_TEXT = { title: 120, heading: 100, landmark: 80, open: 80, field: 80, message: 160, label: 60, selection: 300 } as const

/** Page text reaches a model: no control characters, one space at a time, capped. */
export function cleanPageText(text: string | null | undefined, max: number): string {
  // eslint-disable-next-line no-control-regex
  return (text ?? '').replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

/** A hash worth keeping is a route ("#features", "#/settings/2"), not a token or a sentence. */
export function routeHash(hash: string): string {
  return /^#\/?[\w-]{1,40}(\/[\w-]{1,40}){0,3}$/.test(hash) ? hash : ''
}

type ListKey = 'errors' | 'open' | 'targets' | 'headings' | 'landmarks'
const ORDER: readonly ListKey[] = ['errors', 'open', 'targets', 'headings', 'landmarks']

/** The snapshot cut to the budget (a new object; `snapshot` is not changed). */
export function fitPageSnapshot(snapshot: PageSnapshot, budget: PageBudget): PageSnapshot {
  const out: PageSnapshot = {
    ...snapshot,
    headings: [...snapshot.headings], landmarks: [...snapshot.landmarks], open: [...snapshot.open], errors: [...snapshot.errors],
    ...(snapshot.targets ? { targets: [...snapshot.targets] } : {}),
  }
  let cut = false
  let left = Math.max(0, Math.floor(budget.maxNodes))
  for (const key of ORDER) {
    const list = out[key] as unknown[] | undefined
    if (!list) continue
    if (list.length > left) { list.length = left; cut = true }
    left -= list.length
  }
  if (out.selection !== undefined && left <= 0) { delete out.selection; cut = true }

  const size = () => JSON.stringify(out).length
  const maxChars = Math.max(0, Math.floor(budget.maxChars))
  while (size() > maxChars) {
    if (out.selection !== undefined) { delete out.selection; cut = true; continue }
    const key = [...ORDER].reverse().find(k => ((out[k] as unknown[] | undefined)?.length ?? 0) > 0)
    if (!key) break
    ;(out[key] as unknown[]).pop()
    cut = true
  }
  if (cut) out.truncated = true
  return out
}
