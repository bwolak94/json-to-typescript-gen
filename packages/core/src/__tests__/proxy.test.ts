import http from 'node:http'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createMockServer } from '../server/mock-server.js'
import { rewritePath, stripHopByHop } from '../proxy/index.js'
import type { MockServer } from '../server/mock-server.js'

// ─── Upstream fixture ─────────────────────────────────────────────────────────

let upstream: http.Server
let upstreamUrl: string

/** Last request received by the upstream server. */
let lastUpstreamReq: {
  method: string
  url: string
  headers: http.IncomingHttpHeaders
  body: string
}

function startUpstream(): Promise<void> {
  return new Promise((resolve) => {
    upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        lastUpstreamReq = {
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf-8'),
        }
        const reply = JSON.stringify({ upstream: true, path: req.url })
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': String(Buffer.byteLength(reply)),
          'x-upstream': 'yes',
        })
        res.end(reply)
      })
    })
    upstream.listen(0, '127.0.0.1', () => {
      const addr = upstream.address() as import('node:net').AddressInfo
      upstreamUrl = `http://127.0.0.1:${addr.port}`
      resolve()
    })
  })
}

function stopUpstream(): Promise<void> {
  return new Promise((resolve, reject) => {
    upstream.close((err) => (err ? reject(err) : resolve()))
  })
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function get(url: string, headers?: Record<string, string>) {
  const init: RequestInit = {}
  if (headers !== undefined) init.headers = headers
  const res = await fetch(url, init)
  const body = await res.json().catch(() => null)
  return { status: res.status, body, headers: res.headers }
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

// ─── rewritePath ──────────────────────────────────────────────────────────────

describe('rewritePath', () => {
  it('returns path unchanged when no rules', () => {
    expect(rewritePath('/api/users', {})).toBe('/api/users')
  })

  it('strips prefix with anchor regex', () => {
    expect(rewritePath('/api/users', { '^/api': '' })).toBe('/users')
  })

  it('replaces multiple rules in order', () => {
    expect(rewritePath('/v1/api/users', { '^/v1': '', '^/api': '' })).toBe('/users')
  })

  it('returns "/" when result is empty', () => {
    expect(rewritePath('/api', { '^/api': '' })).toBe('/')
  })

  it('handles no match gracefully', () => {
    expect(rewritePath('/other', { '^/api': '' })).toBe('/other')
  })
})

// ─── stripHopByHop ────────────────────────────────────────────────────────────

describe('stripHopByHop', () => {
  it('removes connection header', () => {
    const out = stripHopByHop({ connection: 'keep-alive', 'x-custom': 'yes' })
    expect(out['connection']).toBeUndefined()
    expect(out['x-custom']).toBe('yes')
  })

  it('removes transfer-encoding header', () => {
    const out = stripHopByHop({ 'transfer-encoding': 'chunked', 'content-type': 'application/json' })
    expect(out['transfer-encoding']).toBeUndefined()
    expect(out['content-type']).toBe('application/json')
  })

  it('removes all hop-by-hop headers', () => {
    const hopByHop = ['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate', 'proxy-connection']
    const input: Record<string, string> = {}
    for (const h of hopByHop) input[h] = 'value'
    input['x-keep'] = 'yes'
    const out = stripHopByHop(input)
    for (const h of hopByHop) expect(out[h]).toBeUndefined()
    expect(out['x-keep']).toBe('yes')
  })

  it('skips undefined values', () => {
    const out = stripHopByHop({ 'x-a': undefined, 'x-b': 'ok' })
    expect(out['x-a']).toBeUndefined()
    expect(out['x-b']).toBe('ok')
  })
})

// ─── Proxy passthrough integration ───────────────────────────────────────────

describe('proxy passthrough', () => {
  let server: MockServer

  beforeEach(async () => {
    await startUpstream()
    server = createMockServer({
      port: 0,
      proxy: { target: upstreamUrl, mode: 'passthrough' },
    })
    await server.start()
  })

  afterEach(async () => {
    await server.stop()
    await stopUpstream()
  })

  it('forwards unmatched GET request to upstream', async () => {
    const { status, body } = await get(`${server.url}/hello`)
    expect(status).toBe(200)
    expect((body as { upstream: boolean }).upstream).toBe(true)
  })

  it('includes upstream response headers', async () => {
    const { headers } = await get(`${server.url}/hello`)
    expect(headers.get('x-upstream')).toBe('yes')
  })

  it('rewrites Host header to upstream host', async () => {
    await get(`${server.url}/check`)
    const upstreamHost = new URL(upstreamUrl).host
    expect(lastUpstreamReq.headers['host']).toBe(upstreamHost)
  })

  it('strips proxy-connection hop-by-hop header from forwarded request', async () => {
    await get(`${server.url}/check`, { 'proxy-connection': 'keep-alive' })
    expect(lastUpstreamReq.headers['proxy-connection']).toBeUndefined()
  })

  it('forwards the correct path', async () => {
    await get(`${server.url}/some/deep/path`)
    expect(lastUpstreamReq.url).toBe('/some/deep/path')
  })

  it('forwards query string', async () => {
    await get(`${server.url}/search?q=hello&page=2`)
    expect(lastUpstreamReq.url).toBe('/search?q=hello&page=2')
  })

  it('forwards POST body to upstream', async () => {
    await post(`${server.url}/data`, { name: 'test' })
    expect(JSON.parse(lastUpstreamReq.body)).toEqual({ name: 'test' })
  })

  it('matched routes are served locally, not proxied', async () => {
    server.use({ path: '/local', body: { local: true } })
    const { body } = await get(`${server.url}/local`)
    expect((body as { local: boolean }).local).toBe(true)
    // Verify upstream was NOT hit
    expect(lastUpstreamReq?.url).not.toBe('/local')
  })
})

// ─── pathRewrite ──────────────────────────────────────────────────────────────

describe('proxy pathRewrite', () => {
  let server: MockServer

  beforeEach(async () => {
    await startUpstream()
    server = createMockServer({
      port: 0,
      proxy: {
        target: upstreamUrl,
        mode: 'passthrough',
        pathRewrite: { '^/api': '' },
      },
    })
    await server.start()
  })

  afterEach(async () => {
    await server.stop()
    await stopUpstream()
  })

  it('strips /api prefix before forwarding', async () => {
    await get(`${server.url}/api/users`)
    expect(lastUpstreamReq.url).toBe('/users')
  })

  it('leaves non-matching paths unchanged', async () => {
    await get(`${server.url}/other/path`)
    expect(lastUpstreamReq.url).toBe('/other/path')
  })
})

// ─── off mode (default behaviour) ────────────────────────────────────────────

describe('proxy off mode', () => {
  let server: MockServer

  beforeEach(async () => {
    server = createMockServer({
      port: 0,
      proxy: { target: 'http://localhost:1', mode: 'off' },
    })
    await server.start()
  })

  afterEach(async () => { await server.stop() })

  it('returns 404 for unmatched requests when mode is off', async () => {
    const { status } = await get(`${server.url}/anything`)
    expect(status).toBe(404)
  })
})

describe('no proxy config', () => {
  let server: MockServer

  beforeEach(async () => {
    server = createMockServer({ port: 0 })
    await server.start()
  })

  afterEach(async () => { await server.stop() })

  it('returns 404 when no proxy configured', async () => {
    const { status } = await get(`${server.url}/unmatched`)
    expect(status).toBe(404)
  })
})
