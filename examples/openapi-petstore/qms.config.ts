import { defineConfig } from '@quick-mock-server/core'

export default defineConfig({
  port: 4000,
  mocksDir: './mocks',
  cors: true,
  // Auto-import the OpenAPI spec on startup.
  // Run `qms openapi import ./specs/petstore.yaml --out ./mocks` first
  // to generate the YAML mock files.
  openapi: [],
})
