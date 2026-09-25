/**
 * Contract tests for the Petstore mock.
 *
 * These tests import the OpenAPI spec at runtime (programmatic API),
 * spin up a real HTTP server, and verify each endpoint behaves according
 * to the spec — including X-Mock-Status scenario switching.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createMockServer, specToRoutes } from '@quick-mock-server/core'
import type { OpenAPIV3 } from 'openapi-types'

// ─── Inline spec (mirrors ./specs/petstore.yaml) ──────────────────────────────

const PETSTORE_SPEC: OpenAPIV3.Document = {
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        responses: {
          '200': {
            description: 'A list of pets',
            content: {
              'application/json': {
                example: [
                  { id: 1, name: 'Fluffy', tag: 'cat' },
                  { id: 2, name: 'Rex',    tag: 'dog' },
                ],
              },
            },
          },
          '500': {
            description: 'Unexpected error',
            content: { 'application/json': { example: { error: 'Internal server error' } } },
          },
        },
      },
      post: {
        responses: {
          '201': {
            description: 'Created',
            content: { 'application/json': { example: { id: 3, name: 'Whiskers', tag: 'cat' } } },
          },
          '422': {
            description: 'Validation error',
            content: { 'application/json': { example: { error: 'name is required' } } },
          },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        responses: {
          '200': {
            description: 'A single pet',
            content: { 'application/json': { example: { id: 1, name: 'Fluffy', tag: 'cat' } } },
          },
          '404': {
            description: 'Not found',
            content: { 'application/json': { example: { error: 'pet not found' } } },
          },
        },
      },
      delete: {
        responses: {
          '204': { description: 'Deleted' },
          '404': {
            description: 'Not found',
            content: { 'application/json': { example: { error: 'pet not found' } } },
          },
        },
      },
    },
  },
}

// ─── Test setup ───────────────────────────────────────────────────────────────

const server = createMockServer({ port: 0 })

beforeAll(async () => {
  const routes = specToRoutes(PETSTORE_SPEC)
  for (const route of routes) {
    server.use(route)
  }
  await server.start()
})

afterAll(async () => {
  await server.stop()
})

// ─── GET /pets ────────────────────────────────────────────────────────────────

describe('GET /pets', () => {
  it('returns 200 with a list of pets', async () => {
    const res = await fetch(`${server.url}/pets`)
    expect(res.status).toBe(200)
    const body = await res.json() as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
  })

  it('returns 500 when X-Mock-Status: 500', async () => {
    const res = await fetch(`${server.url}/pets`, {
      headers: { 'x-mock-status': '500' },
    })
    expect(res.status).toBe(500)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('Internal server error')
  })
})

// ─── POST /pets ───────────────────────────────────────────────────────────────

describe('POST /pets', () => {
  it('returns 201 with the created pet', async () => {
    const res = await fetch(`${server.url}/pets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Whiskers', tag: 'cat' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { id: number; name: string }
    expect(typeof body.id).toBe('number')
    expect(body.name).toBe('Whiskers')
  })

  it('returns 422 when X-Mock-Status: 422', async () => {
    const res = await fetch(`${server.url}/pets`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-mock-status': '422',
      },
      body: JSON.stringify({}),
    })
    expect(res.status).toBe(422)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('name is required')
  })
})

// ─── GET /pets/:petId ─────────────────────────────────────────────────────────

describe('GET /pets/:petId', () => {
  it('returns 200 with pet data', async () => {
    const res = await fetch(`${server.url}/pets/1`)
    expect(res.status).toBe(200)
    const body = await res.json() as { id: number; name: string }
    expect(body.id).toBe(1)
    expect(body.name).toBe('Fluffy')
  })

  it('returns 404 when X-Mock-Status: 404', async () => {
    const res = await fetch(`${server.url}/pets/999`, {
      headers: { 'x-mock-status': '404' },
    })
    expect(res.status).toBe(404)
    const body = await res.json() as { error: string }
    expect(body.error).toBe('pet not found')
  })

  it('returns 404 when scenario "404" is active', async () => {
    server.scenario('404')
    try {
      const res = await fetch(`${server.url}/pets/1`)
      expect(res.status).toBe(404)
    } finally {
      server.scenario('')
    }
  })
})

// ─── DELETE /pets/:petId ──────────────────────────────────────────────────────

describe('DELETE /pets/:petId', () => {
  it('returns 204 on success', async () => {
    const res = await fetch(`${server.url}/pets/1`, { method: 'DELETE' })
    expect(res.status).toBe(204)
  })

  it('returns 404 when X-Mock-Status: 404', async () => {
    const res = await fetch(`${server.url}/pets/999`, {
      method: 'DELETE',
      headers: { 'x-mock-status': '404' },
    })
    expect(res.status).toBe(404)
  })
})
