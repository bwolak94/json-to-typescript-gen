import { describe, it, expect } from 'vitest'
import {
  HttpMethodSchema,
  DelaySpecSchema,
  WhenClauseSchema,
  RawResponseSchema,
  ResourceSeedSchema,
  ResourcePaginationSchema,
  ResourceSchema,
  CorsSchema,
  ProxySchema,
  QmsConfigSchema,
} from '../config/schema.js'

// ─── HttpMethodSchema ─────────────────────────────────────────────────────────

describe('HttpMethodSchema', () => {
  it('accepts all standard methods', () => {
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'ALL', '*']) {
      expect(HttpMethodSchema.safeParse(m).success).toBe(true)
    }
  })

  it('rejects lowercase method', () => {
    expect(HttpMethodSchema.safeParse('get').success).toBe(false)
  })

  it('rejects unknown method', () => {
    expect(HttpMethodSchema.safeParse('CONNECT').success).toBe(false)
  })
})

// ─── DelaySpecSchema ──────────────────────────────────────────────────────────

describe('DelaySpecSchema', () => {
  it('accepts a plain non-negative integer', () => {
    expect(DelaySpecSchema.safeParse(0).success).toBe(true)
    expect(DelaySpecSchema.safeParse(500).success).toBe(true)
  })

  it('rejects negative numbers', () => {
    expect(DelaySpecSchema.safeParse(-1).success).toBe(false)
  })

  it('rejects float', () => {
    expect(DelaySpecSchema.safeParse(1.5).success).toBe(false)
  })

  it('accepts {min, max} object', () => {
    const r = DelaySpecSchema.safeParse({ min: 100, max: 500 })
    expect(r.success).toBe(true)
  })

  it('rejects {min, max} with negative values', () => {
    expect(DelaySpecSchema.safeParse({ min: -10, max: 500 }).success).toBe(false)
  })

  it('accepts {p50, p99} object', () => {
    const r = DelaySpecSchema.safeParse({ p50: 50, p99: 200 })
    expect(r.success).toBe(true)
  })

  it('rejects {p50, p99} with float', () => {
    expect(DelaySpecSchema.safeParse({ p50: 50.5, p99: 200 }).success).toBe(false)
  })

  it('rejects a string', () => {
    expect(DelaySpecSchema.safeParse('slow').success).toBe(false)
  })
})

// ─── WhenClauseSchema ─────────────────────────────────────────────────────────

describe('WhenClauseSchema', () => {
  it('accepts an empty object', () => {
    expect(WhenClauseSchema.safeParse({}).success).toBe(true)
  })

  it('accepts arbitrary string keys with any values', () => {
    const r = WhenClauseSchema.safeParse({
      'query.search': 'foo',
      'headers.x-custom': { regex: '^Bearer' },
    })
    expect(r.success).toBe(true)
  })
})

// ─── RawResponseSchema ────────────────────────────────────────────────────────

describe('RawResponseSchema', () => {
  it('defaults status to 200 and headers to {}', () => {
    const r = RawResponseSchema.parse({})
    expect(r.status).toBe(200)
    expect(r.headers).toEqual({})
  })

  it('accepts custom status and headers', () => {
    const r = RawResponseSchema.parse({ status: 404, headers: { 'x-foo': 'bar' } })
    expect(r.status).toBe(404)
    expect(r.headers['x-foo']).toBe('bar')
  })

  it('rejects status below 100', () => {
    expect(RawResponseSchema.safeParse({ status: 99 }).success).toBe(false)
  })

  it('rejects status above 599', () => {
    expect(RawResponseSchema.safeParse({ status: 600 }).success).toBe(false)
  })

  it('accepts when clause', () => {
    const r = RawResponseSchema.parse({ when: { 'query.lang': 'en' } })
    expect(r.when).toEqual({ 'query.lang': 'en' })
  })

  it('accepts scenario key', () => {
    const r = RawResponseSchema.parse({ scenario: 'error-state' })
    expect(r.scenario).toBe('error-state')
  })

  it('accepts delay (number)', () => {
    const r = RawResponseSchema.parse({ delay: 200 })
    expect(r.delay).toBe(200)
  })

  it('accepts delay ({min,max})', () => {
    const r = RawResponseSchema.parse({ delay: { min: 50, max: 150 } })
    expect(r.delay).toEqual({ min: 50, max: 150 })
  })

  it('accepts bodyFile', () => {
    const r = RawResponseSchema.parse({ bodyFile: './responses/users.json' })
    expect(r.bodyFile).toBe('./responses/users.json')
  })

  it('accepts arbitrary body', () => {
    const body = { users: [{ id: 1 }] }
    const r = RawResponseSchema.parse({ body })
    expect(r.body).toEqual(body)
  })

  it('accepts non-integer string map in headers', () => {
    expect(
      RawResponseSchema.safeParse({ headers: { 'content-type': 'application/json' } }).success,
    ).toBe(true)
  })

  it('rejects headers with non-string values', () => {
    expect(RawResponseSchema.safeParse({ headers: { 'x-count': 42 } }).success).toBe(false)
  })
})

// ─── ResourceSeedSchema ───────────────────────────────────────────────────────

describe('ResourceSeedSchema', () => {
  it('accepts count + fixture', () => {
    const r = ResourceSeedSchema.parse({ count: 10, fixture: './data.json' })
    expect(r.count).toBe(10)
    if ('fixture' in r) expect(r.fixture).toBe('./data.json')
  })

  it('accepts count without fixture', () => {
    const r = ResourceSeedSchema.parse({ count: 5 })
    expect(r.count).toBe(5)
  })

  it('accepts count + schema', () => {
    const r = ResourceSeedSchema.parse({ count: 3, schema: { name: 'faker.name.firstName' } })
    expect(r.count).toBe(3)
    if ('schema' in r) expect(r.schema).toEqual({ name: 'faker.name.firstName' })
  })

  it('rejects count = 0', () => {
    expect(ResourceSeedSchema.safeParse({ count: 0 }).success).toBe(false)
  })

  it('rejects missing count', () => {
    expect(ResourceSeedSchema.safeParse({ fixture: './data.json' }).success).toBe(false)
  })
})

// ─── ResourcePaginationSchema ─────────────────────────────────────────────────

describe('ResourcePaginationSchema', () => {
  it('applies defaults', () => {
    const r = ResourcePaginationSchema.parse({})
    expect(r.style).toBe('page')
    expect(r.pageParam).toBe('page')
    expect(r.sizeParam).toBe('limit')
    expect(r.default).toBe(10)
  })

  it('accepts all pagination styles', () => {
    for (const style of ['page', 'offset', 'cursor']) {
      expect(ResourcePaginationSchema.safeParse({ style }).success).toBe(true)
    }
  })

  it('rejects unknown pagination style', () => {
    expect(ResourcePaginationSchema.safeParse({ style: 'keyset' }).success).toBe(false)
  })

  it('accepts custom params and page size', () => {
    const r = ResourcePaginationSchema.parse({ pageParam: 'p', sizeParam: 'size', default: 20 })
    expect(r.pageParam).toBe('p')
    expect(r.sizeParam).toBe('size')
    expect(r.default).toBe(20)
  })

  it('rejects non-positive default page size', () => {
    expect(ResourcePaginationSchema.safeParse({ default: 0 }).success).toBe(false)
  })
})

// ─── ResourceSchema ───────────────────────────────────────────────────────────

describe('ResourceSchema', () => {
  it('parses minimal resource', () => {
    const r = ResourceSchema.parse({ name: 'users', path: '/users' })
    expect(r.name).toBe('users')
    expect(r.path).toBe('/users')
    expect(r.idField).toBe('id')
    expect(r.filters).toEqual([])
    expect(r.sort).toBe(false)
  })

  it('accepts custom idField and filters', () => {
    const r = ResourceSchema.parse({
      name: 'orders',
      path: '/orders',
      idField: 'orderId',
      filters: ['status', 'userId'],
      sort: true,
    })
    expect(r.idField).toBe('orderId')
    expect(r.filters).toEqual(['status', 'userId'])
    expect(r.sort).toBe(true)
  })

  it('requires path to start with /', () => {
    expect(ResourceSchema.safeParse({ name: 'x', path: 'noslash' }).success).toBe(false)
  })

  it('rejects empty name', () => {
    expect(ResourceSchema.safeParse({ name: '', path: '/x' }).success).toBe(false)
  })

  it('accepts seed with count + fixture', () => {
    const r = ResourceSchema.parse({
      name: 'products',
      path: '/products',
      seed: { count: 50, fixture: './products.json' },
    })
    expect(r.seed).toBeDefined()
    if (r.seed && 'fixture' in r.seed) expect(r.seed.fixture).toBe('./products.json')
  })

  it('accepts pagination config', () => {
    const r = ResourceSchema.parse({
      name: 'items',
      path: '/items',
      pagination: { style: 'offset' },
    })
    expect(r.pagination?.style).toBe('offset')
    expect(r.pagination?.default).toBe(10) // default applied
  })
})

// ─── CorsSchema ───────────────────────────────────────────────────────────────

describe('CorsSchema', () => {
  it('accepts boolean true/false', () => {
    expect(CorsSchema.safeParse(true).success).toBe(true)
    expect(CorsSchema.safeParse(false).success).toBe(true)
  })

  it('accepts empty object (full defaults)', () => {
    expect(CorsSchema.safeParse({}).success).toBe(true)
  })

  it('accepts origins as string', () => {
    const r = CorsSchema.parse({ origins: 'https://example.com' })
    if (typeof r !== 'boolean') expect(r.origins).toBe('https://example.com')
  })

  it('accepts origins as array', () => {
    const r = CorsSchema.parse({ origins: ['https://a.com', 'https://b.com'] })
    if (typeof r !== 'boolean') expect(Array.isArray(r.origins)).toBe(true)
  })

  it('accepts credentials flag', () => {
    const r = CorsSchema.parse({ credentials: true })
    if (typeof r !== 'boolean') expect(r.credentials).toBe(true)
  })

  it('accepts headers array', () => {
    const r = CorsSchema.parse({ headers: ['Authorization', 'Content-Type'] })
    if (typeof r !== 'boolean') expect(r.headers).toHaveLength(2)
  })
})

// ─── ProxySchema ──────────────────────────────────────────────────────────────

describe('ProxySchema', () => {
  it('requires a valid target URL', () => {
    const r = ProxySchema.parse({ target: 'https://api.example.com' })
    expect(r.target).toBe('https://api.example.com')
    expect(r.mode).toBe('passthrough')
    expect(r.record).toBe(false)
  })

  it('rejects invalid target URL', () => {
    expect(ProxySchema.safeParse({ target: 'not-a-url' }).success).toBe(false)
  })

  it('accepts all proxy modes', () => {
    for (const mode of ['off', 'passthrough', 'record', 'replay-or-record']) {
      expect(
        ProxySchema.safeParse({ target: 'http://localhost:3000', mode }).success,
      ).toBe(true)
    }
  })

  it('rejects unknown mode', () => {
    expect(
      ProxySchema.safeParse({ target: 'http://localhost:3000', mode: 'mirror' }).success,
    ).toBe(false)
  })

  it('accepts record flag', () => {
    const r = ProxySchema.parse({ target: 'http://localhost:3000', record: true })
    expect(r.record).toBe(true)
  })

  it('accepts pathRewrite map', () => {
    const r = ProxySchema.parse({
      target: 'http://localhost:3000',
      pathRewrite: { '^/api': '' },
    })
    expect(r.pathRewrite).toEqual({ '^/api': '' })
  })
})

// ─── QmsConfigSchema — admin sub-object ──────────────────────────────────────

describe('QmsConfigSchema — admin', () => {
  it('applies admin defaults when not specified', () => {
    const cfg = QmsConfigSchema.parse({})
    expect(cfg.admin.enabled).toBe(true)
    expect(cfg.admin.path).toBe('/__admin')
    expect(cfg.admin.token).toBeUndefined()
  })

  it('accepts admin token', () => {
    const cfg = QmsConfigSchema.parse({ admin: { token: 'secret-abc' } })
    expect(cfg.admin.token).toBe('secret-abc')
    expect(cfg.admin.enabled).toBe(true) // default still applies
  })

  it('accepts admin disabled', () => {
    const cfg = QmsConfigSchema.parse({ admin: { enabled: false } })
    expect(cfg.admin.enabled).toBe(false)
  })

  it('accepts custom admin path', () => {
    const cfg = QmsConfigSchema.parse({ admin: { path: '/internal/admin' } })
    expect(cfg.admin.path).toBe('/internal/admin')
  })
})

// ─── QmsConfigSchema — scenarios ─────────────────────────────────────────────

describe('QmsConfigSchema — scenarios', () => {
  it('defaults to empty scenarios object', () => {
    const cfg = QmsConfigSchema.parse({})
    expect(cfg.scenarios).toEqual({})
  })

  it('accepts default scenario name', () => {
    const cfg = QmsConfigSchema.parse({ scenarios: { default: 'happy-path' } })
    expect(cfg.scenarios.default).toBe('happy-path')
  })
})

// ─── QmsConfigSchema — delay and openapi ─────────────────────────────────────

describe('QmsConfigSchema — delay and openapi', () => {
  it('accepts global delay as number', () => {
    const cfg = QmsConfigSchema.parse({ delay: 100 })
    expect(cfg.delay).toBe(100)
  })

  it('accepts global delay as {min,max}', () => {
    const cfg = QmsConfigSchema.parse({ delay: { min: 10, max: 200 } })
    expect(cfg.delay).toEqual({ min: 10, max: 200 })
  })

  it('defaults openapi to empty array', () => {
    const cfg = QmsConfigSchema.parse({})
    expect(cfg.openapi).toEqual([])
  })

  it('accepts openapi spec paths', () => {
    const cfg = QmsConfigSchema.parse({ openapi: ['./specs/api.yaml'] })
    expect(cfg.openapi).toEqual(['./specs/api.yaml'])
  })
})
