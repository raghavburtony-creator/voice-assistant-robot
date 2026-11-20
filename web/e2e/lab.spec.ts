import { test, expect } from './helpers'

test('the lab loads with no console errors', async ({ page }) => {
  await page.goto('/lab.html')
  await expect(page.getByRole('heading', { name: 'Otto lab' })).toBeVisible()
})

test('barge-in stops Otto mid-speech and the server log records it', async ({ page }) => {
  await page.goto('/lab.html')
  await page.getByLabel('Use the real Otto').check()
  // The dock button sits under the lab's <main> in this layout, so click it by event, not by pointer.
  await page.getByRole('button', { name: 'Talk to Otto' }).dispatchEvent('click')
  const panel = page.getByRole('region', { name: 'Voice guide' })
  await panel.getByRole('button', { name: 'Start talking' }).click()
  await panel.getByRole('button', { name: 'Use text only' }).click()

  const input = panel.getByRole('textbox', { name: 'Type a question instead' })
  await expect(input).toBeEnabled() // after the simulated connect and ready
  await input.fill('What can you do?')
  await panel.getByRole('button', { name: 'Send' }).click()

  const stop = panel.getByRole('button', { name: 'Stop talking' }) // only shown while status is speaking
  await expect(stop).toBeVisible()
  const log = page.getByRole('region', { name: 'Simulated server' })
  await expect(log).toContainText('reply:')

  await page.getByRole('button', { name: /^Barge in/ }).click()

  await expect(stop).toBeHidden() // speech stopped, state left speaking
  await expect(log).toContainText('interrupted (the server heard the visitor)')
  await expect(log).not.toContainText('Otto is not speaking')
  await expect(log).not.toContainText('turn_complete') // it was cut off, not finished
})
