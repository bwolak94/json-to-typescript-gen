import { defineConfig } from '@quick-mock-server/core'

export default defineConfig({
  port: 4001,
  mocksDir: './mocks',
  cors: {
    origins: ['http://localhost:5173'],
    credentials: true,
  },
})
