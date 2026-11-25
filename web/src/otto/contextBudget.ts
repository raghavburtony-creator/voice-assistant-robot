// The size limit on one context update, and how a list the page reports is kept inside it (D-23). Core: pure.
//
// The server refuses an update over MAX_CONTEXT_BYTES (server/app/voice/bridge.py, where a test checks the number matches)
// and clears that key. So a list is capped here first: entries are kept in order and dropped whole from the end, and the
// model is told how many were left out.

/** The most one context update may be: the UTF-8 bytes of its compact JSON, measured the same way as the server. */
export const MAX_CONTEXT_BYTES = 16 * 1024

/**
 * The UTF-8 length of `JSON.stringify(value)`, as the server's `context_bytes` counts it, for data made of strings,
 * integers, booleans and null (what the lists hold). A lone surrogate counts as its 6-byte escape on both ends. A float
 * can count less here: JS writes 1e-7, Python 1e-07. Keep floats out of capped lists.
 */
export function contextBytes(value: unknown): number {
  const text = JSON.stringify(value) ?? ''
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 0x80) bytes += 1
    else if (code < 0x800) bytes += 2
    else if ((code & 0xfc00) === 0xd800 && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00) { bytes += 4; i++ } // a surrogate pair
    else bytes += 3
  }
  return bytes
}

/**
 * `{ [field]: items }`, or as many leading items as fit `budget`, plus `omitted` (how many were left out).
 * The page lists its most important entries first; those are the ones kept.
 */
export function capList<T>(field: string, items: readonly T[], budget = MAX_CONTEXT_BYTES): Record<string, unknown> {
  const wrap = (count: number): Record<string, unknown> =>
    count === items.length ? { [field]: items.slice() } : { [field]: items.slice(0, count), omitted: items.length - count }
  if (contextBytes(wrap(items.length)) <= budget) return wrap(items.length)
  // The size only grows with the count, so the largest count that fits is found by halving.
  let low = 0
  let high = items.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (contextBytes(wrap(mid)) <= budget) low = mid
    else high = mid - 1
  }
  return wrap(low)
}
