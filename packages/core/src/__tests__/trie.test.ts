import { describe, it, expect } from 'vitest'
import { Trie } from '../router/trie.js'

describe('Trie', () => {
  describe('static paths', () => {
    it('finds an exact match', () => {
      const t = new Trie<string>()
      t.insert('/users', 'list')
      expect(t.find('/users')).toEqual({ data: 'list', params: {} })
    })

    it('returns null for no match', () => {
      const t = new Trie<string>()
      t.insert('/users', 'list')
      expect(t.find('/products')).toBeNull()
    })

    it('normalises trailing slash', () => {
      const t = new Trie<string>()
      t.insert('/users', 'list')
      expect(t.find('/users/')?.data).toBe('list')
    })

    it('matches deeply nested static path', () => {
      const t = new Trie<string>()
      t.insert('/a/b/c/d', 'deep')
      expect(t.find('/a/b/c/d')?.data).toBe('deep')
    })
  })

  describe('param paths (:name)', () => {
    it('captures a single param', () => {
      const t = new Trie<string>()
      t.insert('/users/:id', 'get')
      expect(t.find('/users/123')).toEqual({ data: 'get', params: { id: '123' } })
    })

    it('captures multiple params', () => {
      const t = new Trie<string>()
      t.insert('/users/:userId/orders/:orderId', 'order')
      expect(t.find('/users/1/orders/2')?.params).toEqual({ userId: '1', orderId: '2' })
    })

    it('does not match too few segments', () => {
      const t = new Trie<string>()
      t.insert('/users/:id', 'get')
      expect(t.find('/users')).toBeNull()
    })
  })

  describe('priority: static > param > wildcard', () => {
    it('static wins over param', () => {
      const t = new Trie<string>()
      t.insert('/users/:id', 'param')
      t.insert('/users/me', 'static')
      expect(t.find('/users/me')?.data).toBe('static')
      expect(t.find('/users/123')?.data).toBe('param')
    })

    it('param wins over wildcard for single segment', () => {
      const t = new Trie<string>()
      t.insert('/files/*', 'wildcard')
      t.insert('/files/:name', 'param')
      expect(t.find('/files/doc.txt')?.data).toBe('param')
    })

    it('wildcard matches multi-segment remainder that param cannot', () => {
      const t = new Trie<string>()
      t.insert('/files/*', 'wildcard')
      t.insert('/files/:name', 'param')
      expect(t.find('/files/a/b/c')?.data).toBe('wildcard')
    })
  })

  describe('wildcard (*)', () => {
    it('captures remaining segments as "*"', () => {
      const t = new Trie<string>()
      t.insert('/files/*', 'files')
      expect(t.find('/files/a/b/c')?.params).toEqual({ '*': 'a/b/c' })
    })

    it('captures single segment', () => {
      const t = new Trie<string>()
      t.insert('/files/*', 'files')
      expect(t.find('/files/readme.md')?.params).toEqual({ '*': 'readme.md' })
    })

    it('throws if wildcard is not the last segment', () => {
      const t = new Trie<string>()
      expect(() => t.insert('/files/*/extra', 'bad')).toThrow()
    })
  })

  describe('optional param (:name?)', () => {
    it('matches when param is present', () => {
      const t = new Trie<string>()
      t.insert('/users/:id?', 'handler')
      expect(t.find('/users/123')?.params).toEqual({ id: '123' })
    })

    it('matches when param is absent', () => {
      const t = new Trie<string>()
      t.insert('/users/:id?', 'handler')
      expect(t.find('/users')?.params).toEqual({ id: '' })
    })

    it('returns the same handler for both cases', () => {
      const t = new Trie<string>()
      t.insert('/users/:id?', 'handler')
      expect(t.find('/users/123')?.data).toBe('handler')
      expect(t.find('/users')?.data).toBe('handler')
    })
  })

  describe('edge cases', () => {
    it('handles root path', () => {
      const t = new Trie<string>()
      t.insert('/', 'root')
      expect(t.find('/')?.data).toBe('root')
    })

    it('throws on empty param name', () => {
      const t = new Trie<string>()
      expect(() => t.insert('/users/:', 'bad')).toThrow()
    })

    it('distinguishes different paths at same depth', () => {
      const t = new Trie<string>()
      t.insert('/users', 'users')
      t.insert('/orders', 'orders')
      expect(t.find('/users')?.data).toBe('users')
      expect(t.find('/orders')?.data).toBe('orders')
      expect(t.find('/products')).toBeNull()
    })
  })
})
