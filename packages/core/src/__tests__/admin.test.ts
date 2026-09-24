import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { createAdminHandler, isAdminPath } from '../admin/index.js'
import { StateStore } from '../state/store.js'
import type { ChaosConfig } from '../chaos/index.js'
import type { CompiledRoute } from '../types.js'
import type { AdminDeps } from '../admin/index.js'

// ─── Test server helpers ──────────────────────────────────────────────────────

async function startServer(handler: (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void>) {
  const server = http.createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500).end()
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const { port } = server.address() as AddressInfo
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  }
}

async function req(
  url: string,
  method = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: unknown }> {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
  }
  if (body != null) init.body = JSON.stringify(body)
  const res = await fetch(url, init)
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json }
}

// ─── Fixture factory ──────────────────────────────────────────────────────────

function makeDeps(overrides: Partial<AdminDeps> = {}): AdminDeps {
  let chaos: ChaosConfig = {}
  const runtimeRoutes: CompiledRoute[] = []

  return {
    getRoutes: () => [],
    state: new StateStore(),
    getChaos: () => chaos,
    setChaos: (cfg) => { chaos = cfg },
    addRuntimeRoute: (r) => runtimeRoutes.push(r),
    config: { path: '/__admin', enabled: true },
    startedAt: new Date(Date.now() - 5000),
    ...overrides,
  }
}

// ─── isAdminPath ──────────────────────────────────────────────────────────────

describe('isAdminPath', () => {
  it('matches exact admin path', () => {
    expect(isAdminPath('/__admin', '/__admin')).toBe(true)
  })

  it('matches sub-paths', () => {
    expect(isAdminPath('/__admin/health', '/__admin')).toBe(true)
    expect(isAdminPath('/__admin/routes', '/__admin')).toBe(true)
  })

  it('does not match unrelated paths', () => {
    expect(isAdminPath('/users', '/__admin')).toBe(false)
    expect(isAdminPath('/admin', '/__admin')).toBe(false)
  })

  it('does not match path that starts with admin string but lacks slash', () => {
    expect(isAdminPath('/__adminextra', '/__admin')).toBe(false)
  })
})

// ─── Health ───────────────────────────────────────────────────────────────────

describe('GET /__admin/health', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let deps: AdminDeps

  beforeEach(async () => {
    deps = makeDeps()
    const handle = createAdminHandler(deps)
    server = await startServer(async (req, res) => { await handle(req, res) })
  })

  afterEach(() => server.close())

  it('returns 200 with status ok', async () => {
    const { status, body } = await req(`${server.url}/__admin/health`)
    expect(status).toBe(200)
    expect((body as { status: string }).status).toBe('ok')
  })

  it('includes uptime in seconds', async () => {
    const { body } = await req(`${server.url}/__admin/health`)
    expect(typeof (body as { uptime: number }).uptime).toBe('number')
    expect((body as { uptime: number }).uptime).toBeGreaterThanOrEqual(4)
  })
})

// ─── Routes ───────────────────────────────────────────────────────────────────

describe('GET /__admin/routes', () => {
  let server: Awaited<ReturnType<typeof startServer>>

  beforeEach(async () => {
    const route: CompiledRoute = {
      id: 'test:get:/users',
      method: 'GET',
      path: '/users',
      source: { file: 'mocks/users.yaml', line: 1 },
      priority: 10,
      responses: [],
    }
    const deps = makeDeps({ getRoutes: () => [route] })
    const handle = createAdminHandler(deps)
    server = await startServer(async (req, res) => { await handle(req, res) })
  })

  afterEach(() => server.close())

  it('returns array of route summaries', async () => {
    const { status, body } = await req(`${server.url}/__admin/routes`)
    expect(status).toBe(200)
    expect(Array.isArray(body)).toBe(true)
    expect((body as unknown[]).length).toBe(1)
  })

  it('includes id, method, path, source', async () => {
    const { body } = await req(`${server.url}/__admin/routes`)
    const route = (body as Record<string, unknown>[])[0]!
    expect(route['id']).toBe('test:get:/users')
    expect(route['method']).toBe('GET')
    expect(route['path']).toBe('/users')
    expect((route['source'] as Record<string, unknown>)['file']).toBe('mocks/users.yaml')
  })

  it('includes responseCount', async () => {
    const { body } = await req(`${server.url}/__admin/routes`)
    const route = (body as Record<string, unknown>[])[0]!
    expect(route['responseCount']).toBe(0)
  })
})

// ─── Scenario ────────────────────────────────────────────────────────────────

describe('GET /__admin/scenario', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let deps: AdminDeps

  beforeEach(async () => {
    deps = makeDeps()
    const handle = createAdminHandler(deps)
    server = await startServer(async (req, res) => { await handle(req, res) })
  })

  afterEach(() => server.close())

  it('returns current active scenario', async () => {
    const { status, body } = await req(`${server.url}/__admin/scenario`)
    expect(status).toBe(200)
    expect((body as { active: string }).active).toBe('')
  })

  it('reflects scenario set in store', async () => {
    deps.state.scenarios.set('error')
    const { body } = await req(`${server.url}/__admin/scenario`)
    expect((body as { active: string }).active).toBe('error')
  })
})

describe('PUT /__admin/scenario', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let deps: AdminDeps

  beforeEach(async () => {
    deps = makeDeps()
    const handle = createAdminHandler(deps)
    server = await startServer(async (req, res) => { await handle(req, res) })
  })

  afterEach(() => server.close())

  it('sets the active scenario and returns it', async () => {
    const { status, body } = await req(`${server.url}/__admin/scenario`, 'PUT', { scenario: 'happy' })
    expect(status).toBe(200)
    expect((body as { active: string }).active).toBe('happy')
    expect(deps.state.scenarios.active).toBe('happy')
  })

  it('returns 400 when body is missing scenario field', async () => {
    const { status } = await req(`${server.url}/__admin/scenario`, 'PUT', { name: 'x' })
    expect(status).toBe(400)
  })

  it('returns 400 when body is not an object', async () => {
    const { status } = await req(`${server.url}/__admin/scenario`, 'PUT', '"just-a-string"')
    expect(status).toBe(400)
  })

  it('switch is instant — subsequent GET returns new value', async () => {
    await req(`${server.url}/__admin/scenario`, 'PUT', { scenario: 'locked' })
    const { body } = await req(`${server.url}/__admin/scenario`)
    expect((body as { active: string }).active).toBe('locked')
  })
})

// ─── State reset ─────────────────────────────────────────────────────────────

describe('POST /__admin/state/reset', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let deps: AdminDeps

  beforeEach(async () => {
    deps = makeDeps()
    const handle = createAdminHandler(deps)
    server = await startServer(async (req, res) => { await handle(req, res) })
  })

  afterEach(() => server.close())

  it('returns 200 ok', async () => {
    const { status, body } = await req(`${server.url}/__admin/state/reset`, 'POST')
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
  })

  it('clears all collections', async () => {
    deps.state.collection('users').insert({ id: '1', name: 'Alice' })
    expect(deps.state.collection('users').size()).toBe(1)

    await req(`${server.url}/__admin/state/reset`, 'POST')

    expect(deps.state.collection('users').size()).toBe(0)
  })
})

// ─── State snapshot / restore ─────────────────────────────────────────────────

describe('POST /__admin/state/snapshot + restore', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let deps: AdminDeps

  beforeEach(async () => {
    deps = makeDeps()
    const handle = createAdminHandler(deps)
    server = await startServer(async (req, res) => { await handle(req, res) })
  })

  afterEach(() => server.close())

  it('snapshot returns a name', async () => {
    const { status, body } = await req(`${server.url}/__admin/state/snapshot`, 'POST')
    expect(status).toBe(200)
    expect(typeof (body as { name: string }).name).toBe('string')
  })

  it('accepts a custom name', async () => {
    const { body } = await req(`${server.url}/__admin/state/snapshot`, 'POST', { name: 'before-test' })
    expect((body as { name: string }).name).toBe('before-test')
  })

  it('auto-generates name when not provided', async () => {
    const { body } = await req(`${server.url}/__admin/state/snapshot`, 'POST')
    expect((body as { name: string }).name).toMatch(/^snap-\d+$/)
  })

  it('restore returns ok', async () => {
    const snapRes = await req(`${server.url}/__admin/state/snapshot`, 'POST', { name: 'test-snap' })
    const name = (snapRes.body as { name: string }).name

    const { status, body } = await req(`${server.url}/__admin/state/restore/${name}`, 'POST')
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
  })

  it('restore returns 404 for unknown name', async () => {
    const { status } = await req(`${server.url}/__admin/state/restore/no-such-snap`, 'POST')
    expect(status).toBe(404)
  })

  it('restores state captured at snapshot time', async () => {
    deps.state.collection('users').insert({ id: '1', name: 'Alice' })
    const snapRes = await req(`${server.url}/__admin/state/snapshot`, 'POST', { name: 'snap1' })
    const name = (snapRes.body as { name: string }).name

    // Mutate after snapshot
    deps.state.collection('users').insert({ id: '2', name: 'Bob' })
    expect(deps.state.collection('users').size()).toBe(2)

    await req(`${server.url}/__admin/state/restore/${name}`, 'POST')
    expect(deps.state.collection('users').size()).toBe(1)
    expect(deps.state.collection('users').get('1')!['name']).toBe('Alice')
  })
})

// ─── Journal ─────────────────────────────────────────────────────────────────

describe('Journal endpoints', () => {
  let server: Awaited<ReturnType<typeof startServer>>

  beforeEach(async () => {
    const handle = createAdminHandler(makeDeps())
    server = await startServer(async (req, res) => { await handle(req, res) })
  })

  afterEach(() => server.close())

  it('GET /__admin/journal returns empty entries', async () => {
    const { status, body } = await req(`${server.url}/__admin/journal`)
    expect(status).toBe(200)
    expect((body as { entries: unknown[] }).entries).toEqual([])
  })

  it('DELETE /__admin/journal returns ok', async () => {
    const { status, body } = await req(`${server.url}/__admin/journal`, 'DELETE')
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
  })
})

// ─── Chaos ────────────────────────────────────────────────────────────────────

describe('PUT /__admin/chaos', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let deps: AdminDeps

  beforeEach(async () => {
    deps = makeDeps()
    const handle = createAdminHandler(deps)
    server = await startServer(async (req, res) => { await handle(req, res) })
  })

  afterEach(() => server.close())

  it('updates chaos config and returns new config', async () => {
    const { status, body } = await req(`${server.url}/__admin/chaos`, 'PUT', { enabled: false })
    expect(status).toBe(200)
    expect((body as { enabled: boolean }).enabled).toBe(false)
    expect(deps.getChaos().enabled).toBe(false)
  })

  it('merges into existing config (does not wipe unrelated fields)', async () => {
    deps.setChaos({ latency: 100, errorRate: 0.1 })
    await req(`${server.url}/__admin/chaos`, 'PUT', { enabled: false })
    const cfg = deps.getChaos()
    expect(cfg.latency).toBe(100)
    expect(cfg.errorRate).toBe(0.1)
    expect(cfg.enabled).toBe(false)
  })

  it('returns 400 for invalid body', async () => {
    const { status } = await req(`${server.url}/__admin/chaos`, 'PUT', '"bad"')
    expect(status).toBe(400)
  })
})

// ─── Runtime route override ───────────────────────────────────────────────────

describe('POST /__admin/routes', () => {
  let server: Awaited<ReturnType<typeof startServer>>
  let addedRoutes: CompiledRoute[]

  beforeEach(async () => {
    addedRoutes = []
    const deps = makeDeps({ addRuntimeRoute: (r) => addedRoutes.push(r) })
    const handle = createAdminHandler(deps)
    server = await startServer(async (req, res) => { await handle(req, res) })
  })

  afterEach(() => server.close())

  it('adds route and returns 201 with id', async () => {
    const { status, body } = await req(`${server.url}/__admin/routes`, 'POST', {
      method: 'GET',
      path: '/flags',
      responses: [{ status: 200, headers: {}, body: { beta: true } }],
    })
    expect(status).toBe(201)
    expect(typeof (body as { id: string }).id).toBe('string')
    expect(addedRoutes).toHaveLength(1)
  })

  it('route id encodes method and path', async () => {
    await req(`${server.url}/__admin/routes`, 'POST', { method: 'POST', path: '/orders' })
    expect(addedRoutes[0]!.id).toBe('runtime:POST:/orders')
  })

  it('returns 400 when method is missing', async () => {
    const { status } = await req(`${server.url}/__admin/routes`, 'POST', { path: '/x' })
    expect(status).toBe(400)
  })

  it('returns 400 when path is missing', async () => {
    const { status } = await req(`${server.url}/__admin/routes`, 'POST', { method: 'GET' })
    expect(status).toBe(400)
  })
})

// ─── Token authentication ─────────────────────────────────────────────────────

describe('Token authentication', () => {
  let server: Awaited<ReturnType<typeof startServer>>

  beforeEach(async () => {
    const deps = makeDeps({ config: { path: '/__admin', enabled: true, token: 'secret123' } })
    const handle = createAdminHandler(deps)
    server = await startServer(async (req, res) => { await handle(req, res) })
  })

  afterEach(() => server.close())

  it('returns 401 without Authorization header', async () => {
    const { status } = await req(`${server.url}/__admin/health`)
    expect(status).toBe(401)
  })

  it('returns 401 with wrong token', async () => {
    const { status } = await req(`${server.url}/__admin/health`, 'GET', undefined, {
      Authorization: 'Bearer wrong',
    })
    expect(status).toBe(401)
  })

  it('returns 200 with correct token', async () => {
    const { status } = await req(`${server.url}/__admin/health`, 'GET', undefined, {
      Authorization: 'Bearer secret123',
    })
    expect(status).toBe(200)
  })
})

// ─── Disabled admin ───────────────────────────────────────────────────────────

describe('Admin disabled', () => {
  it('handler returns false (not handled) when enabled=false', async () => {
    const deps = makeDeps({ config: { path: '/__admin', enabled: false } })
    const handle = createAdminHandler(deps)

    const fakeReq = { url: '/__admin/health', method: 'GET', headers: {}, on: () => {} } as unknown as http.IncomingMessage
    const fakeRes = { writeHead: () => {}, end: () => {} } as unknown as http.ServerResponse

    const handled = await handle(fakeReq, fakeRes)
    expect(handled).toBe(false)
  })
})

// ─── Unknown admin endpoint ───────────────────────────────────────────────────

describe('Unknown admin endpoint', () => {
  let server: Awaited<ReturnType<typeof startServer>>

  beforeEach(async () => {
    const handle = createAdminHandler(makeDeps())
    server = await startServer(async (req, res) => { await handle(req, res) })
  })

  afterEach(() => server.close())

  it('returns 404 for unknown sub-path', async () => {
    const { status } = await req(`${server.url}/__admin/unknown-endpoint`)
    expect(status).toBe(404)
  })
})

// ─── Non-admin paths ──────────────────────────────────────────────────────────

describe('Non-admin paths', () => {
  it('handler returns false for non-admin URLs', async () => {
    const deps = makeDeps()
    const handle = createAdminHandler(deps)

    const fakeReq = { url: '/users', method: 'GET', headers: {}, on: () => {} } as unknown as http.IncomingMessage
    const fakeRes = {} as http.ServerResponse

    const handled = await handle(fakeReq, fakeRes)
    expect(handled).toBe(false)
  })
})
