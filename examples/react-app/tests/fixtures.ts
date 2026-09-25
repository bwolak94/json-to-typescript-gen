/**
 * Playwright fixtures: starts a fresh mock server per test worker and
 * injects it alongside the standard Playwright test helpers.
 */
import { test as base } from '@playwright/test'
import { createMockServer } from '@quick-mock-server/core'
import { mockServerFixture } from '@quick-mock-server/testing'
import type { MockServer } from '@quick-mock-server/core'

export { expect } from '@playwright/test'

export const test = base.extend<{ mockServer: MockServer }>({
  mockServer: mockServerFixture({ port: 4001 }),
})

export { createMockServer }
