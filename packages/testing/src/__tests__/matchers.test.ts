import { describe, it, expect } from 'vitest'
import { vitestMatchers } from '../index.js'
import type { MockServer } from '@quick-mock-server/core'
import type { JournalEntry } from '@quick-mock-server/core'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(overrides: {
  method?: string
  path?: string
  body?: unknown
  headers?: Record<string, string>
  status?: number
}): JournalEntry {
  return {
    id: 1,
    timestamp: Date.now(),
    duration: 0,
    scenario: '',
    request: {
      method: overrides.method ?? 'GET',
      path:   overrides.path   ?? '/',
      headers: overrides.headers ?? {},
      body:   overrides.body,
    },
    response: overrides.status !== undefined ? { status: overrides.status, headers: {} } : undefined,
  }
}

/** Build a minimal MockServer stub with a fake journal backed by `entries`. */
function makeServer(entries: JournalEntry[]): MockServer {
  return {
    journal: {
      count: (method: string, path: string) =>
        entries.filter(
          (e) =>
            e.request.method.toUpperCase() === method.toUpperCase() &&
            e.request.path === path,
        ).length,
      query: (opts: { method?: string; path?: string } = {}) =>
        entries.filter((e) => {
          if (opts.method && e.request.method.toUpperCase() !== opts.method.toUpperCase()) return false
          if (opts.path && e.request.path !== opts.path) return false
          return true
        }),
    },
  } as unknown as MockServer
}

/** Call a matcher directly (simulates what vitest does internally). */
function run(
  name: 'toHaveReceived' | 'toHaveReceivedWith',
  server: MockServer,
  ...args: unknown[]
) {
  const ctx = { isNot: false }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (vitestMatchers[name] as any).call(ctx, server, ...args) as {
    pass: boolean
    message: () => string
  }
}

// ─── toHaveReceived ───────────────────────────────────────────────────────────

describe('toHaveReceived', () => {
  it('passes when the journal has at least one matching entry', () => {
    const server = makeServer([makeEntry({ method: 'GET', path: '/users' })])
    const result = run('toHaveReceived', server, 'GET', '/users')
    expect(result.pass).toBe(true)
  })

  it('fails when the journal has no matching entry', () => {
    const server = makeServer([])
    const result = run('toHaveReceived', server, 'GET', '/users')
    expect(result.pass).toBe(false)
  })

  it('passes with multiple entries', () => {
    const server = makeServer([
      makeEntry({ method: 'GET', path: '/users' }),
      makeEntry({ method: 'GET', path: '/users' }),
    ])
    const result = run('toHaveReceived', server, 'GET', '/users')
    expect(result.pass).toBe(true)
  })

  it('does not match a different path', () => {
    const server = makeServer([makeEntry({ method: 'GET', path: '/items' })])
    const result = run('toHaveReceived', server, 'GET', '/users')
    expect(result.pass).toBe(false)
  })

  it('does not match a different method', () => {
    const server = makeServer([makeEntry({ method: 'POST', path: '/users' })])
    const result = run('toHaveReceived', server, 'GET', '/users')
    expect(result.pass).toBe(false)
  })

  it('is case-insensitive for method', () => {
    const server = makeServer([makeEntry({ method: 'GET', path: '/users' })])
    const result = run('toHaveReceived', server, 'get', '/users')
    expect(result.pass).toBe(true)
  })

  it('failure message names the method and path', () => {
    const server = makeServer([])
    const result = run('toHaveReceived', server, 'GET', '/users')
    expect(result.message()).toContain('GET')
    expect(result.message()).toContain('/users')
  })

  it('success message (for .not) names the call count', () => {
    const server = makeServer([
      makeEntry({ method: 'GET', path: '/users' }),
      makeEntry({ method: 'GET', path: '/users' }),
    ])
    const result = run('toHaveReceived', server, 'GET', '/users')
    expect(result.message()).toContain('2')
  })
})

// ─── toHaveReceivedWith ───────────────────────────────────────────────────────

describe('toHaveReceivedWith', () => {
  it('passes when body criteria match', () => {
    const server = makeServer([
      makeEntry({ method: 'POST', path: '/users', body: { name: 'Alice' }, status: 201 }),
    ])
    const result = run('toHaveReceivedWith', server, 'POST', '/users', { body: { name: 'Alice' } })
    expect(result.pass).toBe(true)
  })

  it('fails when no entries exist', () => {
    const server = makeServer([])
    const result = run('toHaveReceivedWith', server, 'POST', '/users', { body: { name: 'Alice' } })
    expect(result.pass).toBe(false)
  })

  it('fails when body does not match', () => {
    const server = makeServer([
      makeEntry({ method: 'POST', path: '/users', body: { name: 'Bob' } }),
    ])
    const result = run('toHaveReceivedWith', server, 'POST', '/users', { body: { name: 'Alice' } })
    expect(result.pass).toBe(false)
  })

  it('performs partial body matching', () => {
    const server = makeServer([
      makeEntry({ method: 'POST', path: '/users', body: { name: 'Alice', role: 'admin' } }),
    ])
    // Only check `name` — extra fields are allowed
    const result = run('toHaveReceivedWith', server, 'POST', '/users', { body: { name: 'Alice' } })
    expect(result.pass).toBe(true)
  })

  it('passes when status criteria match', () => {
    const server = makeServer([
      makeEntry({ method: 'GET', path: '/users', status: 200 }),
    ])
    const result = run('toHaveReceivedWith', server, 'GET', '/users', { status: 200 })
    expect(result.pass).toBe(true)
  })

  it('fails when status does not match', () => {
    const server = makeServer([
      makeEntry({ method: 'GET', path: '/users', status: 200 }),
    ])
    const result = run('toHaveReceivedWith', server, 'GET', '/users', { status: 201 })
    expect(result.pass).toBe(false)
  })

  it('passes when header criteria match', () => {
    const server = makeServer([
      makeEntry({ method: 'GET', path: '/users', headers: { 'x-api-key': 'abc' } }),
    ])
    const result = run('toHaveReceivedWith', server, 'GET', '/users', {
      headers: { 'x-api-key': 'abc' },
    })
    expect(result.pass).toBe(true)
  })

  it('fails when header value does not match', () => {
    const server = makeServer([
      makeEntry({ method: 'GET', path: '/users', headers: { 'x-api-key': 'abc' } }),
    ])
    const result = run('toHaveReceivedWith', server, 'GET', '/users', {
      headers: { 'x-api-key': 'wrong' },
    })
    expect(result.pass).toBe(false)
  })

  it('passes when multiple criteria all match', () => {
    const server = makeServer([
      makeEntry({
        method: 'POST',
        path: '/users',
        body: { name: 'Alice' },
        headers: { 'content-type': 'application/json' },
        status: 201,
      }),
    ])
    const result = run('toHaveReceivedWith', server, 'POST', '/users', {
      body: { name: 'Alice' },
      headers: { 'content-type': 'application/json' },
      status: 201,
    })
    expect(result.pass).toBe(true)
  })

  it('fails when one of multiple criteria does not match', () => {
    const server = makeServer([
      makeEntry({
        method: 'POST',
        path: '/users',
        body: { name: 'Alice' },
        status: 200, // wrong status
      }),
    ])
    const result = run('toHaveReceivedWith', server, 'POST', '/users', {
      body: { name: 'Alice' },
      status: 201,
    })
    expect(result.pass).toBe(false)
  })

  it('passes on empty criteria object (any call to the route)', () => {
    const server = makeServer([makeEntry({ method: 'GET', path: '/ping' })])
    const result = run('toHaveReceivedWith', server, 'GET', '/ping', {})
    expect(result.pass).toBe(true)
  })

  it('passes when ANY entry among multiple matches the criteria', () => {
    const server = makeServer([
      makeEntry({ method: 'POST', path: '/users', body: { name: 'Bob' } }),
      makeEntry({ method: 'POST', path: '/users', body: { name: 'Alice' } }),
    ])
    const result = run('toHaveReceivedWith', server, 'POST', '/users', { body: { name: 'Alice' } })
    expect(result.pass).toBe(true)
  })

  it('failure message includes criteria and actual calls', () => {
    const server = makeServer([
      makeEntry({ method: 'POST', path: '/users', body: { name: 'Bob' } }),
    ])
    const result = run('toHaveReceivedWith', server, 'POST', '/users', { body: { name: 'Alice' } })
    const msg = result.message()
    expect(msg).toContain('POST')
    expect(msg).toContain('/users')
    expect(msg).toContain('Alice')
  })
})
