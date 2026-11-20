import { test, expect, hasWebGL2, liveContexts, createdContexts } from './helpers'
import type { Page } from '@playwright/test'

type Otto = HTMLElement & { playGesture(name: string, o?: { force?: boolean }): unknown }

// Resolves once the playground's own <otto-mascot> is upgraded and has fired otto:ready (or already did: the log shows it).
async function ready(page: Page) {
  await page.goto('/preview/')
  await expect(page.locator('#log')).toContainText('otto:ready')
  // Startup creates a context, then replaces it; wait until that has settled.
  await page.waitForTimeout(800)
  if (await hasWebGL2(page)) await expect.poll(() => liveContexts(page)).toBe(1)
}

test('<otto-mascot> mounts, fires otto:ready and draws in its shadow root', async ({ page }) => {
  await ready(page)
  if (await hasWebGL2(page)) {
    await expect.poll(() => page.evaluate(() => document.querySelector('otto-mascot')!.shadowRoot?.querySelectorAll('canvas').length)).toBe(1)
    expect(await liveContexts(page)).toBe(1)
  } else {
    // Documented fallback: no WebGL 2 means otto:error 'no-webgl' and the text still works.
    await expect(page.locator('#log')).toContainText('no-webgl')
  }
})

test('20 mount/unmount cycles leak no WebGL contexts and raise no errors', async ({ page }) => {
  test.setTimeout(60_000)
  await ready(page)
  const webgl = await hasWebGL2(page)
  const baseline = await liveContexts(page)
  expect(baseline).toBeLessThanOrEqual(1)

  // The playground's own cycle test.
  await page.getByRole('button', { name: 'Mount and unmount 20 times' }).click()
  await expect(page.locator('#cycle-out')).toHaveText('20 mount and unmount cycles done', { timeout: 30_000 })
  await expect.poll(() => liveContexts(page)).toBe(baseline)

  // Our own loop, checking the count after every cycle, not just at the end.
  const counts = await page.evaluate(async () => {
    const out: number[] = []
    for (let i = 0; i < 20; i++) {
      const el = document.createElement('otto-mascot')
      document.body.append(el)
      await new Promise(r => el.addEventListener('otto:ready', r, { once: true }))
      await new Promise(r => setTimeout(r, 100))
      el.remove()
      await new Promise(r => setTimeout(r, 50))
      const w = window as unknown as { __gl: { ctx: WebGL2RenderingContext[] } }
      out.push(w.__gl.ctx.filter(c => !c.isContextLost()).length)
    }
    return out
  })
  // Each count may include the one just removed while it is still being released, but must not climb.
  expect(Math.max(...counts), `live contexts after each cycle: ${counts}`).toBeLessThanOrEqual(baseline + 1)
  await expect.poll(() => liveContexts(page)).toBe(baseline)
  if (webgl) expect(await createdContexts(page)).toBeGreaterThan(20) // the loop really did create contexts
})

test('playGesture fires otto:gesturestart then otto:gestureend with the name', async ({ page }) => {
  await ready(page)
  const events = page.evaluate(() => new Promise<string[]>(resolve => {
    const el = document.querySelector('otto-mascot') as Otto
    const seen: string[] = []
    for (const type of ['otto:gesturestart', 'otto:gestureend'])
      el.addEventListener(type, e => {
        seen.push(`${type}:${(e as CustomEvent).detail?.name}`)
        if (type === 'otto:gestureend') resolve(seen)
      })
    el.playGesture('celebrate', { force: true })
  }))
  expect(await events).toEqual(['otto:gesturestart:celebrate', 'otto:gestureend:celebrate'])
})

test('every theme applies live without errors or a new WebGL context', async ({ page }) => {
  await ready(page)
  const created = await createdContexts(page)
  const live = await liveContexts(page)
  for (const theme of ['midnight', 'cyber', 'minimal', 'default']) {
    await page.evaluate(t => document.querySelector('otto-mascot')!.setAttribute('theme', t), theme)
    await page.waitForTimeout(150) // let a few frames render under the new theme
    expect(await createdContexts(page), theme).toBe(created)
    expect(await liveContexts(page), theme).toBe(live)
  }
})
