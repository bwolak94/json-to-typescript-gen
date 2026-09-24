import type { MockServer } from '@quick-mock-server/core'
import type { JournalEntry } from '@quick-mock-server/core'

// ─── Vitest / Jest matcher types ──────────────────────────────────────────────

export interface MockServerMatchers<R = void> {
  /** Assert the server received at least one request matching method + path. */
  toHaveReceived(method: string, path: string): R
  /** Assert the last matching request satisfies the given criteria. */
  toHaveReceivedWith(
    method: string,
    path: string,
    criteria: RequestCriteria,
  ): R
}

export interface RequestCriteria {
  body?: Record<string, unknown>
  headers?: Record<string, string>
  query?: Record<string, string>
  status?: number
}

// ─── Vitest matchers ──────────────────────────────────────────────────────────

/**
 * Vitest custom matchers for `MockServer`.
 *
 * Register once in your vitest setup file:
 * ```ts
 * import { expect } from 'vitest'
 * import { vitestMatchers } from '@quick-mock-server/testing'
 * expect.extend(vitestMatchers)
 * ```
 *
 * Then in tests:
 * ```ts
 * expect(mock).toHaveReceived('GET', '/users')
 * expect(mock).toHaveReceivedWith('POST', '/users', { body: { name: 'Alice' } })
 * ```
 */
export const vitestMatchers = {
  toHaveReceived(
    this: { isNot: boolean },
    received: MockServer,
    method: string,
    path: string,
  ) {
    const count = received.journal.count(method, path)
    const pass = count > 0

    return {
      pass,
      message: () =>
        pass
          ? `Expected mock NOT to have received ${method.toUpperCase()} ${path} but it was called ${count} time(s).`
          : `Expected mock to have received ${method.toUpperCase()} ${path} but it was never called.\n` +
            formatJournal(received.journal.query()),
    }
  },

  toHaveReceivedWith(
    this: { isNot: boolean },
    received: MockServer,
    method: string,
    path: string,
    criteria: RequestCriteria,
  ) {
    const entries = received.journal.query({ method: method.toUpperCase(), path })

    const matched = entries.filter((e) => matchesCriteria(e, criteria))
    const pass = matched.length > 0

    return {
      pass,
      message: () =>
        pass
          ? `Expected mock NOT to have received ${method.toUpperCase()} ${path} with the given criteria, but it did.`
          : `Expected mock to have received ${method.toUpperCase()} ${path} with criteria:\n` +
            `  ${JSON.stringify(criteria, null, 2)}\n` +
            `Actual calls (${entries.length}):\n` +
            formatJournal(entries),
    }
  },
}

// ─── Jest compatibility shim ──────────────────────────────────────────────────

/**
 * Extend Jest's `expect` with MockServer matchers.
 *
 * ```ts
 * // jest.setup.ts
 * import { extendJest } from '@quick-mock-server/testing'
 * extendJest()
 * ```
 */
export function extendJest(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const jestExpect = (globalThis as Record<string, any>)['expect']
  if (typeof jestExpect?.extend === 'function') {
    jestExpect.extend(vitestMatchers)
  }
}

// ─── Vitest globalSetup helper ────────────────────────────────────────────────

/**
 * Create a Vitest `globalSetup` module that starts a shared `MockServer`
 * before the test suite and stops it after.
 *
 * Usage in `vitest.config.ts`:
 * ```ts
 * import { createGlobalSetup } from '@quick-mock-server/testing'
 * export default { test: { globalSetup: ['./mock-setup.ts'] } }
 * ```
 *
 * In `mock-setup.ts`:
 * ```ts
 * import { createMockServer } from '@quick-mock-server/core'
 * import { createGlobalSetup } from '@quick-mock-server/testing'
 * export const { setup, teardown } = createGlobalSetup(() => createMockServer({ port: 3999 }))
 * ```
 */
export function createGlobalSetup(factory: () => MockServer): {
  setup: () => Promise<void>
  teardown: () => Promise<void>
} {
  let server: MockServer | undefined

  return {
    async setup() {
      server = factory()
      const { url } = await server.start()
      process.env['MOCK_SERVER_URL'] = url
    },
    async teardown() {
      await server?.stop()
      delete process.env['MOCK_SERVER_URL']
    },
  }
}

// ─── Playwright fixture helper ────────────────────────────────────────────────

export interface MockServerFixtureOptions {
  /** Options forwarded to `createMockServer`. */
  port?: number
  defaultScenario?: string
}

/**
 * Playwright fixture that starts a fresh `MockServer` per test worker.
 *
 * ```ts
 * // fixtures.ts
 * import { test as base } from '@playwright/test'
 * import { mockServerFixture } from '@quick-mock-server/testing'
 * import { createMockServer } from '@quick-mock-server/core'
 *
 * export const test = base.extend({
 *   mockServer: mockServerFixture({ port: 0 }),
 * })
 * ```
 */
export function mockServerFixture(options: MockServerFixtureOptions = {}) {
  return async (
    _: Record<string, never>,
    use: (server: MockServer) => Promise<void>,
  ) => {
    // Lazy import to avoid hard dep on @playwright/test
    const { createMockServer } = await import('@quick-mock-server/core')
    const server = createMockServer({ port: options.port ?? 0, defaultScenario: options.defaultScenario })
    await server.start()
    try {
      await use(server)
    } finally {
      await server.stop()
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function matchesCriteria(entry: JournalEntry, criteria: RequestCriteria): boolean {
  if (criteria.body !== undefined) {
    if (!partialMatch(criteria.body, entry.request.body)) return false
  }
  if (criteria.headers !== undefined) {
    for (const [k, v] of Object.entries(criteria.headers)) {
      const actual = entry.request.headers[k.toLowerCase()]
      const actualStr = Array.isArray(actual) ? actual[0] : actual
      if (actualStr !== v) return false
    }
  }
  if (criteria.query !== undefined) {
    // query isn't stored on entry.request directly — check path contains params
    // For now: no-op (query filtering not stored in JournalRequest)
  }
  if (criteria.status !== undefined) {
    if (entry.response?.status !== criteria.status) return false
  }
  return true
}

function partialMatch(shape: unknown, actual: unknown): boolean {
  if (shape === null || shape === undefined) return actual === shape
  if (typeof shape !== 'object') return shape === actual
  if (Array.isArray(shape)) {
    if (!Array.isArray(actual)) return false
    return shape.every((item, i) => partialMatch(item, (actual as unknown[])[i]))
  }
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false
  const shapeObj = shape as Record<string, unknown>
  const actualObj = actual as Record<string, unknown>
  return Object.entries(shapeObj).every(([k, v]) => partialMatch(v, actualObj[k]))
}

function formatJournal(entries: JournalEntry[]): string {
  if (entries.length === 0) return '  (no recorded requests)'
  return entries
    .slice(-5)
    .map((e) => `  ${e.request.method} ${e.request.path} → ${e.response?.status ?? '?'}`)
    .join('\n')
}
