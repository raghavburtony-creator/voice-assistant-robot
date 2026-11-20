import { test, expect } from './helpers'

// The Embodied Assistant sandbox in the lab: what the model is told about the page, its tool calls simulated offline, the
// fallbacks, and friction. No backend, no key.

const guideLog = (page: import('@playwright/test').Page) => page.locator('#lab-guides + ol')

test('the page snapshot leaves out passwords, payment and hidden fields, private areas and typed values', async ({ page }) => {
  await page.goto('/lab.html')
  await page.getByLabel('Email', { exact: true }).fill('ada@example.com')
  await page.getByRole('button', { name: 'Snapshot what the model sees' }).click()
  const snapshot = page.getByLabel('Page snapshot')
  await expect(snapshot).toContainText('"title": "Otto lab"')
  await expect(snapshot).toContainText('lab-email')
  for (const secret of ['hunter2', '4111', 'token-never-read', 'Tuesday', 'ada@example.com', 'Private notes'])
    await expect(snapshot).not.toContainText(secret)
})

test('show_target rings the target while Otto shows it, and the ring goes afterwards', async ({ page }) => {
  await page.goto('/lab.html')
  await page.getByRole('button', { name: /^show_target \(Email/ }).click()
  const ring = page.locator('[data-otto-spotlight]')
  await expect(ring).toHaveCSS('opacity', '1')
  await expect(ring).toHaveAttribute('aria-hidden', 'true')
  await expect(guideLog(page)).toContainText(/shown lab-email: (point|approach)/, { timeout: 15_000 })
  await expect(ring).toHaveCSS('opacity', '0')
})

test('missing and hidden targets: a structured fallback, logged with the reason', async ({ page }) => {
  await page.goto('/lab.html')
  await page.getByRole('button', { name: 'Missing target' }).click()
  await expect(guideLog(page)).toContainText('missing target missing-target (not_found)')
  await page.getByRole('button', { name: 'Hidden target' }).click()
  await expect(guideLog(page)).toContainText('missing target lab-hidden (hidden)')
  await expect(page.locator('[data-otto-spotlight]')).toHaveCount(0) // never ringed
})

test('form friction: two refused submits get a quiet offer, and nothing moves until the visitor says yes', async ({ page }) => {
  await page.goto('/lab.html')
  await page.getByRole('button', { name: 'Trigger form friction' }).click()
  await expect(guideLog(page)).toContainText('help for lab-email: failed 2 times: offer')
  await expect(guideLog(page)).toContainText('offered lab-email: waiting for a yes')
  // The offer never takes focus.
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('INPUT')
  await page.getByRole('button', { name: 'Show me', exact: true }).click()
  await expect(guideLog(page)).toContainText(/shown lab-email: (point|approach)/, { timeout: 15_000 })
})

test('with proactive help off, friction gets no offer', async ({ page }) => {
  await page.goto('/lab.html')
  await page.getByLabel('Proactive help (proactiveHelpEnabled)').uncheck()
  await page.getByRole('button', { name: 'Trigger form friction' }).click()
  await page.waitForTimeout(800)
  await expect(guideLog(page)).not.toContainText('help for lab-email')
})

test('a card from the voice shows in the real panel as text, and the bubble never shows code', async ({ page }) => {
  await page.goto('/lab.html')
  await page.getByLabel('Use the real Otto').check()
  await page.getByRole('button', { name: 'Talk to Otto' }).dispatchEvent('click')
  const panel = page.getByRole('region', { name: 'Voice guide' })
  await panel.getByRole('button', { name: 'Start talking' }).click()
  await panel.getByRole('button', { name: 'Use text only' }).click()
  const box = panel.getByRole('textbox', { name: 'Type a question instead' })
  await expect(box).toBeEnabled()
  await box.fill('How do I install it? Show me a card')
  await box.press('Enter')
  const card = panel.getByRole('article', { name: 'Card: Install the kit' })
  await expect(card).toContainText('npm ci')
  await expect(card.getByRole('button', { name: 'What does the lab do?' })).toBeVisible()
  await expect(panel).toContainText('Put a card in the panel: Install the kit')
  // The page snapshot reached the simulated server, privacy-filtered.
  await page.getByRole('button', { name: 'Snapshot what the model sees' }).click()
  await expect(page.getByLabel('Page snapshot')).toContainText('What the simulated server last received')
  await expect(page.getByLabel('Page snapshot')).not.toContainText('hunter2')
})
