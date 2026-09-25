import { describe, it, expect, afterEach } from 'vitest'
import { createMockServer } from '@quick-mock-server/core'
import { createGlobalSetup, extendJest } from '../index.js'

// ─── createGlobalSetup ────────────────────────────────────────────────────────

describe('createGlobalSetup', () => {
  afterEach(() => {
    delete process.env['MOCK_SERVER_URL']
  })

  it('setup() starts the server and sets MOCK_SERVER_URL', async () => {
    const { setup, teardown } = createGlobalSetup(() => createMockServer({ port: 0 }))
    try {
      await setup()
      expect(process.env['MOCK_SERVER_URL']).toBeDefined()
      expect(process.env['MOCK_SERVER_URL']).toMatch(/^http:\/\//)
    } finally {
      await teardown()
    }
  })

  it('teardown() removes MOCK_SERVER_URL', async () => {
    const { setup, teardown } = createGlobalSetup(() => createMockServer({ port: 0 }))
    await setup()
    await teardown()
    expect(process.env['MOCK_SERVER_URL']).toBeUndefined()
  })

  it('server is reachable at the URL set by setup()', async () => {
    const { setup, teardown } = createGlobalSetup(() => {
      const server = createMockServer({ port: 0 })
      server.use({ method: 'GET', path: '/ping', status: 200, body: { ok: true } })
      return server
    })

    try {
      await setup()
      const url = process.env['MOCK_SERVER_URL']!
      const res = await fetch(`${url}/ping`)
      expect(res.status).toBe(200)
    } finally {
      await teardown()
    }
  })

  it('setup() can be called with a custom port factory', async () => {
    let factoryCalled = false
    const { setup, teardown } = createGlobalSetup(() => {
      factoryCalled = true
      return createMockServer({ port: 0 })
    })

    try {
      await setup()
      expect(factoryCalled).toBe(true)
    } finally {
      await teardown()
    }
  })

  it('teardown() is a no-op when setup() was not called', async () => {
    const { teardown } = createGlobalSetup(() => createMockServer({ port: 0 }))
    // Should not throw
    await expect(teardown()).resolves.toBeUndefined()
  })

  it('each call to createGlobalSetup is independent', async () => {
    const { setup: s1, teardown: t1 } = createGlobalSetup(() => createMockServer({ port: 0 }))
    const { setup: s2, teardown: t2 } = createGlobalSetup(() => createMockServer({ port: 0 }))

    try {
      await s1()
      const url1 = process.env['MOCK_SERVER_URL']
      await s2()
      const url2 = process.env['MOCK_SERVER_URL']
      // Second setup overwrites the env var — both are valid URLs
      expect(url1).toMatch(/^http:\/\//)
      expect(url2).toMatch(/^http:\/\//)
    } finally {
      await t1()
      await t2()
    }
  })
})

// ─── extendJest ───────────────────────────────────────────────────────────────

describe('extendJest', () => {
  it('is a no-op when globalThis.expect is undefined', () => {
    const original = (globalThis as Record<string, unknown>)['expect']
    delete (globalThis as Record<string, unknown>)['expect']
    try {
      // Must not throw
      expect(() => extendJest()).not.toThrow()
    } finally {
      if (original !== undefined) {
        (globalThis as Record<string, unknown>)['expect'] = original
      }
    }
  })

  it('is a no-op when globalThis.expect has no extend method', () => {
    const original = (globalThis as Record<string, unknown>)['expect']
    ;(globalThis as Record<string, unknown>)['expect'] = { notExtend: () => {} }
    try {
      expect(() => extendJest()).not.toThrow()
    } finally {
      (globalThis as Record<string, unknown>)['expect'] = original
    }
  })

  it('calls expect.extend when available', () => {
    const original = (globalThis as Record<string, unknown>)['expect']
    const extended: Record<string, unknown>[] = []
    ;(globalThis as Record<string, unknown>)['expect'] = {
      extend: (matchers: Record<string, unknown>) => extended.push(matchers),
    }
    try {
      extendJest()
      expect(extended.length).toBe(1)
      const matchers = extended[0]!
      expect(typeof matchers['toHaveReceived']).toBe('function')
      expect(typeof matchers['toHaveReceivedWith']).toBe('function')
    } finally {
      (globalThis as Record<string, unknown>)['expect'] = original
    }
  })
})
