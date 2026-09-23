import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { reply, resolveFileReply, ReplyBuilder } from '../responders/reply.js'
import { executeHandler, mockRouteHeader } from '../responders/handler.js'
import { diagnosticNotFound, levenshtein } from '../responders/diagnostic.js'
import type { MockContext } from '../types.js'
import { Faker, en } from '@faker-js/faker'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFaker(): import('@faker-js/faker').Faker {
  return new Faker({ locale: [en] })
}

function makeCtx(overrides: Partial<MockContext> = {}): MockContext {
  return {
    req: {
      method: 'GET',
      path: '/test',
      params: {},
      query: {},
      headers: {},
      body: {},
    },
    params: {},
    query: {},
    body: {},
    state: {},
    scenario: '',
    faker: makeFaker(),
    ...overrides,
  }
}

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'qms-responder-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

// ─── reply() builder ─────────────────────────────────────────────────────────

describe('reply() builder', () => {
  it('defaults to status 200', () => {
    const r = reply()
    expect(r.status).toBe(200)
  })

  it('accepts explicit status code', () => {
    expect(reply(201).status).toBe(201)
    expect(reply(404).status).toBe(404)
    expect(reply(500).status).toBe(500)
  })

  it('starts with empty body and bodyType=empty', () => {
    const r = reply(200)
    expect(r.body).toBeUndefined()
    expect(r.bodyType).toBe('empty')
  })

  it('starts with empty headers', () => {
    const r = reply(200)
    expect(r.headers).toEqual({})
  })
})

// ─── reply().json() ───────────────────────────────────────────────────────────

describe('reply().json()', () => {
  it('sets body and bodyType', () => {
    const r = reply(200).json({ ok: true })
    expect(r.body).toEqual({ ok: true })
    expect(r.bodyType).toBe('json')
  })

  it('sets content-type: application/json automatically', () => {
    const r = reply(200).json({ ok: true })
    expect(r.headers['content-type']).toBe('application/json')
  })

  it('does not override an existing content-type header', () => {
    const r = reply(200).header('content-type', 'application/vnd.api+json').json({ ok: true })
    expect(r.headers['content-type']).toBe('application/vnd.api+json')
  })

  it('accepts array body', () => {
    const r = reply(200).json([1, 2, 3])
    expect(r.body).toEqual([1, 2, 3])
  })

  it('accepts null body', () => {
    const r = reply(204).json(null)
    expect(r.body).toBeNull()
  })

  it('is chainable — returns same ReplyBuilder instance', () => {
    const r = reply(200)
    expect(r.json({ x: 1 })).toBe(r)
  })
})

// ─── reply().text() ───────────────────────────────────────────────────────────

describe('reply().text()', () => {
  it('sets body and bodyType', () => {
    const r = reply(200).text('hello world')
    expect(r.body).toBe('hello world')
    expect(r.bodyType).toBe('text')
  })

  it('sets content-type: text/plain; charset=utf-8 automatically', () => {
    const r = reply(200).text('hi')
    expect(r.headers['content-type']).toBe('text/plain; charset=utf-8')
  })

  it('does not override existing content-type', () => {
    const r = reply(200).header('content-type', 'text/html').text('<p>hi</p>')
    expect(r.headers['content-type']).toBe('text/html')
  })

  it('is chainable', () => {
    const r = reply(200)
    expect(r.text('x')).toBe(r)
  })
})

// ─── reply().file() ───────────────────────────────────────────────────────────

describe('reply().file()', () => {
  it('stores path as body and sets bodyType=file', () => {
    const r = reply(200).file('./response.json')
    expect(r.body).toBe('./response.json')
    expect(r.bodyType).toBe('file')
  })

  it('is chainable', () => {
    const r = reply(200)
    expect(r.file('./x.json')).toBe(r)
  })
})

// ─── reply().header() ────────────────────────────────────────────────────────

describe('reply().header()', () => {
  it('adds a header (lowercased)', () => {
    const r = reply(200).header('X-Request-ID', '123')
    expect(r.headers['x-request-id']).toBe('123')
  })

  it('overwrites duplicate headers', () => {
    const r = reply(200).header('x-foo', 'a').header('x-foo', 'b')
    expect(r.headers['x-foo']).toBe('b')
  })

  it('is chainable across multiple calls', () => {
    const r = reply(200).header('a', '1').header('b', '2').json({ ok: true })
    expect(r.headers['a']).toBe('1')
    expect(r.headers['b']).toBe('2')
    expect(r.body).toEqual({ ok: true })
  })
})

// ─── resolveFileReply ─────────────────────────────────────────────────────────

describe('resolveFileReply', () => {
  it('returns non-file replies unchanged', async () => {
    const r = reply(200).json({ ok: true })
    const resolved = await resolveFileReply(r)
    expect(resolved).toBe(r)
  })

  it('reads a JSON file and parses it', async () => {
    const filePath = join(tmpDir, 'data.json')
    await writeFile(filePath, JSON.stringify({ items: [1, 2, 3] }))

    const r = reply(200).file(filePath)
    const resolved = await resolveFileReply(r)

    expect(resolved.bodyType).toBe('json')
    expect(resolved.body).toEqual({ items: [1, 2, 3] })
    expect(resolved.headers['content-type']).toBe('application/json')
  })

  it('reads a text file and sets text/plain content-type', async () => {
    const filePath = join(tmpDir, 'response.txt')
    await writeFile(filePath, 'hello from file')

    const r = reply(200).file(filePath)
    const resolved = await resolveFileReply(r)

    expect(resolved.bodyType).toBe('text')
    expect(resolved.body).toBe('hello from file')
    expect(resolved.headers['content-type']).toBe('text/plain; charset=utf-8')
  })

  it('reads a YAML file with yaml content-type', async () => {
    const filePath = join(tmpDir, 'data.yaml')
    await writeFile(filePath, 'key: value\n')

    const r = reply(200).file(filePath)
    const resolved = await resolveFileReply(r)

    expect(resolved.bodyType).toBe('text')
    expect(resolved.headers['content-type']).toBe('application/yaml')
  })

  it('preserves explicit headers from the original reply', async () => {
    const filePath = join(tmpDir, 'info.json')
    await writeFile(filePath, '{"ok":true}')

    const r = reply(200).header('x-custom', 'value').file(filePath)
    const resolved = await resolveFileReply(r)

    expect(resolved.headers['x-custom']).toBe('value')
  })

  it('does not override explicit content-type with inferred one', async () => {
    const filePath = join(tmpDir, 'data.json')
    await writeFile(filePath, '{"ok":true}')

    const r = reply(200).header('content-type', 'application/vnd.api+json').file(filePath)
    const resolved = await resolveFileReply(r)

    expect(resolved.headers['content-type']).toBe('application/vnd.api+json')
  })
})

// ─── executeHandler ───────────────────────────────────────────────────────────

describe('executeHandler', () => {
  const ctx = makeCtx()

  it('executes a synchronous handler and returns its reply', async () => {
    const handler = () => reply(201).json({ created: true })
    const result = await executeHandler(handler, ctx, 'test-route', false)
    expect(result.status).toBe(201)
    expect(result.body).toEqual({ created: true })
  })

  it('executes an async handler and returns its reply', async () => {
    const handler = async () => {
      await Promise.resolve()
      return reply(200).text('async result')
    }
    const result = await executeHandler(handler, ctx, 'test-route', false)
    expect(result.status).toBe(200)
    expect(result.body).toBe('async result')
  })

  it('catches synchronous exceptions and returns 500', async () => {
    const handler = () => {
      throw new Error('boom')
      return reply(200) // unreachable — needed for TS type
    }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await executeHandler(handler, ctx, 'my-route', false)
    expect(result.status).toBe(500)
    expect((result.body as Record<string, unknown>)['error']).toBe('Internal Server Error')
    expect((result.body as Record<string, unknown>)['routeId']).toBe('my-route')
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('my-route'))
  })

  it('catches async rejections and returns 500', async () => {
    const handler = async () => {
      await Promise.reject(new Error('async boom'))
      return reply(200)
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await executeHandler(handler, ctx, 'async-route', false)
    expect(result.status).toBe(500)
  })

  it('includes stack trace in 500 body when dev=true', async () => {
    const handler = () => {
      throw new Error('dev error')
      return reply(200)
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await executeHandler(handler, ctx, 'route', true)
    const body = result.body as Record<string, unknown>
    expect(body['stack']).toBeDefined()
    expect(typeof body['stack']).toBe('string')
  })

  it('omits stack trace when dev=false', async () => {
    const handler = () => {
      throw new Error('prod error')
      return reply(200)
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await executeHandler(handler, ctx, 'route', false)
    const body = result.body as Record<string, unknown>
    expect(body['stack']).toBeUndefined()
  })

  it('handles non-Error thrown values', async () => {
    const handler = () => {
      throw 'string error'  // eslint-disable-line no-throw-literal
      return reply(200)
    }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await executeHandler(handler, ctx, 'route', false)
    expect(result.status).toBe(500)
  })

  it('materialises file body from a handler', async () => {
    const filePath = join(tmpDir, 'payload.json')
    await writeFile(filePath, '{"items":[1,2]}')

    const handler = () => reply(200).file(filePath)
    const result = await executeHandler(handler, ctx, 'file-route', false)
    expect(result.bodyType).toBe('json')
    expect(result.body).toEqual({ items: [1, 2] })
  })

  it('handler receives MockContext with proper shape', async () => {
    let capturedCtx: MockContext | undefined
    const handler = (c: MockContext) => {
      capturedCtx = c
      return reply(200)
    }
    const customCtx = makeCtx({ params: { id: '99' }, scenario: 'test' })
    await executeHandler(handler, customCtx, 'ctx-route', false)
    expect(capturedCtx?.params).toEqual({ id: '99' })
    expect(capturedCtx?.scenario).toBe('test')
  })

  it('handler can use ctx.faker to generate data', async () => {
    const handler = (ctx: MockContext) =>
      reply(200).json({ name: ctx.faker.person.firstName() })
    const result = await executeHandler(handler, ctx, 'faker-route', false)
    const body = result.body as Record<string, unknown>
    expect(typeof body['name']).toBe('string')
    expect((body['name'] as string).length).toBeGreaterThan(0)
  })
})

// ─── mockRouteHeader ──────────────────────────────────────────────────────────

describe('mockRouteHeader', () => {
  it('formats as file#routeId', () => {
    expect(mockRouteHeader('/mocks/users.yaml', 'GET:/users')).toBe('/mocks/users.yaml#GET:/users')
  })

  it('uses empty strings gracefully', () => {
    expect(mockRouteHeader('', '')).toBe('#')
  })
})

// ─── levenshtein ─────────────────────────────────────────────────────────────

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshtein('/users', '/users')).toBe(0)
  })

  it('returns length of b for empty a', () => {
    expect(levenshtein('', '/users')).toBe(6)
  })

  it('returns length of a for empty b', () => {
    expect(levenshtein('/users', '')).toBe(6)
  })

  it('single substitution', () => {
    expect(levenshtein('abc', 'axc')).toBe(1)
  })

  it('single insertion', () => {
    expect(levenshtein('ac', 'abc')).toBe(1)
  })

  it('single deletion', () => {
    expect(levenshtein('abc', 'ac')).toBe(1)
  })

  it('/users vs /user — distance 1', () => {
    expect(levenshtein('/users', '/user')).toBe(1)
  })

  it('/users vs /orders — some distance', () => {
    expect(levenshtein('/users', '/orders')).toBeGreaterThan(0)
  })
})

// ─── diagnosticNotFound ───────────────────────────────────────────────────────

describe('diagnosticNotFound', () => {
  const routes = ['/users', '/users/:id', '/orders', '/orders/:id', '/products']

  it('returns simple { error: "Not Found" } when disabled', () => {
    const result = diagnosticNotFound('GET', '/missing', routes, false)
    expect(result.status).toBe(404)
    expect(result.body).toEqual({ error: 'Not Found' })
  })

  it('returns detailed body when enabled', () => {
    const result = diagnosticNotFound('GET', '/user', routes, true)
    expect(result.status).toBe(404)
    const body = result.body as { error: string; method: string; path: string; closestRoutes: string[] }
    expect(body.error).toBe('Not Found')
    expect(body.method).toBe('GET')
    expect(body.path).toBe('/user')
    expect(Array.isArray(body.closestRoutes)).toBe(true)
  })

  it('suggests /users for /user (distance 1)', () => {
    const result = diagnosticNotFound('GET', '/user', routes, true)
    const body = result.body as { closestRoutes: string[] }
    expect(body.closestRoutes).toContain('/users')
  })

  it('suggests at most 3 routes', () => {
    const result = diagnosticNotFound('GET', '/user', routes, true)
    const body = result.body as { closestRoutes: string[] }
    expect(body.closestRoutes.length).toBeLessThanOrEqual(3)
  })

  it('returns empty closestRoutes when no path is close enough', () => {
    const result = diagnosticNotFound('GET', '/xxxxxxxxxxxxxx', routes, true)
    const body = result.body as { closestRoutes: string[] }
    expect(body.closestRoutes).toHaveLength(0)
  })

  it('includes exact match in suggestions (distance 0)', () => {
    const result = diagnosticNotFound('GET', '/users', routes, true)
    const body = result.body as { closestRoutes: string[] }
    expect(body.closestRoutes[0]).toBe('/users')
  })

  it('sorts by distance (closest first)', () => {
    const result = diagnosticNotFound('GET', '/user', routes, true)
    const body = result.body as { closestRoutes: string[] }
    // /users (dist 1) should come before /orders (dist ~4)
    const usersIdx = body.closestRoutes.indexOf('/users')
    const ordersIdx = body.closestRoutes.indexOf('/orders')
    if (ordersIdx !== -1) {
      expect(usersIdx).toBeLessThan(ordersIdx)
    }
  })
})
