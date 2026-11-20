import { test as base, expect, type Page } from '@playwright/test'

// Runs before any page script: counts webgl2 contexts and tracks which are lost.
const INIT = () => {
  const w = window as unknown as { __gl: { ctx: WebGL2RenderingContext[] } }
  w.__gl = { ctx: [] }
  const orig = HTMLCanvasElement.prototype.getContext as (this: HTMLCanvasElement, ...a: unknown[]) => unknown
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
    const ctx = orig.call(this, type, ...rest)
    if (type === 'webgl2' && ctx && !w.__gl.ctx.includes(ctx as WebGL2RenderingContext)) w.__gl.ctx.push(ctx as WebGL2RenderingContext)
    return ctx
  } as typeof HTMLCanvasElement.prototype.getContext
}

/** Console errors allowed, each with the reason. Keep this list short. */
const ALLOWED: RegExp[] = [
  // Vite dev server websocket notice when a parallel worker edits src/ and HMR reconnects.
  /\[vite\] (server connection lost|failed to connect)/,
]

export const test = base.extend<{ errors: string[] }>({
  errors: [async ({ page }, use) => {
    await page.addInitScript(INIT)
    const errors: string[] = []
    page.on('console', m => { if (m.type() === 'error' && !ALLOWED.some(r => r.test(m.text()))) errors.push(`console: ${m.text()}`) })
    page.on('pageerror', e => { if (!ALLOWED.some(r => r.test(e.message))) errors.push(`pageerror: ${e.message}`) })
    await use(errors)
    expect(errors, 'console errors and page errors').toEqual([])
  }, { auto: true }],
})
export { expect }

/** Webgl2 contexts created and not lost. Lost = isContextLost() (Otto releases with WEBGL_lose_context). */
export const liveContexts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __gl: { ctx: WebGL2RenderingContext[] } }).__gl.ctx.filter(c => !c.isContextLost()).length)

/** Webgl2 contexts ever created on this page. */
export const createdContexts = (page: Page) =>
  page.evaluate(() => (window as unknown as { __gl: { ctx: unknown[] } }).__gl.ctx.length)

/** Whether this browser gives us WebGL 2 at all (detected once per worker). */
let webgl: boolean | undefined
export async function hasWebGL2(page: Page) {
  // The probe context is released at once so it does not count as a live one.
  webgl ??= await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return !!gl
  })
  return webgl
}
