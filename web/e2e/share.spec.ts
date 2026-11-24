import { test, expect, type Page } from './helpers'

// getDisplayMedia answered by a canvas stream, so no picker opens. `ownTab`: the stream carries the capture handle the
// page set, as Chrome does when the visitor picks this tab.
async function fakeScreen(page: Page, ownTab: boolean) {
  await page.addInitScript((own: boolean) => {
    let handle: string | undefined
    const devices = navigator.mediaDevices as MediaDevices & { setCaptureHandleConfig?: (c: { handle: string }) => void }
    devices.setCaptureHandleConfig = c => { handle = c.handle }
    devices.getDisplayMedia = async () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 1280, height: 720 })
      const ctx = canvas.getContext('2d')!
      const paint = () => { ctx.fillStyle = '#3a6'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
      paint()
      window.setInterval(paint, 100)
      const stream = canvas.captureStream(10)
      const track = stream.getVideoTracks()[0] as MediaStreamTrack & { getCaptureHandle?: () => { handle?: string } | null }
      track.getCaptureHandle = () => (own ? { handle } : null)
      return stream
    }
  }, ownTab)
}

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

const shareState = (page: Page) => page.locator('#lab-server + ol li').first()
async function expectShare(page: Page, pattern: RegExp) {
  await expect(async () => {
    await page.getByRole('button', { name: 'What the server has of a share' }).click()
    await expect(shareState(page)).toHaveText(pattern, { timeout: 250 })
  }).toPass({ timeout: 6000 })
}

test('sharing this tab asks first, says so while it runs, sends frames, and stops on Stop', async ({ page }) => {
  await fakeScreen(page, true)
  const panel = await openConversation(page)

  await panel.getByRole('button', { name: 'Share screen' }).click()
  const notice = panel.getByRole('region', { name: 'Share your screen?' })
  await expect(notice).toContainText('Nothing is saved')
  await expectShare(page, /sharing: nothing, 0 frames$/) // nothing before the visitor agrees

  await notice.getByRole('button', { name: 'Share screen' }).click()
  await expect(panel).toContainText('Sharing your screen')
  await expect(panel).toContainText('Private fields and this panel are covered over.')
  await expect(panel.getByRole('button', { name: 'Stop sharing' })).toBeFocused() // the pressed button went away
  await expectShare(page, /sharing: screen, [1-9]\d* frames$/)

  await panel.getByRole('button', { name: 'Stop sharing' }).click()
  await expect(panel).not.toContainText('Sharing your screen')
  await expect(panel.getByRole('button', { name: 'Share screen' })).toBeFocused()
  await expectShare(page, /sharing: nothing, /)
  await expect(panel.getByRole('button', { name: 'Share screen' })).toBeVisible() // sharing again takes a new press
})

test('another window is named as fully visible, and leaving the tab stops the share for good', async ({ page }) => {
  await fakeScreen(page, false)
  const panel = await openConversation(page)
  await panel.getByRole('button', { name: 'Share screen' }).click()
  await panel.getByRole('region', { name: 'Share your screen?' }).getByRole('button', { name: 'Share screen' }).click()
  await expect(panel).toContainText('Otto sees everything in this window.')
  await expectShare(page, /sharing: screen, /)

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect(panel).toContainText('Screen sharing stopped because you left this tab.')
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expectShare(page, /sharing: nothing, /)
  await expect(panel).not.toContainText('Sharing your screen') // coming back does not restart it
})

test('cancelling the notice shares nothing, and ending the conversation ends a share', async ({ page }) => {
  await fakeScreen(page, true)
  const panel = await openConversation(page)
  await panel.getByRole('button', { name: 'Share screen' }).click()
  await panel.getByRole('button', { name: 'Cancel' }).click()
  await expect(panel.getByRole('region', { name: 'Share your screen?' })).toBeHidden()
  await expectShare(page, /sharing: nothing, 0 frames$/)

  await panel.getByRole('button', { name: 'Share screen' }).click()
  await panel.getByRole('region', { name: 'Share your screen?' }).getByRole('button', { name: 'Share screen' }).click()
  await expect(panel).toContainText('Sharing your screen')
  await panel.getByRole('button', { name: 'End conversation' }).click()
  await expect(panel).not.toContainText('Sharing your screen')
  await expect(panel.getByRole('button', { name: 'Share screen' })).toBeHidden()
})

test('the camera asks first, says it is on, sends frames, and only one share runs at a time', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const canvas = Object.assign(document.createElement('canvas'), { width: 640, height: 480 })
      const ctx = canvas.getContext('2d')!
      window.setInterval(() => { ctx.fillStyle = '#a63'; ctx.fillRect(0, 0, 640, 480) }, 100)
      return canvas.captureStream(10)
    }
  })
  const panel = await openConversation(page)

  await panel.getByRole('button', { name: 'Show camera' }).click()
  const notice = panel.getByRole('region', { name: 'Show your camera?' })
  await expect(notice).toContainText('Everything in view is sent.')
  await notice.getByRole('button', { name: 'Show camera' }).click()
  await expect(panel).toContainText('Camera on')
  await expect(panel).toContainText('Otto sees what your camera sees.')
  await expect(panel.getByRole('button', { name: 'Share screen' })).toBeHidden() // one share at a time
  await expectShare(page, /sharing: camera, [1-9]\d* frames$/)

  await panel.getByRole('button', { name: 'Turn camera off' }).click()
  await expect(panel).not.toContainText('Camera on')
  await expect(panel.getByRole('button', { name: 'Show camera' })).toBeFocused()
  await expectShare(page, /sharing: nothing, /)
})
