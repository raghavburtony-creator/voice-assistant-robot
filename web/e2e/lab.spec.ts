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

test('the server tells Otto how things are going: a permission request reaches the page and is announced (#58)', async ({ page }) => {
  await page.goto('/lab.html')
  await page.getByLabel('Use the real Otto').check()
  await page.getByRole('button', { name: 'Talk to Otto' }).dispatchEvent('click')
  const panel = page.getByRole('region', { name: 'Voice guide' })
  await panel.getByRole('button', { name: 'Start talking' }).click()
  await panel.getByRole('button', { name: 'Use text only' }).click()
  await expect(panel.getByRole('textbox', { name: 'Type a question instead' })).toBeEnabled()

  await page.getByRole('button', { name: 'Server: asks permission' }).click()
  // The question reaches the page through the whole path (wire, check, Otto's event, his judgement) and is said to screen
  // readers, even in a conversation, where his own voice keeps the gestures.
  await expect(page.locator('.otto-sr').filter({ hasText: 'May I send this for you?' })).toHaveCount(1)
  // And in the panel as visible text, for a visitor who sees Otto but does not use a screen reader.
  await expect(panel.getByText('May I send this for you?')).toBeVisible()
  // The other answers and a job's start and end are accepted without error (the lab fails a test on any console error).
  for (const name of ['Server: permission denied', 'Server: a long job starts', 'Server: the job succeeds']) {
    await page.getByRole('button', { name }).click()
  }
  await expect(page.getByRole('region', { name: 'Simulated server' })).toContainText('avatar: {"kind":"success","id":"lab-job"')
})

test('the model hears what the app is busy with, only while a conversation is open', async ({ page }) => {
  await page.goto('/lab.html')
  await page.getByLabel('Use the real Otto').check()
  const ask = page.getByRole('button', { name: "What the server knows of the app's tasks" })
  const newest = page.locator('#lab-server + ol li').first()
  // No conversation yet: a task that runs and ends stays in the browser.
  await page.getByRole('button', { name: 'A 1 s task, then success' }).click()
  await page.waitForTimeout(1200)
  await ask.click()
  await expect(newest).toHaveText(/app tasks: null$/)

  await page.getByRole('button', { name: 'Talk to Otto' }).dispatchEvent('click')
  const panel = page.getByRole('region', { name: 'Voice guide' })
  await panel.getByRole('button', { name: 'Start talking' }).click()
  await panel.getByRole('button', { name: 'Use text only' }).click()
  await expect(panel.getByRole('textbox', { name: 'Type a question instead' })).toBeEnabled()
  // Opening the conversation sends what the browser already knew: that task, ended.
  await expect(async () => { await ask.click(); await expect(newest).toHaveText(/"outcome":"succeeded".*"message":"The lab task finished."/, { timeout: 250 }) }).toPass()
  // A task that is still running, then fails (sends are debounced, so poll).
  await page.getByRole('button', { name: 'A 3 s task, then failure' }).click()
  await expect(async () => { await ask.click(); await expect(newest).toContainText('"outcome":"running"', { timeout: 250 }) }).toPass()
  await expect(async () => { await ask.click(); await expect(newest).toHaveText(/"outcome":"failed".*"message":"The lab task failed."/, { timeout: 250 }) }).toPass({ timeout: 8000 })
  await expect(newest).toContainText('"running":[]')
})



test('a memory proposal is saved only after the visitor presses Save', async ({ page }) => {
  await page.goto('/lab.html')
  await page.getByLabel('Use the real Otto').check()
  await page.getByRole('button', { name: 'Talk to Otto' }).dispatchEvent('click')
  const panel = page.getByRole('region', { name: 'Voice guide' })
  await panel.getByRole('button', { name: 'Start talking' }).click()
  await panel.getByRole('button', { name: 'Use text only' }).click()
  const input = panel.getByRole('textbox', { name: 'Type a question instead' })
  await expect(input).toBeEnabled()

  await input.fill('Remember that I prefer concise answers')
  await panel.getByRole('button', { name: 'Send' }).click()
  const request = panel.getByRole('article', { name: 'Memory request' })
  await expect(request).toContainText('I prefer concise answers')
  await request.getByRole('button', { name: 'Save' }).click()
  await expect(request).toContainText('Saved to this app profile.')

  await input.fill('Remember that I like green tea')
  await panel.getByRole('button', { name: 'Send' }).click()
  const second = panel.getByRole('article', { name: 'Memory request' }).filter({ hasText: 'I like green tea' })
  await expect(second).toBeVisible()
  await second.getByRole('button', { name: 'Not now' }).click()
  await expect(second).toContainText('Not saved.')

  const server = page.getByRole('region', { name: 'Simulated server' })
  await expect(server).toContainText('memory: saved')
  await expect(server).toContainText('memory: discarded')
})


test('the visitor can stop a task the server is running, and only that task goes', async ({ page }) => {
  await page.goto('/lab.html')
  await page.getByLabel('Use the real Otto').check()
  await page.getByRole('button', { name: 'Talk to Otto' }).dispatchEvent('click')
  const panel = page.getByRole('region', { name: 'Voice guide' })
  await panel.getByRole('button', { name: 'Start talking' }).click()
  await panel.getByRole('button', { name: 'Use text only' }).click()
  await expect(panel.getByRole('textbox', { name: 'Type a question instead' })).toBeEnabled()

  await page.getByRole('button', { name: 'Server: a long job starts' }).click()
  const running = panel.getByRole('list', { name: 'Running in the background' })
  await expect(running).toContainText('a long job')  // as text in the panel, not only in Otto's face (D-06)
  await running.getByRole('button', { name: 'Stop: a long job' }).click()
  await expect(running).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Simulated server' })).toContainText('cancelled lab-job')
  await expect(page.getByRole('region', { name: 'Simulated server' })).toContainText('"message":"Cancelled."')
})

test('the microphone check reports which processing the browser applied and the input level (#145)', async ({ page }) => {
  // A stand-in microphone: a steady tone whose track says echo cancellation was not applied, as a webview may.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext()
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const destination = context.createMediaStreamDestination()
      gain.gain.value = 0.3
      oscillator.connect(gain).connect(destination)
      oscillator.start()
      const track = destination.stream.getAudioTracks()[0]
      track.getSettings = () => ({ echoCancellation: false, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: 48000 })
      return destination.stream
    }
  })
  await page.goto('/lab.html')
  await page.getByRole('button', { name: 'Check my microphone' }).click()
  const result = page.getByRole('status', { name: 'Microphone check result' })
  await expect(result).toContainText('echoCancellation: NOT applied')
  await expect(result).toContainText('noiseSuppression: on, as asked')
  await expect(result).toContainText('channels: 1, sample rate: 48000')
  await expect(result).toContainText(/level over \d+ frames: average [\d.]+, peak [\d.]+/, { timeout: 8000 })
  await expect(result).not.toContainText('No signal')
})
