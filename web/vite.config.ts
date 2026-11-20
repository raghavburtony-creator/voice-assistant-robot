import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { configDefaults } from 'vitest/config'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Playwright's browser tests live in e2e/ and run with `npm run test:e2e`, not Vitest.
  test: { exclude: [...configDefaults.exclude, 'e2e/**'] },
  server: {
    // The voice server (../server), including its WebSocket.
    proxy: { '/api': { target: 'http://127.0.0.1:8000', ws: true } },
  },
})
