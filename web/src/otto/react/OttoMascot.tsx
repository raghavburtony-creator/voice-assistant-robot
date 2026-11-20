'use client'
// <OttoMascot />: <otto-mascot> for React and Next.js. SSR-safe: the server renders a plain <otto-mascot> with its
// attributes; the element code is fetched only in the browser, after mount (dynamic import in an effect).
//
// Notes:
// - `state` is applied in an effect, not rendered: the element has a read-only `state` getter, and React 19 assigns
//   custom-element props that exist on the node as properties, which would throw.
// - `config` is a property, set in an effect whenever its identity changes: memoize it (each change re-applies it).
// - No children: Otto draws into his own shadow root and has no slot.

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type CSSProperties, type Ref } from 'react'
import type { DeepPartial, OttoConfig } from '../config'
import type { OttoMascotElement } from '../element/element'
import { createHandle, listen, toAttributes, type OttoAttributeProps, type OttoCallbacks, type OttoMascotHandle } from './bridge'

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'otto-mascot': import('./bridge').OttoAttributes & { ref?: import('react').Ref<HTMLElement>; class?: string; className?: string; style?: import('react').CSSProperties }
    }
  }
}

export type OttoMascotProps = OttoAttributeProps & OttoCallbacks & {
  /** Overrides on the defaults (the element's `config` property). Attributes go on top. */
  config?: DeepPartial<OttoConfig>
  className?: string
  style?: CSSProperties
  ref?: Ref<OttoMascotHandle>
}

export function OttoMascot({ ref, config, className, style, ...props }: OttoMascotProps) {
  const node = useRef<HTMLElement>(null)
  const latest = useRef<OttoCallbacks>(props)
  useEffect(() => { latest.current = props })
  useImperativeHandle(ref, () => createHandle(() => node.current), [])

  useEffect(() => {
    const el = node.current
    if (!el) return
    const off = listen(el, () => latest.current)
    // W7 maps this path to the package root at build time; keep it exactly as written.
    import('../element/index').catch((e: unknown) => latest.current.onError?.({ reason: 'failed', message: String(e) }))
    return off
  }, [])

  useEffect(() => {
    if (node.current) (node.current as OttoMascotElement).config = config ?? {}
  }, [config])

  const { state, ...attributes } = toAttributes(props)
  useEffect(() => {
    if (state) node.current?.setAttribute('state', state)
    else node.current?.removeAttribute('state')
  }, [state])

  return <otto-mascot ref={node} className={className} style={style} {...attributes} />
}

/** `const { ref, otto, ready } = useOtto()`, then `<OttoMascot ref={ref} />`. `otto` keeps its identity and is safe to
 *  call at any time; `ready` turns true on otto:ready (and false again on unmount). */
export function useOtto(): { ref: (handle: OttoMascotHandle | null) => (() => void) | undefined; otto: OttoMascotHandle; ready: boolean } {
  const [ready, setReady] = useState(false)
  const current = useRef<OttoMascotHandle | null>(null)
  const otto = useMemo(() => createHandle(() => current.current?.element ?? null), [])
  const ref = useCallback((handle: OttoMascotHandle | null) => {
    current.current = handle
    const el = handle?.element
    if (!el) return undefined
    const onReady = () => setReady(true)
    el.addEventListener('otto:ready', onReady)
    return () => { el.removeEventListener('otto:ready', onReady); current.current = null; setReady(false) }
  }, [])
  return { ref, otto, ready }
}
