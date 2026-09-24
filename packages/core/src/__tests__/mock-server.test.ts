import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createMockServer } from '../server/mock-server.js'
import type { MockServer } from '../server/mock-server.js'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

let server: MockServer

beforeEach(async () => {
  server = createMockServer({ port: 0 })
  await server.start()
})

afterEach(async () => {
  await server.stop()
})

async function get(path: string, headers?: Record<string, string>) {
  const init: RequestInit = {}
  if (headers !== undefined) init.headers = headers
  const res = await fetch(`${server.url}${path}`, init)
  const body = await res.json().catch(() => null)
  return { status: res.status, body, headers: res.headers }
}

async function post(path: string, body?: unknown) {
  const init: RequestInit = { method: 'POST', headers: { 'Content-Type': 'application/json' } }
  if (body != null) init.body = JSON.stringify(body)
  const res = await fetch(`${server.url}${path}`, init)
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

// ─── start / stop ─────────────────────────────────────────────────────────────

describe('createMockServer — lifecycle', () => {
  it('start() returns url and port', async () => {
    const s = createMockServer({ port: 0 })
    const result = await s.start()
    expect(result.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    expect(result.port).toBeGreaterThan(0)
    await s.stop()
  })

  it('url is set after start()', async () => {
    const s = createMockServer({ port: 0 })
    expect(s.url).toBe('')
    await s.start()
    expect(s.url).toMatch(/^http:\/\//)
    await s.stop()
  })

  it('url is cleared after stop()', async () => {
    const s = createMockServer({ port: 0 })
    await s.start()
    await s.stop()
    expect(s.url).toBe('')
  })

  it('port: 0 gives unique ports for parallel servers', async () => {
    const s1 = createMockServer({ port: 0 })
    const s2 = createMockServer({ port: 0 })
    const [r1, r2] = await Promise.all([s1.start(), s2.start()])
    expect(r1.port).not.toBe(r2.port)
    await Promise.all([s1.stop(), s2.stop()])
  })
})

// ─── use() — runtime route overrides ─────────────────────────────────────────

describe('server.use()', () => {
  it('registers a GET route', async () => {
    server.use({ path: '/hello', body: { message: 'hi' } })
    const { status, body } = await get('/hello')
    expect(status).toBe(200)
    expect((body as { message: string }).message).toBe('hi')
  })

  it('respects custom status code', async () => {
    server.use({ path: '/gone', status: 410, body: { error: 'gone' } })
    const { status } = await get('/gone')
    expect(status).toBe(410)
  })

  it('respects custom headers', async () => {
    server.use({ path: '/custom', headers: { 'x-foo': 'bar' }, body: {} })
    const { headers } = await get('/custom')
    expect(headers.get('x-foo')).toBe('bar')
  })

  it('registers a POST route', async () => {
    server.use({ method: 'POST', path: '/echo', status: 201, body: { ok: true } })
    const { status } = await post('/echo', { name: 'test' })
    expect(status).toBe(201)
  })

  it('later use() calls take priority (prepended)', async () => {
    server.use({ path: '/x', status: 200, body: { v: 1 } })
    server.use({ path: '/x', status: 200, body: { v: 2 } })
    const { body } = await get('/x')
    expect((body as { v: number }).v).toBe(2)
  })

  it('path params work', async () => {
    server.use({ path: '/users/:id', body: { ok: true } })
    const { status } = await get('/users/42')
    expect(status).toBe(200)
  })

  it('returns 404 for unregistered paths', async () => {
    const { status } = await get('/not-registered')
    expect(status).toBe(404)
  })

  it('multiple responses with scenario', async () => {
    server.use({
      path: '/flag',
      responses: [
        { scenario: 'on', status: 200, headers: {}, body: { enabled: true } },
        { scenario: 'off', status: 200, headers: {}, body: { enabled: false } },
      ],
    })

    server.scenario('on')
    const r1 = await get('/flag')
    expect((r1.body as { enabled: boolean }).enabled).toBe(true)

    server.scenario('off')
    const r2 = await get('/flag')
    expect((r2.body as { enabled: boolean }).enabled).toBe(false)
  })
})

// ─── scenario() ───────────────────────────────────────────────────────────────

describe('server.scenario()', () => {
  it('sets the active scenario', () => {
    server.scenario('happy')
    expect(server.state.scenarios.active).toBe('happy')
  })

  it('scenario switch affects route matching', async () => {
    server.use({
      path: '/status',
      responses: [
        { scenario: 'error', status: 503, headers: {}, body: { error: true } },
        { status: 200, headers: {}, body: { error: false } },
      ],
    })

    const r1 = await get('/status')
    expect(r1.status).toBe(200)

    server.scenario('error')
    const r2 = await get('/status')
    expect(r2.status).toBe(503)
  })

  it('X-Mock-Scenario header overrides globally', async () => {
    server.scenario('happy')
    server.use({
      path: '/check',
      responses: [
        { scenario: 'locked', status: 423, headers: {}, body: { locked: true } },
        { status: 200, headers: {}, body: { locked: false } },
      ],
    })

    const r = await get('/check', { 'x-mock-scenario': 'locked' })
    expect(r.status).toBe(423)
    expect(server.state.scenarios.active).toBe('happy') // unchanged
  })
})

// ─── state ────────────────────────────────────────────────────────────────────

describe('server.state', () => {
  it('exposes the StateStore', () => {
    expect(server.state).toBeDefined()
    expect(typeof server.state.collection).toBe('function')
  })

  it('state mutations are visible across requests', async () => {
    server.use({
      method: 'GET',
      path: '/count',
      body: null,
    })
    server.state.collection('items').insert({ id: '1', name: 'test' })
    expect(server.state.collection('items').size()).toBe(1)
  })
})

// ─── journal ─────────────────────────────────────────────────────────────────

describe('server.journal', () => {
  it('records requests', async () => {
    server.use({ path: '/ping', body: 'pong' })
    await get('/ping')
    expect(server.journal.count('GET', '/ping')).toBe(1)
  })

  it('records unmatched requests', async () => {
    await get('/nonexistent')
    expect(server.journal.unmatched).toHaveLength(1)
  })

  it('records routeId for matched routes', async () => {
    server.use({ path: '/api', body: {} })
    await get('/api')
    const entries = server.journal.query({ path: '/api' })
    expect(entries[0]!.routeId).toMatch(/^runtime:GET:\/api:/)
  })

  it('records response status', async () => {
    server.use({ path: '/ok', status: 202, body: {} })
    await get('/ok')
    const entry = server.journal.query({ path: '/ok' })[0]!
    expect(entry.response?.status).toBe(202)
  })

  it('admin requests are NOT recorded in journal', async () => {
    await get('/__admin/health')
    expect(server.journal.size).toBe(0)
  })
})

// ─── Admin API integration ────────────────────────────────────────────────────

describe('Admin API via createMockServer', () => {
  it('GET /__admin/health returns ok', async () => {
    const { status, body } = await get('/__admin/health')
    expect(status).toBe(200)
    expect((body as { status: string }).status).toBe('ok')
  })

  it('PUT /__admin/scenario switches scenario', async () => {
    const res = await fetch(`${server.url}/__admin/scenario`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario: 'test' }),
    })
    expect(res.status).toBe(200)
    expect(server.state.scenarios.active).toBe('test')
  })

  it('POST /__admin/state/reset clears collections', async () => {
    server.state.collection('users').insert({ id: '1' })
    await fetch(`${server.url}/__admin/state/reset`, { method: 'POST' })
    expect(server.state.collection('users').size()).toBe(0)
  })

  it('GET /__admin/journal returns entries', async () => {
    server.use({ path: '/test', body: {} })
    await get('/test')
    const { body } = await get('/__admin/journal')
    expect((body as { entries: unknown[] }).entries).toHaveLength(1)
  })

  it('DELETE /__admin/journal clears entries', async () => {
    server.use({ path: '/test', body: {} })
    await get('/test')
    await fetch(`${server.url}/__admin/journal`, { method: 'DELETE' })
    expect(server.journal.size).toBe(0)
  })
})

// ─── X-Mock-Route header ──────────────────────────────────────────────────────

describe('X-Mock-Route header', () => {
  it('is present in matched responses', async () => {
    server.use({ path: '/hdr', body: {} })
    const { headers } = await get('/hdr')
    expect(headers.get('x-mock-route')).toMatch(/^runtime:GET:\/hdr:/)
  })
})
