import { test, expect } from './helpers'

// Guidance without a backend: Otto follows a task by watching what the visitor does, and offers help when the same
// failure happens again.

test('Otto notices each step of a task as the visitor does it, follows them back, and finishes', async ({ page }) => {
  await page.goto('/lab.html')
  const log = page.locator('#lab-guides + ol')
  const status = page.getByText(/^(Task: |No task running)/)
  await page.getByRole('button', { name: 'Start it', exact: true }).click()
  await expect(status).toHaveText('Task: step 1 of 3: f1')

  // The visitor does step 1 (clicking the far-left card): no "next" button, Otto sees it.
  await page.locator('[data-otto-target="lab-left"]').dispatchEvent('click')
  await expect(status).toHaveText('Task: step 2 of 3: f2')
  await expect(log).toContainText('task step 2/3 (next): f2')

  // Something unrelated changes nothing; the app undoing step 1 takes them back to it.
  await page.locator('[data-otto-target="lab-right"]').dispatchEvent('click')
  await expect(status).toHaveText('Task: step 2 of 3: f2')
  await page.getByRole('button', { name: 'App: step 1 undone' }).click()
  await expect(status).toHaveText('Task: step 1 of 3: f1')
  await expect(log).toContainText('task step 1/3 (back): f1')

  await page.locator('[data-otto-target="lab-left"]').dispatchEvent('click')
  await page.locator('[data-otto-target="lab-near"]').dispatchEvent('click')
  await expect(status).toHaveText('Task: step 3 of 3: f3')
  await page.getByRole('button', { name: 'App: saved' }).click() // the app reports the last step done
  await expect(status).toHaveText('No task running.')
  await expect(log).toContainText('task lab-follow done')
})

test('a running task survives a reload in the tab, at its step, kept as ids only; an ended one does not', async ({ page }) => {
  await page.goto('/lab.html')
  const realOtto = page.getByLabel('Use the real Otto')
  const status = page.getByText(/^(Task: |No task running)/)
  await realOtto.check()
  await page.getByRole('button', { name: 'Start it', exact: true }).click()
  await page.locator('[data-otto-target="lab-left"]').dispatchEvent('click')
  await expect(status).toHaveText('Task: step 2 of 3: f2')
  // Only the ids and a time, in this tab (D-20): no title, no step words.
  const kept = await page.evaluate(() => [sessionStorage.getItem('otto-kit:guide-task'), localStorage.getItem('otto-kit:guide-task')])
  expect(JSON.parse(kept[0]!)).toEqual({ task: 'lab-follow', step: 'f2', savedAt: expect.any(Number) })
  expect(kept[1]).toBeNull()

  await page.reload()
  await realOtto.check()
  await expect(status).toHaveText('Task: step 2 of 3: f2')
  const log = page.locator('#lab-guides + ol')
  await expect(log).toContainText('task step 2/3 (resume): f2')
  // Straight to the kept step: the first one is never shown on the way.
  await expect(log).not.toContainText('task step 1/3')

  // Ended: forgotten, so the next reload resumes nothing.
  await page.getByRole('button', { name: 'App: visitor left' }).click()
  await expect(status).toHaveText('No task running.')
  expect(await page.evaluate(() => sessionStorage.getItem('otto-kit:guide-task'))).toBeNull()
  await page.reload()
  await realOtto.check()
  await page.waitForTimeout(300)
  await expect(status).toHaveText('No task running.')
})

test('a kept task whose step the page no longer has is dropped, not guessed at', async ({ page }) => {
  await page.goto('/lab.html')
  await page.evaluate(() => sessionStorage.setItem('otto-kit:guide-task', JSON.stringify({ task: 'lab-follow', step: 'gone', savedAt: Date.now() })))
  await page.reload()
  await page.getByLabel('Use the real Otto').check()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('otto-kit:guide-task'))).toBeNull()
  await expect(page.getByText(/^(Task: |No task running)/)).toHaveText('No task running.')
})

test('leaving abandons a followed task', async ({ page }) => {
  await page.goto('/lab.html')
  await page.getByRole('button', { name: 'Start it', exact: true }).click()
  await page.getByRole('button', { name: 'App: visitor left' }).click()
  await expect(page.locator('#lab-guides + ol')).toContainText('task lab-follow cancelled (user)')
})

test('one failure gets a reaction only; the same failure again gets an offer of help', async ({ page }) => {
  await page.goto('/lab.html')
  const log = page.locator('#lab-guides + ol')
  const fail = page.getByRole('button', { name: /^Failure naming a help target/ })
  await fail.click()
  await page.waitForTimeout(300)
  await expect(log).not.toContainText('help for lab-right')
  await fail.click()
  await expect(log).toContainText('help for lab-right: failed 2 times: offer')
  await expect(log).toContainText('offered lab-right: waiting for a yes')
  // The visitor stays in control: nothing moves until they say yes.
  await page.getByRole('button', { name: 'Show me', exact: true }).click()
  await expect(log).toContainText(/shown lab-right: (point|approach)/)
})

test('the voice starts only a task the page offered', async ({ page }) => {
  await page.goto('/lab.html')
  await page.getByLabel('Use the real Otto').check()
  await page.getByRole('button', { name: 'Talk to Otto' }).dispatchEvent('click')
  const panel = page.getByRole('region', { name: 'Voice guide' })
  await panel.getByRole('button', { name: 'Start talking' }).click()
  await panel.getByRole('button', { name: 'Use text only' }).click()
  await expect(panel.getByRole('textbox', { name: 'Type a question instead' })).toBeEnabled()

  await page.getByRole('button', { name: 'Voice: start a task the page never offered' }).click()
  await page.getByRole('button', { name: 'Voice: start the followed task' }).click()
  const log = page.locator('#lab-guides + ol')
  await expect(log).toContainText('task step 1/3 (start): f1 -> lab-left')
  await expect(log).not.toContainText('not-offered')
  // The panel lists what Otto did, in words (D-06).
  await expect(panel).toContainText('Started: A task Otto follows')
})

test('the model hears which task is running and which step, only while a conversation is open', async ({ page }) => {
  await page.goto('/lab.html')
  await page.getByLabel('Use the real Otto').check()
  const ask = page.getByRole('button', { name: 'What the server knows of the running task' })
  const server = page.locator('#lab-server + ol')
  // No conversation yet: a running task stays in the browser.
  await page.getByRole('button', { name: 'Start it', exact: true }).click()
  await ask.click()
  await expect(server).toContainText('running task: null')

  await page.getByRole('button', { name: 'Talk to Otto' }).dispatchEvent('click')
  const panel = page.getByRole('region', { name: 'Voice guide' })
  await panel.getByRole('button', { name: 'Start talking' }).click()
  await panel.getByRole('button', { name: 'Use text only' }).click()
  await expect(panel.getByRole('textbox', { name: 'Type a question instead' })).toBeEnabled()
  // Opening the conversation sends it; each step the visitor takes updates it (sends are debounced, so poll).
  await expect(async () => { await ask.click(); await expect(server).toContainText('"id":"lab-follow"') }).toPass()
  await expect(server).toContainText('"step":1,"total":3')
  await page.locator('[data-otto-target="lab-left"]').dispatchEvent('click')
  await expect(async () => { await ask.click(); await expect(server).toContainText('"step":2,"total":3') }).toPass()
  // Ended: cleared, so the model never answers from a stale step.
  await page.getByRole('button', { name: 'App: visitor left' }).click()
  await expect(async () => { await ask.click(); await expect(server.locator('li').first()).toHaveText(/running task: null/) }).toPass()
})

test('the voice stops the running task, or moves it back or on a step', async ({ page }) => {
  await page.goto('/lab.html')
  await page.getByLabel('Use the real Otto').check()
  await page.getByRole('button', { name: 'Talk to Otto' }).dispatchEvent('click')
  const panel = page.getByRole('region', { name: 'Voice guide' })
  await panel.getByRole('button', { name: 'Start talking' }).click()
  await panel.getByRole('button', { name: 'Use text only' }).click()
  await expect(panel.getByRole('textbox', { name: 'Type a question instead' })).toBeEnabled()
  const status = page.getByText(/^(Task: |No task running)/)

  await page.getByRole('button', { name: 'Voice: start the followed task' }).click()
  await expect(status).toHaveText('Task: step 1 of 3: f1')
  await page.getByRole('button', { name: 'Voice: task next' }).click()
  await expect(status).toHaveText('Task: step 2 of 3: f2')
  await page.getByRole('button', { name: 'Voice: task back' }).click()
  await expect(status).toHaveText('Task: step 1 of 3: f1')
  await page.getByRole('button', { name: 'Voice: task stop' }).click()
  await expect(status).toHaveText('No task running.')
  await expect(page.locator('#lab-guides + ol')).toContainText('task lab-follow cancelled (user)')
  // The panel says each move in words (D-06).
  for (const words of ['Moved on a step', 'Went back a step', 'Stopped the task']) await expect(panel).toContainText(words)
})

