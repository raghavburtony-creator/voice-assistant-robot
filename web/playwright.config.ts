import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  workers: 1, // one dev server, software WebGL is CPU-heavy
  reporter: 'list',
  use: { baseURL: 'http://localhost:5199', headless: true },
  projects: [{
    name: 'chromium',
    use: {
      ...devices['Desktop Chrome'],
      // Software WebGL 2 for headless Chromium.
      launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
    },
  }],
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    url: 'http://localhost:5199/lab.html',
    reuseExistingServer: !process.env.CI,
  },
})
