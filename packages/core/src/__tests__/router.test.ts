import { describe, it, expect } from 'vitest'
import { Router } from '../router/router.js'
import type { RouteEntry } from '../router/router.js'

interface TestRoute extends RouteEntry {
  name: string
}

function r(
  method: TestRoute['method'],
  path: string,
  name: string,
): TestRoute {
  return { id: `${method}:${path}`, method, path, name }
}

describe('Router', () => {
  describe('basic matching', () => {
    it('matches a GET route', () => {
      const router = new Router<TestRoute>()
      router.add(r('GET', '/users', 'list'))
      expect(router.find('GET', '/users')?.route.name).toBe('list')
    })

    it('returns null for wrong method', () => {
      const router = new Router<TestRoute>()
      router.add(r('GET', '/users', 'list'))
      expect(router.find('POST', '/users')).toBeNull()
    })

    it('returns null for unregistered path', () => {
      const router = new Router<TestRoute>()
      router.add(r('GET', '/users', 'list'))
      expect(router.find('GET', '/orders')).toBeNull()
    })

    it('captures path params', () => {
      const router = new Router<TestRoute>()
      router.add(r('GET', '/users/:id', 'get'))
      const result = router.find('GET', '/users/42')
      expect(result?.route.name).toBe('get')
      expect(result?.params).toEqual({ id: '42' })
    })
  })

  describe('priority: static > param > wildcard', () => {
    it('static beats param for same segment', () => {
      const router = new Router<TestRoute>()
      router.add(r('GET', '/users/:id', 'param'))
      router.add(r('GET', '/users/me', 'static'))
      expect(router.find('GET', '/users/me')?.route.name).toBe('static')
      expect(router.find('GET', '/users/99')?.route.name).toBe('param')
    })

    it('param beats wildcard for single segment', () => {
      const router = new Router<TestRoute>()
      router.add(r('GET', '/assets/*', 'wildcard'))
      router.add(r('GET', '/assets/:file', 'param'))
      expect(router.find('GET', '/assets/logo.png')?.route.name).toBe('param')
    })
  })

  describe('AUTO HEAD', () => {
    it('falls back to GET handler when no HEAD registered', () => {
      const router = new Router<TestRoute>()
      router.add(r('GET', '/users', 'list'))
      expect(router.find('HEAD', '/users')?.route.name).toBe('list')
    })

    it('uses explicit HEAD handler when registered', () => {
      const router = new Router<TestRoute>()
      router.add(r('GET', '/users', 'get'))
      router.add(r('HEAD', '/users', 'head'))
      expect(router.find('HEAD', '/users')?.route.name).toBe('head')
    })

    it('returns null for HEAD when no GET or HEAD handler', () => {
      const router = new Router<TestRoute>()
      router.add(r('POST', '/users', 'create'))
      expect(router.find('HEAD', '/users')).toBeNull()
    })
  })

  describe('ALL method (wildcard method)', () => {
    it('matches any HTTP method', () => {
      const router = new Router<TestRoute>()
      router.add(r('ALL', '/health', 'health'))
      expect(router.find('GET', '/health')?.route.name).toBe('health')
      expect(router.find('POST', '/health')?.route.name).toBe('health')
      expect(router.find('DELETE', '/health')?.route.name).toBe('health')
    })

    it('specific method takes priority over ALL', () => {
      const router = new Router<TestRoute>()
      router.add(r('ALL', '/health', 'all'))
      router.add(r('GET', '/health', 'specific'))
      expect(router.find('GET', '/health')?.route.name).toBe('specific')
      expect(router.find('POST', '/health')?.route.name).toBe('all')
    })
  })

  describe('allowedMethods (for OPTIONS)', () => {
    it('returns methods registered for a path', () => {
      const router = new Router<TestRoute>()
      router.add(r('GET', '/users', 'list'))
      router.add(r('POST', '/users', 'create'))
      const methods = router.allowedMethods('/users')
      expect(methods).toContain('GET')
      expect(methods).toContain('POST')
    })

    it('includes HEAD when GET is registered', () => {
      const router = new Router<TestRoute>()
      router.add(r('GET', '/users', 'list'))
      expect(router.allowedMethods('/users')).toContain('HEAD')
    })

    it('includes OPTIONS when any method is registered', () => {
      const router = new Router<TestRoute>()
      router.add(r('POST', '/users', 'create'))
      expect(router.allowedMethods('/users')).toContain('OPTIONS')
    })

    it('returns empty array for unregistered path', () => {
      const router = new Router<TestRoute>()
      expect(router.allowedMethods('/nowhere')).toHaveLength(0)
    })

    it('ALL registered expands to standard methods in allowedMethods', () => {
      const router = new Router<TestRoute>()
      router.add(r('ALL', '/api', 'all'))
      const methods = router.allowedMethods('/api')
      expect(methods).toContain('GET')
      expect(methods).toContain('POST')
      expect(methods).toContain('PUT')
      expect(methods).toContain('PATCH')
      expect(methods).toContain('DELETE')
      expect(methods).toContain('OPTIONS')
    })

    it('returns sorted results', () => {
      const router = new Router<TestRoute>()
      router.add(r('POST', '/things', 'create'))
      router.add(r('GET', '/things', 'list'))
      router.add(r('DELETE', '/things', 'bulk-delete'))
      const methods = router.allowedMethods('/things')
      const sorted = [...methods].sort()
      expect(methods).toEqual(sorted)
    })

    it('works for paths with params', () => {
      const router = new Router<TestRoute>()
      router.add(r('GET', '/users/:id', 'get'))
      router.add(r('PUT', '/users/:id', 'update'))
      const methods = router.allowedMethods('/users/42')
      expect(methods).toContain('GET')
      expect(methods).toContain('PUT')
    })
  })

  describe('case insensitivity for method lookup', () => {
    it('accepts lowercase method in find()', () => {
      const router = new Router<TestRoute>()
      router.add(r('GET', '/users', 'list'))
      expect(router.find('get', '/users')?.route.name).toBe('list')
    })
  })

  describe('* method (alias for ALL)', () => {
    it('matches any HTTP method when registered as *', () => {
      const router = new Router<TestRoute>()
      router.add(r('*', '/ping', 'ping'))
      expect(router.find('GET', '/ping')?.route.name).toBe('ping')
      expect(router.find('DELETE', '/ping')?.route.name).toBe('ping')
      expect(router.find('PATCH', '/ping')?.route.name).toBe('ping')
    })

    it('specific method takes priority over * method', () => {
      const router = new Router<TestRoute>()
      router.add(r('*', '/ping', 'catchall'))
      router.add(r('GET', '/ping', 'explicit'))
      expect(router.find('GET', '/ping')?.route.name).toBe('explicit')
      expect(router.find('POST', '/ping')?.route.name).toBe('catchall')
    })
  })

  describe('complex nested routes', () => {
    it('resolves multi-level nested params', () => {
      const router = new Router<TestRoute>()
      router.add(r('GET', '/users/:userId/orders/:orderId', 'order'))
      const result = router.find('GET', '/users/1/orders/2')
      expect(result?.params).toEqual({ userId: '1', orderId: '2' })
    })

    it('resolves wildcard in nested path', () => {
      const router = new Router<TestRoute>()
      router.add(r('GET', '/static/*', 'assets'))
      const result = router.find('GET', '/static/js/app.bundle.js')
      expect(result?.route.name).toBe('assets')
      expect(result?.params['*']).toBe('js/app.bundle.js')
    })
  })
})
