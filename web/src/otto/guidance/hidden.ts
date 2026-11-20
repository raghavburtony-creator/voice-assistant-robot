// Whether an element is drawn at all, and whether it is private. Shell (reads layout).

/** Not drawn: display: none (itself or an ancestor), or detached. Off screen is not hidden: Otto scrolls to it. */
export function isElementHidden(element: Element): boolean {
  if (!element.isConnected) return true
  const e = element as Element & { checkVisibility?: () => boolean }
  if (typeof e.checkVisibility === 'function') return !e.checkVisibility()
  return typeof element.getClientRects === 'function' && element.getClientRects().length === 0
}

/** Subtrees that never reach the voice model: [data-otto-private], and Otto's own panel and notices (the conversation is the visitor's own words). */
export const PRIVATE_SELECTOR = '[data-otto-private], otto-mascot, .voice-assistant, .otto-notices'

export function isPrivateElement(element: Element): boolean {
  try { return element.closest(PRIVATE_SELECTOR) !== null } catch { return false }
}
