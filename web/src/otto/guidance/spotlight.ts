// The spotlight: a soft ring around what Otto is showing. Shell (the DOM): one fixed-position element, made on the first
// show and removed by dispose(). The runner (runner.ts) rings a target only for a point, approach or explain.
//
//   const spotlight = createSpotlight({ host: document.body })
//   const off = spotlight.show(element)   // follows the element while it scrolls or moves; off() takes it away
//   spotlight.dispose()                   // the ring, its frame loop and its listeners, all gone
//
// Coordinates: the ring is position: fixed, so it lives in viewport px, the same space as the stage Otto walks on and
// getBoundingClientRect. A frame loop re-reads the target's rect while the ring is up (a smooth scroll, a layout shift), and
// only then: nothing runs between shows. Inside a transformed ancestor fixed positioning breaks, so give it a host that is
// not transformed (document.body, or <otto-mascot>'s shadow root).
//
// Dismissible: Escape, or a press anywhere on the page, takes the ring away (the guidance itself carries on). It never
// takes focus and never catches the pointer (pointer-events: none), so the visitor can use what it rings. Decorative: the
// words are in the panel (D-06), so it is aria-hidden. Reduced motion: it appears in place, with no fade or glide (D-07).

export type SpotlightOptions = {
  /** Where the ring goes. Default document.body. */
  host?: Node
  /** Default: prefers-reduced-motion. */
  reducedMotion?: () => boolean
  /** Space between the target and the ring (px). Default 6. */
  padding?: number
  /** The visitor dismissed it (Escape or a press). */
  onDismiss?: () => void
}

export type Spotlight = {
  /** Rings `element` (replacing any ring). Returns the function that takes this ring away. */
  show(element: Element): () => void
  hide(): void
  /** The element ringed now, or null. */
  readonly target: Element | null
  dispose(): void
}

const CLASS = 'otto-spotlight'

export function createSpotlight(options: SpotlightOptions = {}): Spotlight {
  const reduced = options.reducedMotion ?? (() => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  const pad = options.padding ?? 6
  let ring: HTMLDivElement | null = null
  let target: Element | null = null
  let frame = 0
  let token = 0
  let disposed = false

  const make = () => {
    const div = document.createElement('div')
    div.className = CLASS
    div.setAttribute('aria-hidden', 'true')
    div.dataset.ottoSpotlight = ''
    Object.assign(div.style, {
      position: 'fixed', left: '0px', top: '0px', width: '0px', height: '0px', pointerEvents: 'none', zIndex: '2147483646',
      borderRadius: '12px', boxSizing: 'border-box', border: '3px solid #8ab4ff',
      boxShadow: '0 0 0 4px rgba(138, 180, 255, 0.35), 0 0 24px rgba(138, 180, 255, 0.45)', opacity: '0',
    } satisfies Partial<CSSStyleDeclaration>)
    ;(options.host ?? document.body).appendChild(div)
    return div
  }

  const place = () => {
    if (!ring || !target) return
    const r = target.getBoundingClientRect()
    const empty = r.width === 0 && r.height === 0
    Object.assign(ring.style, {
      left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px`,
      opacity: empty ? '0' : '1',
    })
  }
  const loop = () => { place(); frame = requestAnimationFrame(loop) }

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && target) { hide(); options.onDismiss?.() } }
  const onPress = () => { if (target) { hide(); options.onDismiss?.() } }
  const listen = (on: boolean) => {
    const method = on ? 'addEventListener' : 'removeEventListener'
    window[method]('keydown', onKey as EventListener, true)
    window[method]('pointerdown', onPress, true)
  }

  function hide() {
    if (!target) return
    target = null
    cancelAnimationFrame(frame)
    frame = 0
    listen(false)
    if (ring) ring.style.opacity = '0'
  }

  return {
    get target() { return target },
    show(element) {
      if (disposed) return () => {}
      hide()
      ring ??= make()
      // A fade and a glide only with motion allowed; reduced motion jumps straight there.
      ring.style.transition = reduced() ? 'none' : 'opacity 180ms ease-out, left 220ms ease-out, top 220ms ease-out, width 220ms ease-out, height 220ms ease-out'
      target = element
      place()
      frame = requestAnimationFrame(loop)
      listen(true)
      const mine = ++token
      return () => { if (token === mine) hide() }
    },
    hide,
    dispose() {
      if (disposed) return
      disposed = true
      hide()
      ring?.remove()
      ring = null
    },
  }
}
