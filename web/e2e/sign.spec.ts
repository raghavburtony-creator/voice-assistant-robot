import { test, expect, type Page } from './helpers'

// The lab's scripted sign reader (no camera, no model): notice first, a visible indicator, provisional then final text the
// visitor confirms, corrects or discards, and Stop (D-29).
async function openConversation(page: Page) {
  await page.goto('/lab.html')
  await page.getByLabel('Use the real Otto').check()
  await page.getByRole('button', { name: 'Talk to Otto' }).dispatchEvent('click')
  const panel = page.getByRole('region', { name: 'Voice guide' })
  await panel.getByRole('button', { name: 'Start talking' }).click()
  await panel.getByRole('button', { name: 'Use text only' }).click()
  await expect(panel.getByRole('textbox', { name: 'Type a question instead' })).toBeEnabled()
  return panel
}

async function startSigning(page: Page) {
  const panel = await openConversation(page)
  await panel.getByRole('button', { name: 'Sign to Otto' }).click()
  const notice = panel.getByRole('region', { name: 'Sign to Otto?' })
  await expect(notice).toContainText('saves no video')
  await expect(panel).not.toContainText('Signing is on') // nothing before the visitor agrees
  await notice.getByRole('button', { name: 'Start signing' }).click()
  await expect(panel).toContainText('Signing is on')
  await expect(panel.getByRole('button', { name: 'Stop signing' })).toBeFocused()
  return panel
}

test('a signed result is sent only after the visitor confirms it, tagged as signed', async ({ page }) => {
  const panel = await startSigning(page)
  const result = panel.getByRole('region', { name: 'Is this what you signed?' })
  await expect(result).toContainText('where is billing', { timeout: 6000 })
  const log = panel.getByRole('list', { name: 'Conversation' })
  await expect(log).not.toContainText('[Signed')
  await result.getByRole('button', { name: 'Confirm and send' }).click()
  await expect(log).toContainText('[Signed, confirmed by visitor] where is billing')
})

test('a correction is sent as corrected', async ({ page }) => {
  const panel = await startSigning(page)
  const result = panel.getByRole('region', { name: 'Is this what you signed?' })
  await result.getByRole('button', { name: 'Correct' }).click({ timeout: 6000 })
  await panel.getByRole('textbox', { name: 'Correct what you signed' }).fill('where is the invoice page')
  await panel.getByRole('button', { name: 'Send correction' }).click()
  await expect(panel.getByRole('list', { name: 'Conversation' })).toContainText('[Signed, corrected by visitor] where is the invoice page')
})

test('Stop ends signing and says so', async ({ page }) => {
  const panel = await startSigning(page)
  await panel.getByRole('button', { name: 'Stop signing' }).click()
  await expect(panel).not.toContainText('Signing is on')
  await expect(panel).toContainText('Signing stopped.')
  await expect(panel.getByRole('button', { name: 'Sign to Otto' })).toBeFocused()
  await expect(panel.getByRole('list', { name: 'Conversation' })).not.toContainText('[Signed')
})
