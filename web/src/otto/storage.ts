// Reads and writes a setting kept on this device. Storage can be blocked (private windows, some embedded
// browsers), so every access is guarded. When a write is refused, the value is kept in memory, so the choice still holds
// on every page for this visit. Every component that uses the same key sees a change at once.

import { useCallback, useMemo, useSyncExternalStore } from 'react'

/** 'local' is kept on this device; 'session' only in this tab, gone when it closes (a running task, D-20). */
export type StorageArea = 'local' | 'session'

/** Values whose write was refused, kept for this visit. A `null` is a remembered "nothing stored". */
const memory: Record<StorageArea, Map<string, string | null>> = { local: new Map(), session: new Map() }
const listeners = new Set<() => void>()
// Called inside each caller's try: reading the global itself throws where storage is blocked.
const storageOf = (area: StorageArea) => (area === 'session' ? sessionStorage : localStorage)

/** The stored text, or null when nothing is stored (or nothing can be read). */
export function readStoredText(key: string, area: StorageArea = 'local'): string | null {
  if (memory[area].has(key)) return memory[area].get(key) ?? null
  try {
    return storageOf(area).getItem(key)
  } catch {
    return null
  }
}

/** Stores `text`, or forgets the key when `text` is null. If storage refuses, the value is kept in memory for this visit. */
export function writeStoredText(key: string, text: string | null, area: StorageArea = 'local') {
  try {
    const storage = storageOf(area)
    if (text === null) storage.removeItem(key)
    else storage.setItem(key, text)
    memory[area].delete(key)
  } catch {
    memory[area].set(key, text)
  }
  listeners.forEach(listener => listener())
}

/** Forgets what was only kept in memory. For tests, which share one page between cases. */
export function forgetKeptValues() {
  memory.local.clear()
  memory.session.clear()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Turns stored text into a value. A missing value, or a `parse` that throws, gives `fallback`. */
function decode<T>(text: string | null, parse: (text: string) => T, fallback: T): T {
  if (text === null) return fallback
  try {
    return parse(text)
  } catch {
    return fallback
  }
}

/** The value now, for code that is not a component. */
export function readStored<T>(key: string, parse: (text: string) => T, fallback: T, area: StorageArea = 'local'): T {
  return decode(readStoredText(key, area), parse, fallback)
}

/** Plain text for a string (so keys written before this hook keep their values), JSON for anything else. */
function defaultSerialize<T>(value: T): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

/**
 * A setting kept on this device: `[value, set]`. `parse` and `serialize` should be defined outside the component, so they
 * are the same on every render. `serialize` may return null to forget the key (an "on" that is the default, for instance).
 */
export function useStoredValue<T>(
  key: string,
  parse: (text: string) => T,
  fallback: T,
  serialize: (value: T) => string | null = defaultSerialize,
): [T, (value: T) => void] {
  const text = useSyncExternalStore(subscribe, () => readStoredText(key), () => null)
  const value = useMemo(() => decode(text, parse, fallback), [text, parse, fallback])
  const set = useCallback((next: T) => writeStoredText(key, serialize(next)), [key, serialize])
  return [value, set]
}
