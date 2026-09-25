import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,   // mock server per worker — keep sequential for simplicity
  retries: 0,
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  webServer: {
    command: 'vite',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
})
