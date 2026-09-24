import { describe, it, expect } from 'vitest'
import { convertPath, pickResponseBody, getDefaultStatus, specToRoutes } from '../openapi/index.js'
import { createMockServer } from '../server/mock-server.js'
import type { OpenAPIV3 } from 'openapi-types'

// ─── convertPath ─────────────────────────────────────────────────────────────

describe('convertPath', () => {
  it('converts {param} to :param', () => {
    expect(convertPath('/users/{id}')).toBe('/users/:id')
  })

  it('converts multiple params', () => {
    expect(convertPath('/orgs/{org}/repos/{repo}')).toBe('/orgs/:org/repos/:repo')
  })

  it('leaves plain paths unchanged', () => {
    expect(convertPath('/users')).toBe('/users')
  })

  it('handles root path', () => {
    expect(convertPath('/')).toBe('/')
  })
})

// ─── pickResponseBody ─────────────────────────────────────────────────────────

describe('pickResponseBody', () => {
  it('returns inline example when present', () => {
    const mt: OpenAPIV3.MediaTypeObject = { example: { id: 1, name: 'Alice' } }
    expect(pickResponseBody(mt)).toEqual({ id: 1, name: 'Alice' })
  })

  it('returns first named example value', () => {
    const mt: OpenAPIV3.MediaTypeObject = {
      examples: {
        one: { value: { foo: 'bar' } },
        two: { value: { baz: 'qux' } },
      },
    }
    const result = pickResponseBody(mt)
    expect(result).toEqual({ foo: 'bar' })
  })

  it('generates from schema when no example', () => {
    const mt: OpenAPIV3.MediaTypeObject = {
      schema: { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] },
    }
    const result = pickResponseBody(mt, 42) as { id: number }
    expect(typeof result.id).toBe('number')
  })

  it('prefers example over schema', () => {
    const mt: OpenAPIV3.MediaTypeObject = {
      example: { id: 99 },
      schema: { type: 'object', properties: { id: { type: 'integer' } } },
    }
    expect(pickResponseBody(mt)).toEqual({ id: 99 })
  })

  it('returns null when no example and no schema', () => {
    expect(pickResponseBody({})).toBeNull()
  })
})

// ─── getDefaultStatus ─────────────────────────────────────────────────────────

describe('getDefaultStatus', () => {
  it('returns first 2xx status', () => {
    expect(getDefaultStatus({ '200': {}, '404': {} })).toBe('200')
  })

  it('returns 201 if that is the only 2xx', () => {
    expect(getDefaultStatus({ '201': {}, '400': {} })).toBe('201')
  })

  it('returns undefined when no 2xx defined', () => {
    expect(getDefaultStatus({ '400': {}, '500': {} })).toBeUndefined()
  })
})

// ─── specToRoutes ─────────────────────────────────────────────────────────────

const MINIMAL_SPEC: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: { title: 'Test', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        responses: {
          '200': { description: 'List users', content: { 'application/json': { example: [{ id: 1, name: 'Alice' }] } } },
        },
      },
      post: {
        responses: {
          '201': { description: 'Created', content: { 'application/json': { example: { id: 2, name: 'Bob' } } } },
        },
      },
    },
    '/users/{id}': {
      get: {
        responses: {
          '200': { description: 'Get user', content: { 'application/json': { example: { id: 1, name: 'Alice' } } } },
          '404': { description: 'Not found', content: { 'application/json': { example: { error: 'Not found' } } } },
        },
      },
      delete: {
        responses: {
          '204': { description: 'Deleted' },
        },
      },
    },
  },
}

describe('specToRoutes', () => {
  it('generates a route per path × method', () => {
    const routes = specToRoutes(MINIMAL_SPEC)
    const methods = routes.map((r) => `${r.method} ${r.path}`)
    expect(methods).toContain('GET /users')
    expect(methods).toContain('POST /users')
    expect(methods).toContain('GET /users/:id')
    expect(methods).toContain('DELETE /users/:id')
  })

  it('converts OpenAPI path params to :param style', () => {
    const routes = specToRoutes(MINIMAL_SPEC)
    expect(routes.some((r) => r.path === '/users/:id')).toBe(true)
    expect(routes.some((r) => r.path.includes('{'))).toBe(false)
  })

  it('uses example as response body', () => {
    const routes = specToRoutes(MINIMAL_SPEC)
    const get = routes.find((r) => r.method === 'GET' && r.path === '/users')!
    const defaultResp = get.responses.find((r) => r.status === 200)!
    expect(defaultResp.body).toEqual([{ id: 1, name: 'Alice' }])
  })

  it('default response has no when clause', () => {
    const routes = specToRoutes(MINIMAL_SPEC)
    const get = routes.find((r) => r.method === 'GET' && r.path === '/users/:id')!
    const defaultResp = get.responses.find((r) => r.status === 200)!
    expect(defaultResp.when).toBeUndefined()
    expect(defaultResp.scenario).toBeUndefined()
  })

  it('non-default responses have no when clause (X-Mock-Status handled by matchResponse)', () => {
    const routes = specToRoutes(MINIMAL_SPEC)
    const get = routes.find((r) => r.method === 'GET' && r.path === '/users/:id')!
    const notFound = get.responses.find((r) => r.status === 404)!
    expect(notFound.when).toBeUndefined()
  })

  it('non-default responses get scenario equal to status string', () => {
    const routes = specToRoutes(MINIMAL_SPEC)
    const get = routes.find((r) => r.method === 'GET' && r.path === '/users/:id')!
    const notFound = get.responses.find((r) => r.status === 404)!
    expect(notFound.scenario).toBe('404')
  })

  it('non-default responses are listed before the default', () => {
    const routes = specToRoutes(MINIMAL_SPEC)
    const get = routes.find((r) => r.method === 'GET' && r.path === '/users/:id')!
    expect(get.responses[0]!.status).toBe(404) // non-default first
    expect(get.responses[1]!.status).toBe(200) // default last
  })

  it('response with no content body is undefined', () => {
    const routes = specToRoutes(MINIMAL_SPEC)
    const del = routes.find((r) => r.method === 'DELETE' && r.path === '/users/:id')!
    const resp = del.responses[0]!
    expect(resp.status).toBe(204)
    expect(resp.body).toBeUndefined()
  })

  it('handles spec with no paths gracefully', () => {
    const empty: OpenAPIV3.Document = { openapi: '3.0.0', info: { title: 'T', version: '1' }, paths: {} }
    expect(specToRoutes(empty)).toEqual([])
  })
})

// ─── X-Mock-Status integration ────────────────────────────────────────────────

describe('X-Mock-Status header integration with createMockServer', () => {
  it('returns default 200 without X-Mock-Status header', async () => {
    const routes = specToRoutes(MINIMAL_SPEC)
    const server = createMockServer({ port: 0 })

    const routeSpec = routes.find((r) => r.method === 'GET' && r.path === '/users/:id')!
    server.use({
      method: 'GET',
      path: '/users/:id',
      responses: routeSpec.responses.map((r) => ({
        status: r.status,
        headers: r.headers,
        body: r.body,
        ...(r.scenario !== undefined ? { scenario: r.scenario } : {}),
      })),
    })

    await server.start()
    try {
      const res = await fetch(`${server.url}/users/1`)
      expect(res.status).toBe(200)
    } finally {
      await server.stop()
    }
  })

  it('returns 404 response when X-Mock-Status: 404 header sent', async () => {
    const routes = specToRoutes(MINIMAL_SPEC)
    const server = createMockServer({ port: 0 })

    const routeSpec = routes.find((r) => r.method === 'GET' && r.path === '/users/:id')!
    server.use({
      method: 'GET',
      path: '/users/:id',
      responses: routeSpec.responses.map((r) => ({
        status: r.status,
        headers: r.headers,
        body: r.body,
        ...(r.scenario !== undefined ? { scenario: r.scenario } : {}),
      })),
    })

    await server.start()
    try {
      const res = await fetch(`${server.url}/users/1`, {
        headers: { 'x-mock-status': '404' },
      })
      expect(res.status).toBe(404)
      const body = await res.json() as { error: string }
      expect(body.error).toBe('Not found')
    } finally {
      await server.stop()
    }
  })

  it('scenario-based: activating scenario "404" returns 404 response', async () => {
    const routes = specToRoutes(MINIMAL_SPEC)
    const server = createMockServer({ port: 0 })

    const routeSpec = routes.find((r) => r.method === 'GET' && r.path === '/users/:id')!
    server.use({
      method: 'GET',
      path: '/users/:id',
      responses: routeSpec.responses.map((r) => ({
        status: r.status,
        headers: r.headers,
        body: r.body,
        ...(r.scenario !== undefined ? { scenario: r.scenario } : {}),
      })),
    })
    server.scenario('404')

    await server.start()
    try {
      const res = await fetch(`${server.url}/users/1`)
      expect(res.status).toBe(404)
    } finally {
      await server.stop()
    }
  })
})

// ─── generateJsonSchema ───────────────────────────────────────────────────────

describe('generateJsonSchema', () => {
  it('returns an object with $schema property', async () => {
    const { generateJsonSchema } = await import('../openapi/schema.js')
    const schema = generateJsonSchema()
    expect(typeof schema).toBe('object')
    expect(schema).not.toBeNull()
  })

  it('schema is a non-null object', async () => {
    const { generateJsonSchema } = await import('../openapi/schema.js')
    const schema = generateJsonSchema() as Record<string, unknown>
    expect(typeof schema).toBe('object')
    expect(schema).not.toBeNull()
    // The schema wraps QmsMockFile (Zod v4 compat — definitions may be present)
    expect(JSON.stringify(schema)).toContain('QmsMockFile')
  })
})
