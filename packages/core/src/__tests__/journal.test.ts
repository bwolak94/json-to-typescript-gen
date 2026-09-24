import { describe, it, expect, beforeEach } from 'vitest'
import { Journal, JournalAssertionError } from '../journal/index.js'
import type { JournalEntry } from '../journal/index.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

type EntryOverrides = Partial<Omit<JournalEntry, 'id' | 'routeId'>> & { routeId?: string }

function makeEntry(overrides: EntryOverrides = {}): Omit<JournalEntry, 'id'> {
  const { routeId, ...rest } = overrides
  const base: Omit<JournalEntry, 'id'> = {
    timestamp: Date.now(),
    request: { method: 'GET', path: '/users', headers: {}, body: undefined },
    routeId: 'users:list',
    response: { status: 200, headers: {} },
    duration: 5,
    scenario: '',
    ...rest,
  }
  if ('routeId' in overrides) {
    if (routeId !== undefined) base.routeId = routeId
    else delete base.routeId
  }
  return base
}

/** Make an entry with no routeId (unmatched request). */
function makeUnmatched(overrides: Omit<EntryOverrides, 'routeId'> = {}): Omit<JournalEntry, 'id'> {
  const e = makeEntry(overrides)
  delete e.routeId
  return e
}

// ─── Ring buffer ──────────────────────────────────────────────────────────────

describe('Journal — ring buffer', () => {
  it('starts empty', () => {
    const j = new Journal()
    expect(j.size).toBe(0)
    expect(j.query()).toEqual([])
  })

  it('records entries and returns them', () => {
    const j = new Journal()
    j.record(makeEntry())
    j.record(makeEntry())
    expect(j.size).toBe(2)
  })

  it('assigns sequential ids starting at 1', () => {
    const j = new Journal()
    const e1 = j.record(makeEntry())
    const e2 = j.record(makeEntry())
    expect(e1.id).toBe(1)
    expect(e2.id).toBe(2)
  })

  it('returns entries in chronological order', () => {
    const j = new Journal()
    j.record(makeEntry({ request: { method: 'GET', path: '/a', headers: {}, body: undefined } }))
    j.record(makeEntry({ request: { method: 'GET', path: '/b', headers: {}, body: undefined } }))
    const entries = j.query()
    expect(entries[0]!.request.path).toBe('/a')
    expect(entries[1]!.request.path).toBe('/b')
  })

  it('caps at maxSize and drops oldest entries', () => {
    const j = new Journal(3)
    j.record(makeEntry({ request: { method: 'GET', path: '/1', headers: {}, body: undefined } }))
    j.record(makeEntry({ request: { method: 'GET', path: '/2', headers: {}, body: undefined } }))
    j.record(makeEntry({ request: { method: 'GET', path: '/3', headers: {}, body: undefined } }))
    j.record(makeEntry({ request: { method: 'GET', path: '/4', headers: {}, body: undefined } }))

    expect(j.size).toBe(3)
    const paths = j.query().map((e) => e.request.path)
    expect(paths).toEqual(['/2', '/3', '/4'])
  })

  it('still returns correct order after wrap-around', () => {
    const j = new Journal(3)
    for (let i = 1; i <= 5; i++) {
      j.record(makeEntry({ request: { method: 'GET', path: `/${i}`, headers: {}, body: undefined } }))
    }
    const paths = j.query().map((e) => e.request.path)
    expect(paths).toEqual(['/3', '/4', '/5'])
  })

  it('clear() empties the buffer', () => {
    const j = new Journal()
    j.record(makeEntry())
    j.record(makeEntry())
    j.clear()
    expect(j.size).toBe(0)
    expect(j.query()).toEqual([])
  })

  it('ids continue incrementing after clear', () => {
    const j = new Journal()
    j.record(makeEntry())
    j.clear()
    const e = j.record(makeEntry())
    expect(e.id).toBe(2)
  })
})

// ─── Unmatched ────────────────────────────────────────────────────────────────

describe('Journal — unmatched requests', () => {
  it('unmatched list is empty initially', () => {
    const j = new Journal()
    expect(j.unmatched).toEqual([])
  })

  it('adds entry to unmatched when routeId is undefined', () => {
    const j = new Journal()
    j.record(makeUnmatched())
    expect(j.unmatched).toHaveLength(1)
  })

  it('does not add matched entries to unmatched', () => {
    const j = new Journal()
    j.record(makeEntry({ routeId: 'users:list' }))
    expect(j.unmatched).toHaveLength(0)
  })

  it('clear() also clears unmatched list', () => {
    const j = new Journal()
    j.record(makeUnmatched())
    j.clear()
    expect(j.unmatched).toHaveLength(0)
  })

  it('unmatched returns a copy (mutation-safe)', () => {
    const j = new Journal()
    j.record(makeUnmatched())
    const u = j.unmatched
    u.pop()
    expect(j.unmatched).toHaveLength(1)
  })
})

// ─── Query API ────────────────────────────────────────────────────────────────

describe('Journal — query()', () => {
  let j: Journal

  beforeEach(() => {
    j = new Journal()
    j.record(makeEntry({ request: { method: 'GET', path: '/users', headers: {}, body: undefined }, routeId: 'users:list' }))
    j.record(makeEntry({ request: { method: 'POST', path: '/users', headers: {}, body: undefined }, routeId: 'users:create' }))
    j.record(makeEntry({ request: { method: 'GET', path: '/orders', headers: {}, body: undefined }, routeId: 'orders:list' }))
    j.record(makeEntry({ request: { method: 'GET', path: '/users', headers: {}, body: undefined }, routeId: 'users:list' }))
  })

  it('no opts returns all entries', () => {
    expect(j.query()).toHaveLength(4)
  })

  it('filters by method', () => {
    const results = j.query({ method: 'POST' })
    expect(results).toHaveLength(1)
    expect(results[0]!.request.method).toBe('POST')
  })

  it('method filter is case-insensitive', () => {
    expect(j.query({ method: 'get' })).toHaveLength(3)
  })

  it('filters by path', () => {
    const results = j.query({ path: '/users' })
    expect(results).toHaveLength(3)
  })

  it('filters by method and path together', () => {
    const results = j.query({ method: 'GET', path: '/users' })
    expect(results).toHaveLength(2)
  })

  it('filters by routeId', () => {
    const results = j.query({ routeId: 'orders:list' })
    expect(results).toHaveLength(1)
  })

  it('returns empty array when nothing matches', () => {
    expect(j.query({ path: '/nonexistent' })).toEqual([])
  })

  it('filters by from timestamp', () => {
    const j2 = new Journal()
    const t0 = Date.now()
    j2.record(makeEntry({ timestamp: t0 - 200 }))
    j2.record(makeEntry({ timestamp: t0 - 100 }))
    j2.record(makeEntry({ timestamp: t0 }))
    const results = j2.query({ from: t0 - 100 })
    expect(results).toHaveLength(2)
  })

  it('filters by to timestamp', () => {
    const j2 = new Journal()
    const t0 = Date.now()
    j2.record(makeEntry({ timestamp: t0 - 200 }))
    j2.record(makeEntry({ timestamp: t0 - 100 }))
    j2.record(makeEntry({ timestamp: t0 }))
    const results = j2.query({ to: t0 - 100 })
    expect(results).toHaveLength(2)
  })

  it('filters by from + to range', () => {
    const j2 = new Journal()
    const t0 = Date.now()
    j2.record(makeEntry({ timestamp: t0 - 300 }))
    j2.record(makeEntry({ timestamp: t0 - 200 }))
    j2.record(makeEntry({ timestamp: t0 - 100 }))
    j2.record(makeEntry({ timestamp: t0 }))
    const results = j2.query({ from: t0 - 200, to: t0 - 100 })
    expect(results).toHaveLength(2)
  })

  it('returns all entries when no filter applied (omitted routeId)', () => {
    j.record(makeUnmatched())
    // No routeId filter → all entries including unmatched
    expect(j.query()).toHaveLength(5)
  })
})

// ─── count() ─────────────────────────────────────────────────────────────────

describe('Journal — count()', () => {
  it('returns 0 for no calls', () => {
    const j = new Journal()
    expect(j.count('GET', '/users')).toBe(0)
  })

  it('counts matching calls', () => {
    const j = new Journal()
    j.record(makeEntry({ request: { method: 'GET', path: '/users', headers: {}, body: undefined } }))
    j.record(makeEntry({ request: { method: 'GET', path: '/users', headers: {}, body: undefined } }))
    j.record(makeEntry({ request: { method: 'POST', path: '/users', headers: {}, body: undefined } }))
    expect(j.count('GET', '/users')).toBe(2)
    expect(j.count('POST', '/users')).toBe(1)
  })

  it('method comparison is case-insensitive', () => {
    const j = new Journal()
    j.record(makeEntry({ request: { method: 'GET', path: '/x', headers: {}, body: undefined } }))
    expect(j.count('get', '/x')).toBe(1)
  })
})

// ─── never() ─────────────────────────────────────────────────────────────────

describe('Journal — never()', () => {
  it('does not throw when route was never called', () => {
    const j = new Journal()
    expect(() => j.never('GET', '/users')).not.toThrow()
  })

  it('throws JournalAssertionError when route was called', () => {
    const j = new Journal()
    j.record(makeEntry({ request: { method: 'DELETE', path: '/users/1', headers: {}, body: undefined } }))
    expect(() => j.never('DELETE', '/users/1')).toThrow(JournalAssertionError)
  })

  it('error message includes method, path, and call count', () => {
    const j = new Journal()
    j.record(makeEntry({ request: { method: 'GET', path: '/secret', headers: {}, body: undefined } }))
    j.record(makeEntry({ request: { method: 'GET', path: '/secret', headers: {}, body: undefined } }))
    try {
      j.never('GET', '/secret')
    } catch (err) {
      expect((err as Error).message).toContain('GET')
      expect((err as Error).message).toContain('/secret')
      expect((err as Error).message).toContain('2')
    }
  })
})

// ─── lastCalledWith() ─────────────────────────────────────────────────────────

describe('Journal — lastCalledWith()', () => {
  it('returns last matching entry when no matcher', () => {
    const j = new Journal()
    j.record(makeEntry({ request: { method: 'GET', path: '/users', headers: {}, body: undefined } }))
    const e2 = j.record(makeEntry({ request: { method: 'GET', path: '/users', headers: {}, body: undefined }, duration: 99 }))
    const result = j.lastCalledWith('GET', '/users')
    expect(result.id).toBe(e2.id)
  })

  it('throws when no call recorded', () => {
    const j = new Journal()
    expect(() => j.lastCalledWith('GET', '/missing')).toThrow(JournalAssertionError)
  })

  it('error message says no calls recorded', () => {
    const j = new Journal()
    try {
      j.lastCalledWith('GET', '/missing')
    } catch (err) {
      expect((err as Error).message).toContain('No calls recorded')
    }
  })

  it('throws when calls exist but none match the matcher function', () => {
    const j = new Journal()
    j.record(makeEntry({ request: { method: 'POST', path: '/users', headers: {}, body: { role: 'admin' } } }))
    expect(() =>
      j.lastCalledWith('POST', '/users', (e) => (e.request.body as { role: string }).role === 'guest'),
    ).toThrow(JournalAssertionError)
  })

  it('error message mentions matcher mismatch when calls exist', () => {
    const j = new Journal()
    j.record(makeEntry({ request: { method: 'POST', path: '/orders', headers: {}, body: { qty: 1 } } }))
    try {
      j.lastCalledWith('POST', '/orders', () => false)
    } catch (err) {
      expect((err as Error).message).toContain('none matched')
    }
  })

  describe('function matcher', () => {
    it('filters by custom predicate', () => {
      const j = new Journal()
      j.record(makeEntry({ request: { method: 'POST', path: '/users', headers: {}, body: { role: 'admin' } } }))
      j.record(makeEntry({ request: { method: 'POST', path: '/users', headers: {}, body: { role: 'guest' } } }))
      const result = j.lastCalledWith(
        'POST',
        '/users',
        (e) => (e.request.body as { role: string }).role === 'admin',
      )
      expect((result.request.body as { role: string }).role).toBe('admin')
    })

    it('returns last of multiple matching entries', () => {
      const j = new Journal()
      j.record(makeEntry({ request: { method: 'GET', path: '/x', headers: {}, body: undefined }, duration: 1 }))
      j.record(makeEntry({ request: { method: 'GET', path: '/x', headers: {}, body: undefined }, duration: 2 }))
      const result = j.lastCalledWith('GET', '/x', () => true)
      expect(result.duration).toBe(2)
    })
  })

  describe('body partial-match object', () => {
    it('matches when body contains expected fields', () => {
      const j = new Journal()
      j.record(makeEntry({
        request: { method: 'POST', path: '/orders', headers: {}, body: { item: 'book', qty: 2, user: 'alice' } },
      }))
      const result = j.lastCalledWith('POST', '/orders', { item: 'book' })
      expect((result.request.body as { item: string }).item).toBe('book')
    })

    it('does not match when partial body field differs', () => {
      const j = new Journal()
      j.record(makeEntry({
        request: { method: 'POST', path: '/orders', headers: {}, body: { item: 'pen' } },
      }))
      expect(() =>
        j.lastCalledWith('POST', '/orders', { item: 'book' }),
      ).toThrow(JournalAssertionError)
    })

    it('nested partial match works', () => {
      const j = new Journal()
      j.record(makeEntry({
        request: { method: 'POST', path: '/events', headers: {}, body: { user: { id: '1', role: 'admin' }, action: 'login' } },
      }))
      const result = j.lastCalledWith('POST', '/events', { user: { role: 'admin' } })
      expect(result).toBeDefined()
    })
  })
})

// ─── Admin API integration ────────────────────────────────────────────────────

import { createAdminHandler } from '../admin/index.js'
import { StateStore } from '../state/store.js'
import http from 'node:http'

function startTestServer(handle: ReturnType<typeof createAdminHandler>) {
  const server = http.createServer((req, res) => { handle(req, res) })
  server.listen(0, '127.0.0.1')
  return new Promise<{ port: number; close: () => Promise<void> }>((resolve) => {
    server.once('listening', () => {
      const { port } = server.address() as import('node:net').AddressInfo
      resolve({ port, close: () => new Promise<void>((r) => server.close(() => r())) })
    })
  })
}

describe('Admin journal integration', () => {
  it('GET /__admin/journal returns recorded entries when journal is provided', async () => {
    const journal = new Journal()
    journal.record(makeEntry({ request: { method: 'GET', path: '/test', headers: {}, body: undefined }, routeId: 'test:get' }))

    const handle = createAdminHandler({
      getRoutes: () => [],
      state: new StateStore(),
      getChaos: () => ({}),
      setChaos: () => {},
      addRuntimeRoute: () => {},
      config: { path: '/__admin', enabled: true },
      journal,
    })

    const { port, close } = await startTestServer(handle)
    const res = await fetch(`http://127.0.0.1:${port}/__admin/journal`)
    const data = await res.json() as { entries: JournalEntry[] }
    expect(res.status).toBe(200)
    expect(data.entries).toHaveLength(1)
    expect(data.entries[0]!.routeId).toBe('test:get')
    await close()
  })

  it('DELETE /__admin/journal clears the journal', async () => {
    const journal = new Journal()
    journal.record(makeEntry())

    const handle = createAdminHandler({
      getRoutes: () => [],
      state: new StateStore(),
      getChaos: () => ({}),
      setChaos: () => {},
      addRuntimeRoute: () => {},
      config: { path: '/__admin', enabled: true },
      journal,
    })

    const { port, close } = await startTestServer(handle)
    const res = await fetch(`http://127.0.0.1:${port}/__admin/journal`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(journal.size).toBe(0)
    await close()
  })
})
