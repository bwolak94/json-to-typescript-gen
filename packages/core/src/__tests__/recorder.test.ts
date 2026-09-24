import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parse } from 'yaml'
import {
  maskHeaders,
  buildSlug,
  buildFixturePath,
  readFixture,
  writeFixture,
} from '../recorder/index.js'
import { createMockServer } from '../server/mock-server.js'
import type { MockServer } from '../server/mock-server.js'

// ─── maskHeaders ─────────────────────────────────────────────────────────────

describe('maskHeaders', () => {
  it('strips authorization header', () => {
    const out = maskHeaders({ authorization: 'Bearer secret', 'x-other': 'keep' })
    expect(out['authorization']).toBeUndefined()
    expect(out['x-other']).toBe('keep')
  })

  it('strips cookie header', () => {
    const out = maskHeaders({ cookie: 'session=abc', 'content-type': 'application/json' })
    expect(out['cookie']).toBeUndefined()
    expect(out['content-type']).toBe('application/json')
  })

  it('strips set-cookie header', () => {
    const out = maskHeaders({ 'set-cookie': 'session=abc; Path=/', 'x-keep': 'yes' })
    expect(out['set-cookie']).toBeUndefined()
    expect(out['x-keep']).toBe('yes')
  })

  it('strips user-configured sensitiveFields', () => {
    const out = maskHeaders({ 'x-api-key': 'secret', 'x-other': 'keep' }, ['x-api-key'])
    expect(out['x-api-key']).toBeUndefined()
    expect(out['x-other']).toBe('keep')
  })

  it('sensitiveFields match is case-insensitive', () => {
    const out = maskHeaders({ 'X-API-KEY': 'secret', 'x-other': 'keep' }, ['x-api-key'])
    expect(out['X-API-KEY']).toBeUndefined()
    expect(out['x-other']).toBe('keep')
  })

  it('preserves unrelated headers', () => {
    const out = maskHeaders({ 'content-type': 'application/json', 'x-request-id': '123' })
    expect(out['content-type']).toBe('application/json')
    expect(out['x-request-id']).toBe('123')
  })
})

// ─── buildSlug ────────────────────────────────────────────────────────────────

describe('buildSlug', () => {
  it('strips leading slash', () => {
    expect(buildSlug('/users')).toBe('users')
  })

  it('replaces slashes with dashes', () => {
    expect(buildSlug('/users/123/posts')).toBe('users-123-posts')
  })

  it('returns root for empty or "/"', () => {
    expect(buildSlug('/')).toBe('root')
    expect(buildSlug('')).toBe('root')
  })
})

// ─── buildFixturePath ─────────────────────────────────────────────────────────

describe('buildFixturePath', () => {
  it('builds path with host dir and method prefix', () => {
    const p = buildFixturePath('mocks/recorded', 'api.example.com', 'GET', '/users', '')
    // dots in host are sanitized to underscores for filesystem safety
    expect(p).toBe(path.join('mocks', 'recorded', 'api_example_com', 'GET-users.yaml'))
  })

  it('sanitizes host colons and dots', () => {
    const p = buildFixturePath('mocks/recorded', '127.0.0.1:3000', 'GET', '/ping', '')
    expect(p).toContain('127_0_0_1_3000')
  })

  it('appends query fingerprint when query present and dedupKeys includes query', () => {
    const p = buildFixturePath('mocks/recorded', 'host', 'GET', '/search', 'q=hello', ['method', 'path', 'query'])
    expect(p).toMatch(/-q[a-zA-Z0-9_-]+\.yaml$/)
  })

  it('omits query part when dedupKeys does not include query', () => {
    const p = buildFixturePath('mocks/recorded', 'host', 'GET', '/search', 'q=hello', ['method', 'path'])
    expect(p).toBe(path.join('mocks', 'recorded', 'host', 'GET-search.yaml'))
  })

  it('different queries produce different paths', () => {
    const p1 = buildFixturePath('dir', 'host', 'GET', '/s', 'q=a')
    const p2 = buildFixturePath('dir', 'host', 'GET', '/s', 'q=b')
    expect(p1).not.toBe(p2)
  })

  it('same query produces same path (deterministic)', () => {
    const p1 = buildFixturePath('dir', 'host', 'GET', '/s', 'q=hello')
    const p2 = buildFixturePath('dir', 'host', 'GET', '/s', 'q=hello')
    expect(p1).toBe(p2)
  })
})

// ─── writeFixture / readFixture ──────────────────────────────────────────────

describe('writeFixture / readFixture', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qms-recorder-'))
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('writes a YAML file readable as RawRoute', async () => {
    const filePath = path.join(tmpDir, 'GET-users.yaml')
    await writeFixture(filePath, 'GET', '/users', 200, { 'content-type': 'application/json' }, [{ id: 1 }])
    const raw = await fs.readFile(filePath, 'utf-8')
    const data = parse(raw) as { method: string; path: string }
    expect(data.method).toBe('GET')
    expect(data.path).toBe('/users')
  })

  it('creates parent directories if needed', async () => {
    const filePath = path.join(tmpDir, 'nested', 'deep', 'GET-test.yaml')
    await writeFixture(filePath, 'GET', '/test', 200, {}, null)
    const stat = await fs.stat(filePath)
    expect(stat.isFile()).toBe(true)
  })

  it('readFixture returns null for non-existent file', async () => {
    const result = await readFixture(path.join(tmpDir, 'missing.yaml'))
    expect(result).toBeNull()
  })

  it('readFixture parses status, headers, body', async () => {
    const filePath = path.join(tmpDir, 'GET-test.yaml')
    await writeFixture(filePath, 'GET', '/test', 201, { 'x-custom': 'value' }, { ok: true })
    const fixture = await readFixture(filePath)
    expect(fixture).not.toBeNull()
    expect(fixture!.status).toBe(201)
    expect(fixture!.headers['x-custom']).toBe('value')
    expect(fixture!.body).toEqual({ ok: true })
  })

  it('round-trips null body', async () => {
    const filePath = path.join(tmpDir, 'GET-empty.yaml')
    await writeFixture(filePath, 'GET', '/empty', 204, {}, null)
    const fixture = await readFixture(filePath)
    expect(fixture).not.toBeNull()
    expect(fixture!.status).toBe(204)
  })
})

// ─── record mode integration ──────────────────────────────────────────────────

describe('proxy record mode', () => {
  let upstream: http.Server
  let upstreamUrl: string
  let server: MockServer
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qms-record-'))

    // Start upstream
    upstream = http.createServer((req, res) => {
      const reply = JSON.stringify({ recorded: true, path: req.url })
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(reply)) })
      res.end(reply)
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const addr = upstream.address() as import('node:net').AddressInfo
    upstreamUrl = `http://127.0.0.1:${addr.port}`

    server = createMockServer({
      port: 0,
      proxy: {
        target: upstreamUrl,
        mode: 'record',
        record: { dir: tmpDir },
      },
    })
    await server.start()
  })

  afterEach(async () => {
    await server.stop()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('proxies and returns upstream response', async () => {
    const res = await fetch(`${server.url}/items`)
    const body = await res.json() as { recorded: boolean }
    expect(res.status).toBe(200)
    expect(body.recorded).toBe(true)
  })

  it('writes a fixture file after proxying', async () => {
    await fetch(`${server.url}/items`)
    const targetHost = new URL(upstreamUrl).host.replace(/[:.]/g, '_')
    const files = await fs.readdir(path.join(tmpDir, targetHost))
    expect(files.some((f) => f.startsWith('GET-items'))).toBe(true)
  })

  it('does not overwrite existing fixture (deduplication)', async () => {
    await fetch(`${server.url}/items`)
    const targetHost = new URL(upstreamUrl).host.replace(/[:.]/g, '_')
    const files = await fs.readdir(path.join(tmpDir, targetHost))
    const fixturePath = path.join(tmpDir, targetHost, files[0]!)

    // Overwrite with custom content
    await fs.writeFile(fixturePath, 'custom: true\n', 'utf-8')

    // Second request should NOT overwrite
    await fetch(`${server.url}/items`)
    const content = await fs.readFile(fixturePath, 'utf-8')
    expect(content).toContain('custom: true')
  })

  it('strips authorization header from recorded fixture', async () => {
    await fetch(`${server.url}/secure`, { headers: { authorization: 'Bearer secret' } })
    const targetHost = new URL(upstreamUrl).host.replace(/[:.]/g, '_')
    const files = await fs.readdir(path.join(tmpDir, targetHost))
    const fixturePath = path.join(tmpDir, targetHost, files[0]!)
    const content = await fs.readFile(fixturePath, 'utf-8')
    expect(content).not.toContain('Bearer secret')
    expect(content).not.toContain('authorization')
  })
})

// ─── replay-or-record mode integration ───────────────────────────────────────

describe('proxy replay-or-record mode', () => {
  let upstream: http.Server
  let upstreamUrl: string
  let server: MockServer
  let tmpDir: string
  let upstreamCallCount: number

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qms-replay-'))
    upstreamCallCount = 0

    upstream = http.createServer((req, res) => {
      upstreamCallCount++
      const reply = JSON.stringify({ call: upstreamCallCount, path: req.url })
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(reply)) })
      res.end(reply)
    })
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    const addr = upstream.address() as import('node:net').AddressInfo
    upstreamUrl = `http://127.0.0.1:${addr.port}`

    server = createMockServer({
      port: 0,
      proxy: {
        target: upstreamUrl,
        mode: 'replay-or-record',
        record: { dir: tmpDir },
      },
    })
    await server.start()
  })

  afterEach(async () => {
    await server.stop()
    await new Promise<void>((resolve) => upstream.close(() => resolve()))
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('first request hits upstream and records fixture', async () => {
    const res = await fetch(`${server.url}/data`)
    expect(res.status).toBe(200)
    expect(upstreamCallCount).toBe(1)
    const targetHost = new URL(upstreamUrl).host.replace(/[:.]/g, '_')
    const files = await fs.readdir(path.join(tmpDir, targetHost))
    expect(files.length).toBeGreaterThan(0)
  })

  it('second request is served from fixture without hitting upstream', async () => {
    await fetch(`${server.url}/data`)
    expect(upstreamCallCount).toBe(1)

    await fetch(`${server.url}/data`)
    expect(upstreamCallCount).toBe(1) // still 1 — served from fixture
  })

  it('fixture response matches recorded upstream response', async () => {
    const first = await (await fetch(`${server.url}/widget`)).json() as { call: number }
    const second = await (await fetch(`${server.url}/widget`)).json() as { call: number }
    expect(second.call).toBe(first.call) // same response from fixture
  })
})
