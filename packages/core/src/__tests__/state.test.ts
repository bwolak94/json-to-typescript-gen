import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Collection, CollectionError, applyFilters, applySort, deepMerge } from '../state/collection.js'
import { StateStore } from '../state/store.js'
import { seedCollection } from '../state/seeder.js'
import { buildResourceRoutes } from '../state/crud-generator.js'
import { persistStore, loadPersistedStore } from '../state/persistence.js'
import type { ResourceConfig } from '../config/schema.js'
import type { MockContext } from '../types.js'
import { Faker, en } from '@faker-js/faker'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeStore() {
  return new StateStore()
}

function makeFaker() {
  return new Faker({ locale: [en] })
}

function makeResource(overrides: Partial<ResourceConfig> = {}): ResourceConfig {
  return {
    name: 'users',
    path: '/users',
    idField: 'id',
    filters: [],
    sort: false,
    persist: false,
    ...overrides,
  }
}

function makeCtx(
  store: StateStore,
  overrides: Partial<MockContext> = {},
): MockContext {
  return {
    req: { method: 'GET', path: '/users', params: {}, query: {}, headers: {}, body: {} },
    params: {},
    query: {},
    body: {},
    state: store,
    scenario: '',
    faker: makeFaker(),
    ...overrides,
  }
}

// ─── Collection ───────────────────────────────────────────────────────────────

describe('Collection', () => {
  describe('constructor', () => {
    it('creates empty collection', () => {
      const col = new Collection('id')
      expect(col.size()).toBe(0)
    })

    it('seeds with initial items', () => {
      const col = new Collection('id', [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }])
      expect(col.size()).toBe(2)
    })

    it('auto-generates id when missing', () => {
      const col = new Collection<{ name: string; id?: string }>('id', [{ name: 'Alice' }])
      const items = col.toArray()
      expect(items).toHaveLength(1)
      expect(typeof items[0]!['id']).toBe('string')
      expect((items[0]!['id'] as string).length).toBeGreaterThan(0)
    })
  })

  describe('insert', () => {
    it('inserts item and returns it with id', () => {
      const col = new Collection('id')
      const item = col.insert({ id: '1', name: 'Alice' })
      expect(item).toEqual({ id: '1', name: 'Alice' })
      expect(col.size()).toBe(1)
    })

    it('auto-assigns id when missing', () => {
      const col = new Collection('id')
      const item = col.insert({ name: 'Alice' })
      expect(typeof item['id']).toBe('string')
    })

    it('throws CollectionError on duplicate id', () => {
      const col = new Collection('id')
      col.insert({ id: '1', name: 'Alice' })
      expect(() => col.insert({ id: '1', name: 'Bob' })).toThrow(CollectionError)
    })

    it('throws CollectionError on duplicate id with message', () => {
      const col = new Collection('id')
      col.insert({ id: '1' })
      expect(() => col.insert({ id: '1' })).toThrow('Duplicate id: 1')
    })
  })

  describe('get', () => {
    it('retrieves item by id', () => {
      const col = new Collection('id', [{ id: 'abc', val: 42 }])
      expect(col.get('abc')).toEqual({ id: 'abc', val: 42 })
    })

    it('returns undefined for missing id', () => {
      const col = new Collection('id')
      expect(col.get('missing')).toBeUndefined()
    })
  })

  describe('upsert', () => {
    it('inserts when id does not exist', () => {
      const col = new Collection('id')
      col.upsert({ id: '1', name: 'Alice' })
      expect(col.size()).toBe(1)
    })

    it('replaces when id exists', () => {
      const col = new Collection('id', [{ id: '1', name: 'Alice' }])
      col.upsert({ id: '1', name: 'Bob' })
      expect(col.get('1')).toEqual({ id: '1', name: 'Bob' })
      expect(col.size()).toBe(1)
    })
  })

  describe('patch', () => {
    it('merges partial update', () => {
      const col = new Collection('id', [{ id: '1', name: 'Alice', age: 30 }])
      const updated = col.patch('1', { age: 31 })
      expect(updated).toEqual({ id: '1', name: 'Alice', age: 31 })
    })

    it('returns undefined for missing id', () => {
      const col = new Collection('id')
      expect(col.patch('missing', { age: 31 })).toBeUndefined()
    })

    it('deep merges nested objects', () => {
      const col = new Collection('id', [{ id: '1', address: { city: 'NY', zip: '10001' } }])
      col.patch('1', { address: { zip: '10002' } })
      expect(col.get('1')).toEqual({ id: '1', address: { city: 'NY', zip: '10002' } })
    })
  })

  describe('remove', () => {
    it('removes existing item and returns true', () => {
      const col = new Collection('id', [{ id: '1' }])
      expect(col.remove('1')).toBe(true)
      expect(col.size()).toBe(0)
    })

    it('returns false for missing id', () => {
      const col = new Collection('id')
      expect(col.remove('ghost')).toBe(false)
    })
  })

  describe('reset', () => {
    it('clears all items', () => {
      const col = new Collection('id', [{ id: '1' }, { id: '2' }])
      col.reset()
      expect(col.size()).toBe(0)
    })

    it('repopulates with new items', () => {
      const col = new Collection('id', [{ id: '1' }])
      col.reset([{ id: 'a' }, { id: 'b' }])
      expect(col.size()).toBe(2)
      expect(col.get('a')).toBeDefined()
    })
  })

  describe('toArray', () => {
    it('returns all items as array', () => {
      const col = new Collection('id', [{ id: '1', x: 1 }, { id: '2', x: 2 }])
      const arr = col.toArray()
      expect(arr).toHaveLength(2)
    })
  })

  describe('list — no pagination', () => {
    it('returns all items', () => {
      const col = new Collection('id', [{ id: '1' }, { id: '2' }, { id: '3' }])
      const { items, total } = col.list()
      expect(total).toBe(3)
      expect(items).toHaveLength(3)
    })
  })

  describe('list — page pagination', () => {
    let col: Collection

    beforeEach(() => {
      col = new Collection('id', [
        { id: '1', name: 'a' },
        { id: '2', name: 'b' },
        { id: '3', name: 'c' },
        { id: '4', name: 'd' },
        { id: '5', name: 'e' },
      ])
    })

    it('returns first page', () => {
      const { items, total } = col.list({ page: 1, limit: 2 })
      expect(total).toBe(5)
      expect(items).toHaveLength(2)
      expect(items[0]!['id']).toBe('1')
    })

    it('returns second page', () => {
      const { items } = col.list({ page: 2, limit: 2 })
      expect(items[0]!['id']).toBe('3')
      expect(items[1]!['id']).toBe('4')
    })

    it('returns partial last page', () => {
      const { items } = col.list({ page: 3, limit: 2 })
      expect(items).toHaveLength(1)
      expect(items[0]!['id']).toBe('5')
    })
  })

  describe('list — offset pagination', () => {
    it('skips items by offset', () => {
      const col = new Collection('id', [
        { id: '1' }, { id: '2' }, { id: '3' }
      ])
      const { items } = col.list({ offset: 1, limit: 2 })
      expect(items[0]!['id']).toBe('2')
      expect(items[1]!['id']).toBe('3')
    })

    it('offset without limit returns remaining items', () => {
      const col = new Collection('id', [{ id: '1' }, { id: '2' }, { id: '3' }])
      const { items } = col.list({ offset: 1 })
      expect(items).toHaveLength(2)
    })
  })

  describe('list — cursor pagination', () => {
    let col: Collection

    beforeEach(() => {
      col = new Collection('id', [
        { id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }
      ])
    })

    it('limit without cursor uses page/offset mode (returns first 2)', () => {
      const result = col.list({ limit: 2 })
      // no cursor → falls back to page/offset mode
      expect(result.items).toHaveLength(2)
    })

    it('cursor pagination returns nextCursor', () => {
      const page1 = col.list({ cursor: '', limit: 2 })
      expect(page1.items).toHaveLength(2)
      expect(page1.nextCursor).toBe('2')
    })

    it('uses nextCursor to get second page', () => {
      const page1 = col.list({ cursor: '', limit: 2 })
      expect(page1.nextCursor).toBeDefined()
      const page2 = col.list({ cursor: page1.nextCursor!, limit: 2 })
      expect(page2.items[0]!['id']).toBe('3')
    })

    it('last page has no nextCursor', () => {
      const page = col.list({ cursor: '2', limit: 3 })
      expect(page.nextCursor).toBeUndefined()
    })
  })

  describe('list — filtering', () => {
    let col: Collection

    beforeEach(() => {
      col = new Collection('id', [
        { id: '1', name: 'Alice', age: 25, active: true },
        { id: '2', name: 'Bob', age: 30, active: false },
        { id: '3', name: 'Charlie', age: 35, active: true },
        { id: '4', name: 'alice', age: 20, active: false },
      ])
    })

    it('filters by equality', () => {
      const { items } = col.list({ filters: { active: 'true' } })
      expect(items).toHaveLength(2)
    })

    it('filters by _ne (not equal)', () => {
      const { items } = col.list({ filters: { active_ne: 'true' } })
      expect(items).toHaveLength(2)
    })

    it('filters by _gte', () => {
      const { items } = col.list({ filters: { age_gte: '30' } })
      expect(items).toHaveLength(2)
    })

    it('filters by _lte', () => {
      const { items } = col.list({ filters: { age_lte: '25' } })
      expect(items).toHaveLength(2)
    })

    it('filters by _like (case-insensitive substring)', () => {
      const { items } = col.list({ filters: { name_like: 'alice' } })
      expect(items).toHaveLength(2)
    })

    it('combines multiple filters (AND)', () => {
      const { items } = col.list({ filters: { age_gte: '25', active: 'true' } })
      expect(items).toHaveLength(2)
      expect(items.every((i) => i['active'] === true)).toBe(true)
    })
  })

  describe('list — sorting', () => {
    let col: Collection

    beforeEach(() => {
      col = new Collection('id', [
        { id: '1', name: 'Charlie', age: 35 },
        { id: '2', name: 'Alice', age: 25 },
        { id: '3', name: 'Bob', age: 30 },
      ])
    })

    it('sorts ascending by field', () => {
      const { items } = col.list({ sort: 'name' })
      expect(items.map((i) => i['name'])).toEqual(['Alice', 'Bob', 'Charlie'])
    })

    it('sorts descending with - prefix', () => {
      const { items } = col.list({ sort: '-age' })
      expect(items.map((i) => i['age'])).toEqual([35, 30, 25])
    })

    it('sorts numerically for number fields', () => {
      const { items } = col.list({ sort: 'age' })
      expect(items.map((i) => i['age'])).toEqual([25, 30, 35])
    })
  })
})

// ─── applyFilters ─────────────────────────────────────────────────────────────

describe('applyFilters', () => {
  const items = [
    { id: '1', score: 10, tag: 'a' },
    { id: '2', score: 20, tag: 'b' },
    { id: '3', score: 30, tag: 'a' },
  ]

  it('array value uses first element', () => {
    const result = applyFilters(items, { tag: ['a', 'b'] })
    expect(result).toHaveLength(2)
  })

  it('empty filters returns all items', () => {
    expect(applyFilters(items, {})).toHaveLength(3)
  })
})

// ─── applySort ────────────────────────────────────────────────────────────────

describe('applySort', () => {
  it('+ prefix = ascending', () => {
    const items = [{ x: 3 }, { x: 1 }, { x: 2 }]
    const sorted = applySort(items, '+x')
    expect(sorted.map((i) => i['x'])).toEqual([1, 2, 3])
  })

  it('does not mutate original array', () => {
    const items = [{ x: 3 }, { x: 1 }]
    applySort(items, 'x')
    expect(items[0]!['x']).toBe(3)
  })
})

// ─── deepMerge ────────────────────────────────────────────────────────────────

describe('deepMerge', () => {
  it('merges flat objects', () => {
    expect(deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({ a: 1, b: 3, c: 4 })
  })

  it('deep merges nested objects', () => {
    const base = { a: { x: 1, y: 2 } }
    const patch = { a: { y: 99 } }
    expect(deepMerge(base, patch)).toEqual({ a: { x: 1, y: 99 } })
  })

  it('replaces arrays (no array merge)', () => {
    const result = deepMerge({ tags: ['a', 'b'] }, { tags: ['c'] })
    expect(result['tags']).toEqual(['c'])
  })

  it('patch null replaces object', () => {
    const result = deepMerge({ a: { x: 1 } }, { a: null })
    expect(result['a']).toBeNull()
  })
})

// ─── StateStore ───────────────────────────────────────────────────────────────

describe('StateStore', () => {
  it('lazily creates collection on first access', () => {
    const store = makeStore()
    const col = store.collection('users')
    expect(col).toBeInstanceOf(Collection)
    expect(col.size()).toBe(0)
  })

  it('returns same collection instance on repeated access', () => {
    const store = makeStore()
    expect(store.collection('users')).toBe(store.collection('users'))
  })

  it('register() allows pre-built collection', () => {
    const store = makeStore()
    const col = new Collection('id', [{ id: '1' }])
    store.register('items', col)
    expect(store.collection('items').size()).toBe(1)
  })

  it('reset() empties all collections', () => {
    const store = makeStore()
    store.collection('users').insert({ id: '1' })
    store.collection('orders').insert({ id: '10' })
    store.reset()
    expect(store.collection('users').size()).toBe(0)
    expect(store.collection('orders').size()).toBe(0)
  })

  it('snapshot() captures all data', () => {
    const store = makeStore()
    store.collection('users').insert({ id: '1', name: 'Alice' })
    const snap = store.snapshot()
    expect(snap['users']).toHaveLength(1)
    expect(snap['users']![0]!['name']).toBe('Alice')
  })

  it('restore() loads data from snapshot', () => {
    const store = makeStore()
    store.restore({ users: [{ id: '1', name: 'Bob' }] })
    expect(store.collection('users').get('1')).toEqual({ id: '1', name: 'Bob' })
  })

  it('collectionNames() lists registered collections', () => {
    const store = makeStore()
    store.collection('a')
    store.collection('b')
    expect(store.collectionNames().sort()).toEqual(['a', 'b'])
  })
})

// ─── seedCollection ───────────────────────────────────────────────────────────

describe('seedCollection', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'qms-seed-test-'))
  })

  it('no-ops when seed is undefined', async () => {
    const col = new Collection('id')
    await seedCollection(makeResource({ seed: undefined }), col, 42, tmpDir)
    expect(col.size()).toBe(0)
  })

  it('loads from JSON fixture file', async () => {
    const fixturePath = join(tmpDir, 'users.json')
    await writeFile(fixturePath, JSON.stringify([{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }]))

    const col = new Collection('id')
    await seedCollection(
      makeResource({ seed: { count: 2, fixture: 'users.json' } }),
      col,
      42,
      tmpDir,
    )
    expect(col.size()).toBe(2)
    expect(col.get('1')!['name']).toBe('Alice')
  })

  it('generates items from faker schema', async () => {
    const col = new Collection('id')
    await seedCollection(
      makeResource({
        seed: {
          count: 3,
          schema: {
            id: '{{ uuid }}',
            email: '{{ faker.internet.email }}',
          },
        },
      }),
      col,
      42,
      tmpDir,
    )
    expect(col.size()).toBe(3)
    const items = col.toArray()
    for (const item of items) {
      expect(typeof item['email']).toBe('string')
      expect((item['email'] as string).length).toBeGreaterThan(0)
    }
  })

  it('generates deterministic data with same seed', async () => {
    const resource = makeResource({
      seed: {
        count: 2,
        schema: { name: '{{ faker.person.firstName }}' },
      },
    })
    const col1 = new Collection('id')
    const col2 = new Collection('id')
    await seedCollection(resource, col1, 42, tmpDir)
    await seedCollection(resource, col2, 42, tmpDir)
    expect(col1.toArray().map((i) => i['name'])).toEqual(col2.toArray().map((i) => i['name']))
  })

  it('generates different data with different global seeds', async () => {
    const resource = makeResource({
      seed: { count: 5, schema: { name: '{{ faker.person.firstName }}' } },
    })
    const col1 = new Collection('id')
    const col2 = new Collection('id')
    await seedCollection(resource, col1, 42, tmpDir)
    await seedCollection(resource, col2, 99, tmpDir)
    const names1 = col1.toArray().map((i) => i['name'])
    const names2 = col2.toArray().map((i) => i['name'])
    expect(names1).not.toEqual(names2)
  })

  it('static values in schema pass through unchanged', async () => {
    const col = new Collection('id')
    await seedCollection(
      makeResource({ seed: { count: 1, schema: { type: 'admin', level: 5 } } }),
      col,
      42,
      tmpDir,
    )
    const item = col.toArray()[0]!
    expect(item['type']).toBe('admin')
    expect(item['level']).toBe(5)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })
})

// ─── buildResourceRoutes — basic CRUD ────────────────────────────────────────

describe('buildResourceRoutes', () => {
  let store: StateStore

  beforeEach(() => {
    store = makeStore()
  })

  function invokeRoute(
    routes: ReturnType<typeof buildResourceRoutes>,
    routeId: string,
    ctxOverrides: Partial<MockContext> = {},
  ) {
    const route = routes.find((r) => r.id === routeId)
    if (!route) throw new Error(`Route ${routeId} not found`)
    return route.handler(makeCtx(store, ctxOverrides))
  }

  it('generates 6 routes', () => {
    const routes = buildResourceRoutes(makeResource(), store)
    expect(routes).toHaveLength(6)
  })

  it('routes have correct methods', () => {
    const routes = buildResourceRoutes(makeResource(), store)
    const methods = routes.map((r) => r.method).sort()
    expect(methods).toEqual(['DELETE', 'GET', 'GET', 'PATCH', 'POST', 'PUT'])
  })

  it('list route returns empty array', async () => {
    const routes = buildResourceRoutes(makeResource(), store)
    const result = await invokeRoute(routes, 'users:list')
    expect(result.status).toBe(200)
    expect(result.body).toEqual([])
    expect(result.headers['x-total-count']).toBe('0')
  })

  it('create route inserts item and returns 201', async () => {
    const routes = buildResourceRoutes(makeResource(), store)
    const result = await invokeRoute(routes, 'users:create', {
      body: { name: 'Alice', role: 'admin' },
    })
    expect(result.status).toBe(201)
    const body = result.body as { id: string; name: string }
    expect(body.name).toBe('Alice')
    expect(typeof body.id).toBe('string')
    expect(result.headers['location']).toContain('/users/')
  })

  it('get route returns item by id', async () => {
    const col = store.collection('users')
    col.insert({ id: '42', name: 'Bob' })
    const routes = buildResourceRoutes(makeResource(), store)
    const result = await invokeRoute(routes, 'users:get', { params: { id: '42' } })
    expect(result.status).toBe(200)
    expect((result.body as { name: string }).name).toBe('Bob')
  })

  it('get route returns 404 for missing id', async () => {
    const routes = buildResourceRoutes(makeResource(), store)
    const result = await invokeRoute(routes, 'users:get', { params: { id: 'nope' } })
    expect(result.status).toBe(404)
  })

  it('replace route upserts item', async () => {
    const col = store.collection('users')
    col.insert({ id: '1', name: 'Old' })
    const routes = buildResourceRoutes(makeResource(), store)
    const result = await invokeRoute(routes, 'users:replace', {
      params: { id: '1' },
      body: { name: 'New' },
    })
    expect(result.status).toBe(200)
    expect((result.body as { name: string }).name).toBe('New')
    expect(col.get('1')!['name']).toBe('New')
  })

  it('patch route merges partial update', async () => {
    const col = store.collection('users')
    col.insert({ id: '1', name: 'Alice', age: 30 })
    const routes = buildResourceRoutes(makeResource(), store)
    const result = await invokeRoute(routes, 'users:patch', {
      params: { id: '1' },
      body: { age: 31 },
    })
    expect(result.status).toBe(200)
    const body = result.body as { name: string; age: number }
    expect(body.name).toBe('Alice')
    expect(body.age).toBe(31)
  })

  it('patch route returns 404 for missing id', async () => {
    const routes = buildResourceRoutes(makeResource(), store)
    const result = await invokeRoute(routes, 'users:patch', {
      params: { id: 'ghost' },
      body: { name: 'X' },
    })
    expect(result.status).toBe(404)
  })

  it('delete route removes item and returns 204', async () => {
    const col = store.collection('users')
    col.insert({ id: '1' })
    const routes = buildResourceRoutes(makeResource(), store)
    const result = await invokeRoute(routes, 'users:delete', { params: { id: '1' } })
    expect(result.status).toBe(204)
    expect(col.size()).toBe(0)
  })

  it('delete route returns 404 for missing id', async () => {
    const routes = buildResourceRoutes(makeResource(), store)
    const result = await invokeRoute(routes, 'users:delete', { params: { id: 'nope' } })
    expect(result.status).toBe(404)
  })

  it('list returns X-Total-Count header', async () => {
    const col = store.collection('users')
    col.insert({ id: '1' })
    col.insert({ id: '2' })
    const routes = buildResourceRoutes(makeResource(), store)
    const result = await invokeRoute(routes, 'users:list')
    expect(result.headers['x-total-count']).toBe('2')
  })

  it('list supports pagination via query', async () => {
    for (let i = 1; i <= 5; i++) {
      store.collection('users').insert({ id: String(i) })
    }
    const routes = buildResourceRoutes(
      makeResource({ pagination: { style: 'page', pageParam: 'page', sizeParam: 'limit', default: 2 } }),
      store,
    )
    const result = await invokeRoute(routes, 'users:list', {
      query: { page: '1', limit: '2' },
      req: { method: 'GET', path: '/users', params: {}, query: { page: '1', limit: '2' }, headers: {}, body: {} },
    })
    expect(result.status).toBe(200)
    expect((result.body as unknown[]).length).toBe(2)
    expect(result.headers['x-total-count']).toBe('5')
    expect(result.headers['link']).toContain('rel="next"')
  })

  it('list supports filter via query', async () => {
    store.collection('users').insert({ id: '1', role: 'admin' })
    store.collection('users').insert({ id: '2', role: 'user' })
    store.collection('users').insert({ id: '3', role: 'admin' })
    const routes = buildResourceRoutes(makeResource(), store)
    const result = await invokeRoute(routes, 'users:list', {
      query: { role: 'admin' },
    })
    expect((result.body as unknown[]).length).toBe(2)
    expect(result.headers['x-total-count']).toBe('2')
  })

  it('create route returns 409 on duplicate id', async () => {
    store.collection('users').insert({ id: '1', name: 'Alice' })
    const routes = buildResourceRoutes(makeResource(), store)
    const result = await invokeRoute(routes, 'users:create', { body: { id: '1', name: 'Dup' } })
    expect(result.status).toBe(409)
  })
})

// ─── buildResourceRoutes — validation ─────────────────────────────────────────

describe('buildResourceRoutes — body validation', () => {
  it('returns 422 when Zod validation fails', async () => {
    const { z } = await import('zod')
    const store = makeStore()
    const resource = makeResource({
      validation: z.object({ name: z.string().min(3) }),
    })
    const routes = buildResourceRoutes(resource, store)
    const createRoute = routes.find((r) => r.id === 'users:create')!
    const result = await createRoute.handler(makeCtx(store, { body: { name: 'ab' } }))
    expect(result.status).toBe(422)
  })

  it('passes validation when body matches schema', async () => {
    const { z } = await import('zod')
    const store = makeStore()
    const resource = makeResource({
      validation: z.object({ name: z.string().min(3) }),
    })
    const routes = buildResourceRoutes(resource, store)
    const createRoute = routes.find((r) => r.id === 'users:create')!
    const result = await createRoute.handler(makeCtx(store, { body: { name: 'Alice' } }))
    expect(result.status).toBe(201)
  })
})

// ─── buildResourceRoutes — belongsTo ─────────────────────────────────────────

describe('buildResourceRoutes — belongsTo nested routes', () => {
  let store: StateStore

  beforeEach(() => {
    store = makeStore()
    store.collection('orders').insert({ id: '10', userId: 'u1', item: 'book' })
    store.collection('orders').insert({ id: '11', userId: 'u2', item: 'pen' })
  })

  const resource = makeResource({
    name: 'orders',
    path: '/orders',
    belongsTo: { parentPath: '/users', foreignKey: 'userId' },
  })

  function invokeNested(
    routes: ReturnType<typeof buildResourceRoutes>,
    routeId: string,
    ctxOverrides: Partial<MockContext>,
  ) {
    const route = routes.find((r) => r.id === routeId)
    if (!route) throw new Error(`Route ${routeId} not found`)
    return route.handler(makeCtx(store, ctxOverrides))
  }

  it('generates 12 routes (6 base + 6 nested)', () => {
    const routes = buildResourceRoutes(resource, store)
    expect(routes).toHaveLength(12)
  })

  it('nested list filters by foreignKey', async () => {
    const routes = buildResourceRoutes(resource, store)
    const result = await invokeNested(routes, 'nested-userId-orders:list', {
      params: { userId: 'u1' },
      req: { method: 'GET', path: '/users/u1/orders', params: { userId: 'u1' }, query: {}, headers: {}, body: {} },
    })
    expect(result.status).toBe(200)
    const items = result.body as { id: string }[]
    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe('10')
  })

  it('nested get returns 404 when item belongs to different parent', async () => {
    const routes = buildResourceRoutes(resource, store)
    const result = await invokeNested(routes, 'nested-userId-orders:get', {
      params: { userId: 'u2', id: '10' },
    })
    expect(result.status).toBe(404)
  })

  it('nested create sets foreignKey from url param', async () => {
    const routes = buildResourceRoutes(resource, store)
    const result = await invokeNested(routes, 'nested-userId-orders:create', {
      params: { userId: 'u3' },
      body: { item: 'notebook' },
    })
    expect(result.status).toBe(201)
    const body = result.body as { userId: string }
    expect(body.userId).toBe('u3')
  })

  it('deriveParentParam: /users → userId', () => {
    const routes = buildResourceRoutes(resource, store)
    const nestedList = routes.find((r) => r.path === '/users/:userId/orders')
    expect(nestedList).toBeDefined()
  })
})

// ─── Persistence ──────────────────────────────────────────────────────────────

describe('persistStore / loadPersistedStore', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'qms-persist-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  it('persists and restores store data', async () => {
    const store = makeStore()
    store.collection('users').insert({ id: '1', name: 'Alice' })
    store.collection('orders').insert({ id: '100', userId: '1' })

    const filePath = join(tmpDir, 'state.json')
    await persistStore(store, filePath)

    const restored = makeStore()
    const ok = await loadPersistedStore(restored, filePath)
    expect(ok).toBe(true)
    expect(restored.collection('users').get('1')).toEqual({ id: '1', name: 'Alice' })
    expect(restored.collection('orders').get('100')).toEqual({ id: '100', userId: '1' })
  })

  it('creates parent directory if it does not exist', async () => {
    const store = makeStore()
    store.collection('x').insert({ id: '1' })
    const filePath = join(tmpDir, 'nested', 'deep', 'state.json')
    await expect(persistStore(store, filePath)).resolves.toBeUndefined()
  })

  it('returns false when file does not exist', async () => {
    const store = makeStore()
    const ok = await loadPersistedStore(store, join(tmpDir, 'nonexistent.json'))
    expect(ok).toBe(false)
  })

  it('returns false for invalid JSON', async () => {
    const filePath = join(tmpDir, 'bad.json')
    await writeFile(filePath, 'not json')
    const store = makeStore()
    const ok = await loadPersistedStore(store, filePath)
    expect(ok).toBe(false)
  })

  it('returns false for non-object JSON', async () => {
    const filePath = join(tmpDir, 'arr.json')
    await writeFile(filePath, '[1,2,3]')
    const store = makeStore()
    const ok = await loadPersistedStore(store, filePath)
    expect(ok).toBe(false)
  })
})
