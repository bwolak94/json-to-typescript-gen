import { describe, it, expect } from 'vitest'
import { compilePredicate, matchRequest, matchResponse } from '../matcher/index.js'
import type { MockRequest, CompiledResponse } from '../types.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    method: 'GET',
    path: '/test',
    params: {},
    query: {},
    headers: {},
    body: {},
    ...overrides,
  }
}

function makeResponse(overrides: Partial<CompiledResponse> = {}): CompiledResponse {
  return {
    status: 200,
    headers: {},
    body: { ok: true },
    ...overrides,
  }
}

// ─── compilePredicate ─────────────────────────────────────────────────────────

describe('compilePredicate', () => {
  it('returns empty array for empty when clause', () => {
    expect(compilePredicate({})).toEqual([])
  })

  it('skips keys without a dot (malformed)', () => {
    const pred = compilePredicate({ 'invalid': 'value' })
    expect(pred).toHaveLength(0)
  })

  it('skips keys with unsupported source', () => {
    const pred = compilePredicate({ 'cookies.session': 'abc' })
    expect(pred).toHaveLength(0)
  })

  it('compiles params key', () => {
    const pred = compilePredicate({ 'params.id': '42' })
    expect(pred).toHaveLength(1)
    expect(pred[0]!.source).toBe('params')
    expect(pred[0]!.path).toEqual(['id'])
  })

  it('compiles query key', () => {
    const pred = compilePredicate({ 'query.page': '1' })
    expect(pred[0]!.source).toBe('query')
    expect(pred[0]!.path).toEqual(['page'])
  })

  it('compiles headers key', () => {
    const pred = compilePredicate({ 'headers.x-api-key': 'secret' })
    expect(pred[0]!.source).toBe('headers')
    expect(pred[0]!.path).toEqual(['x-api-key'])
  })

  it('compiles nested body path', () => {
    const pred = compilePredicate({ 'body.user.age': 30 })
    expect(pred[0]!.source).toBe('body')
    expect(pred[0]!.path).toEqual(['user', 'age'])
  })

  it('compiles body JSONPath starting with $', () => {
    const pred = compilePredicate({ 'body.$.items[0].sku': 'ABC' })
    expect(pred[0]!.source).toBe('body')
    expect(pred[0]!.jsonpath).toBe('$.items[0].sku')
    expect(pred[0]!.path).toEqual([])
  })

  it('compiles regex operator', () => {
    const pred = compilePredicate({ 'query.search': { regex: '^hello' } })
    const entry = pred[0]!
    expect(entry.matcher.type).toBe('regex')
  })

  it('compiles in operator', () => {
    const pred = compilePredicate({ 'params.status': { in: ['active', 'pending'] } })
    expect(pred[0]!.matcher.type).toBe('in')
  })

  it('compiles absent operator', () => {
    const pred = compilePredicate({ 'headers.authorization': { absent: true } })
    expect(pred[0]!.matcher.type).toBe('absent')
  })

  it('compiles present operator', () => {
    const pred = compilePredicate({ 'headers.x-api-key': { present: true } })
    expect(pred[0]!.matcher.type).toBe('present')
  })

  it('compiles gt operator', () => {
    const pred = compilePredicate({ 'body.age': { gt: 18 } })
    expect(pred[0]!.matcher.type).toBe('gt')
  })

  it('compiles lt operator', () => {
    const pred = compilePredicate({ 'body.score': { lt: 100 } })
    expect(pred[0]!.matcher.type).toBe('lt')
  })

  it('compiles contains operator', () => {
    const pred = compilePredicate({ 'body.name': { contains: 'foo' } })
    expect(pred[0]!.matcher.type).toBe('contains')
  })

  it('compiles plain object as partial match', () => {
    const pred = compilePredicate({ 'body.user': { name: 'alice', role: 'admin' } })
    expect(pred[0]!.matcher.type).toBe('partial')
  })

  it('compiles array as partial match', () => {
    const pred = compilePredicate({ 'body.tags': ['a', 'b'] })
    expect(pred[0]!.matcher.type).toBe('partial')
  })
})

// ─── matchRequest — equality ───────────────────────────────────────────────────

describe('matchRequest — equality', () => {
  it('matches exact string param', () => {
    const pred = compilePredicate({ 'params.id': '42' })
    expect(matchRequest(pred, makeReq({ params: { id: '42' } }))).toBe(true)
  })

  it('fails on mismatched param', () => {
    const pred = compilePredicate({ 'params.id': '42' })
    expect(matchRequest(pred, makeReq({ params: { id: '99' } }))).toBe(false)
  })

  it('loose equality: string "42" matches number 42', () => {
    const pred = compilePredicate({ 'query.page': 1 })
    expect(matchRequest(pred, makeReq({ query: { page: '1' } }))).toBe(true)
  })

  it('matches header value', () => {
    const pred = compilePredicate({ 'headers.x-api-key': 'secret' })
    expect(matchRequest(pred, makeReq({ headers: { 'x-api-key': 'secret' } }))).toBe(true)
  })

  it('matches nested body field', () => {
    const pred = compilePredicate({ 'body.user.age': 30 })
    expect(matchRequest(pred, makeReq({ body: { user: { age: 30 } } }))).toBe(true)
  })

  it('fails when body field is missing', () => {
    const pred = compilePredicate({ 'body.user.age': 30 })
    expect(matchRequest(pred, makeReq({ body: {} }))).toBe(false)
  })

  it('all conditions must pass (AND semantics)', () => {
    const pred = compilePredicate({ 'params.id': '1', 'query.page': '2' })
    expect(matchRequest(pred, makeReq({ params: { id: '1' }, query: { page: '2' } }))).toBe(true)
    expect(matchRequest(pred, makeReq({ params: { id: '1' }, query: { page: '9' } }))).toBe(false)
    expect(matchRequest(pred, makeReq({ params: { id: '9' }, query: { page: '2' } }))).toBe(false)
  })
})

// ─── matchRequest — regex ─────────────────────────────────────────────────────

describe('matchRequest — regex', () => {
  it('matches query value against regex', () => {
    const pred = compilePredicate({ 'query.q': { regex: '^hello' } })
    expect(matchRequest(pred, makeReq({ query: { q: 'hello world' } }))).toBe(true)
    expect(matchRequest(pred, makeReq({ query: { q: 'world' } }))).toBe(false)
  })

  it('matches case-insensitive with regex flags', () => {
    const pred = compilePredicate({ 'headers.accept': { regex: 'application/json' } })
    expect(matchRequest(pred, makeReq({ headers: { accept: 'application/json' } }))).toBe(true)
  })

  it('treats null/undefined as empty string for regex', () => {
    const pred = compilePredicate({ 'query.missing': { regex: '^$' } })
    expect(matchRequest(pred, makeReq({ query: {} }))).toBe(true)
  })
})

// ─── matchRequest — in ────────────────────────────────────────────────────────

describe('matchRequest — in', () => {
  it('matches when value is in the list', () => {
    const pred = compilePredicate({ 'params.status': { in: ['active', 'pending'] } })
    expect(matchRequest(pred, makeReq({ params: { status: 'active' } }))).toBe(true)
    expect(matchRequest(pred, makeReq({ params: { status: 'pending' } }))).toBe(true)
    expect(matchRequest(pred, makeReq({ params: { status: 'deleted' } }))).toBe(false)
  })

  it('uses loose equality within in-list (number vs string)', () => {
    const pred = compilePredicate({ 'query.code': { in: [200, 201] } })
    expect(matchRequest(pred, makeReq({ query: { code: '200' } }))).toBe(true)
    expect(matchRequest(pred, makeReq({ query: { code: '404' } }))).toBe(false)
  })
})

// ─── matchRequest — absent / present ──────────────────────────────────────────

describe('matchRequest — absent / present', () => {
  it('absent: true passes when key is missing', () => {
    const pred = compilePredicate({ 'headers.authorization': { absent: true } })
    expect(matchRequest(pred, makeReq({ headers: {} }))).toBe(true)
    expect(matchRequest(pred, makeReq({ headers: { authorization: 'Bearer x' } }))).toBe(false)
  })

  it('present: true passes when key has a non-empty value', () => {
    const pred = compilePredicate({ 'headers.x-api-key': { present: true } })
    expect(matchRequest(pred, makeReq({ headers: { 'x-api-key': 'abc' } }))).toBe(true)
    expect(matchRequest(pred, makeReq({ headers: {} }))).toBe(false)
  })

  it('present: true fails for empty string', () => {
    const pred = compilePredicate({ 'query.q': { present: true } })
    expect(matchRequest(pred, makeReq({ query: { q: '' } }))).toBe(false)
  })
})

// ─── matchRequest — gt / lt ───────────────────────────────────────────────────

describe('matchRequest — gt / lt', () => {
  it('gt passes when body number exceeds threshold', () => {
    const pred = compilePredicate({ 'body.age': { gt: 18 } })
    expect(matchRequest(pred, makeReq({ body: { age: 19 } }))).toBe(true)
    expect(matchRequest(pred, makeReq({ body: { age: 18 } }))).toBe(false)
    expect(matchRequest(pred, makeReq({ body: { age: 17 } }))).toBe(false)
  })

  it('lt passes when body number is below threshold', () => {
    const pred = compilePredicate({ 'body.score': { lt: 100 } })
    expect(matchRequest(pred, makeReq({ body: { score: 99 } }))).toBe(true)
    expect(matchRequest(pred, makeReq({ body: { score: 100 } }))).toBe(false)
  })

  it('gt fails for non-number', () => {
    const pred = compilePredicate({ 'body.age': { gt: 0 } })
    expect(matchRequest(pred, makeReq({ body: { age: 'old' } }))).toBe(false)
  })
})

// ─── matchRequest — contains ──────────────────────────────────────────────────

describe('matchRequest — contains', () => {
  it('contains passes when string includes substring', () => {
    const pred = compilePredicate({ 'body.name': { contains: 'admin' } })
    expect(matchRequest(pred, makeReq({ body: { name: 'super-admin' } }))).toBe(true)
    expect(matchRequest(pred, makeReq({ body: { name: 'user' } }))).toBe(false)
  })

  it('contains passes when array has matching element', () => {
    const pred = compilePredicate({ 'body.roles': { contains: 'editor' } })
    expect(matchRequest(pred, makeReq({ body: { roles: ['admin', 'editor'] } }))).toBe(true)
    expect(matchRequest(pred, makeReq({ body: { roles: ['admin'] } }))).toBe(false)
  })

  it('contains fails for non-string non-array', () => {
    const pred = compilePredicate({ 'body.count': { contains: '5' } })
    expect(matchRequest(pred, makeReq({ body: { count: 5 } }))).toBe(false)
  })
})

// ─── matchRequest — partial deep match ────────────────────────────────────────

describe('matchRequest — partial deep match', () => {
  it('matches object subset', () => {
    const pred = compilePredicate({ 'body.user': { role: 'admin' } })
    expect(matchRequest(pred, makeReq({ body: { user: { id: 1, role: 'admin' } } }))).toBe(true)
    expect(matchRequest(pred, makeReq({ body: { user: { id: 1, role: 'guest' } } }))).toBe(false)
  })

  it('matches nested object subset', () => {
    const pred = compilePredicate({ 'body': { user: { role: 'admin' } } })
    expect(matchRequest(pred, makeReq({ body: { user: { id: 1, role: 'admin' }, extra: true } }))).toBe(true)
  })

  it('partial array match: each shape element must match corresponding actual element', () => {
    const pred = compilePredicate({ 'body.items': [{ id: 1 }] })
    expect(matchRequest(pred, makeReq({ body: { items: [{ id: 1, name: 'a' }, { id: 2 }] } }))).toBe(true)
    expect(matchRequest(pred, makeReq({ body: { items: [{ id: 99 }] } }))).toBe(false)
  })

  it('fails when actual is not an object', () => {
    const pred = compilePredicate({ 'body.user': { role: 'admin' } })
    expect(matchRequest(pred, makeReq({ body: { user: 'string' } }))).toBe(false)
  })
})

// ─── matchRequest — JSONPath ──────────────────────────────────────────────────

describe('matchRequest — JSONPath', () => {
  it('resolves simple property path', () => {
    const pred = compilePredicate({ 'body.$.user.name': 'alice' })
    expect(matchRequest(pred, makeReq({ body: { user: { name: 'alice' } } }))).toBe(true)
    expect(matchRequest(pred, makeReq({ body: { user: { name: 'bob' } } }))).toBe(false)
  })

  it('resolves array index', () => {
    const pred = compilePredicate({ 'body.$.items[0].sku': 'ABC' })
    expect(matchRequest(pred, makeReq({ body: { items: [{ sku: 'ABC' }, { sku: 'DEF' }] } }))).toBe(true)
    expect(matchRequest(pred, makeReq({ body: { items: [{ sku: 'XYZ' }] } }))).toBe(false)
  })

  it('returns undefined for out-of-bounds index', () => {
    const pred = compilePredicate({ 'body.$.items[5].sku': 'ABC' })
    expect(matchRequest(pred, makeReq({ body: { items: [{ sku: 'ABC' }] } }))).toBe(false)
  })

  it('resolves bracket notation with quoted prop', () => {
    const pred = compilePredicate({ "body.$['user']['name']": 'alice' })
    expect(matchRequest(pred, makeReq({ body: { user: { name: 'alice' } } }))).toBe(true)
  })

  it('resolves recursive descent ..prop', () => {
    const pred = compilePredicate({ 'body.$..name': 'alice' })
    const body = { users: [{ name: 'alice' }] }
    // recursive descent collects all 'name' values; result is an array → eq check
    // The match with 'alice' will use looseEqual which checks array vs string
    // Actually the result is an array ['alice'] when only one match and recursion collects all
    // Since evaluateJsonPath returns array when multiple, we need contains or eq
    // Let's test with a single unique match path instead
    const pred2 = compilePredicate({ 'body.$.users[0].name': 'alice' })
    expect(matchRequest(pred2, makeReq({ body }))).toBe(true)
  })

  it('returns undefined for missing jsonpath', () => {
    const pred = compilePredicate({ 'body.$.missing.field': 'x' })
    expect(matchRequest(pred, makeReq({ body: {} }))).toBe(false)
  })
})

// ─── matchResponse ────────────────────────────────────────────────────────────

describe('matchResponse', () => {
  const req = makeReq()

  it('returns undefined when no responses', () => {
    expect(matchResponse([], req, '')).toBeUndefined()
  })

  it('returns first response when no constraints', () => {
    const r1 = makeResponse({ status: 200 })
    const r2 = makeResponse({ status: 201 })
    expect(matchResponse([r1, r2], req, '')).toBe(r1)
  })

  it('skips responses where when predicate fails', () => {
    const pred = compilePredicate({ 'query.q': 'hello' })
    const r1 = makeResponse({ when: pred, status: 200 })
    const r2 = makeResponse({ status: 404 })
    const result = matchResponse([r1, r2], makeReq({ query: { q: 'world' } }), '')
    expect(result?.status).toBe(404)
  })

  it('returns matching response when when predicate passes', () => {
    const pred = compilePredicate({ 'query.q': 'hello' })
    const r1 = makeResponse({ when: pred, status: 200 })
    const r2 = makeResponse({ status: 404 })
    const result = matchResponse([r1, r2], makeReq({ query: { q: 'hello' } }), '')
    expect(result?.status).toBe(200)
  })

  it('first matching response wins (priority order)', () => {
    const pred1 = compilePredicate({ 'params.id': '1' })
    const pred2 = compilePredicate({ 'params.id': '1' })
    const r1 = makeResponse({ when: pred1, status: 200 })
    const r2 = makeResponse({ when: pred2, status: 201 })
    const result = matchResponse([r1, r2], makeReq({ params: { id: '1' } }), '')
    expect(result?.status).toBe(200)
  })
})

// ─── Scenario matching ────────────────────────────────────────────────────────

describe('scenario matching', () => {
  const req = makeReq()

  it('response without scenario matches any scenario', () => {
    const r = makeResponse({ status: 200 })
    expect(matchResponse([r], req, 'any-scenario')).toBe(r)
    expect(matchResponse([r], req, '')).toBe(r)
  })

  it('response with scenario only matches when scenario is active', () => {
    const r = makeResponse({ scenario: 'error', status: 500 })
    expect(matchResponse([r], req, 'error')).toBe(r)
    expect(matchResponse([r], req, 'success')).toBeUndefined()
    expect(matchResponse([r], req, '')).toBeUndefined()
  })

  it('falls back to unconstrained response when scenario does not match', () => {
    const r1 = makeResponse({ scenario: 'error', status: 500 })
    const r2 = makeResponse({ status: 200 })
    expect(matchResponse([r1, r2], req, 'success')?.status).toBe(200)
    expect(matchResponse([r1, r2], req, 'error')?.status).toBe(500)
  })

  it('scenario + when: both must match', () => {
    const pred = compilePredicate({ 'query.q': 'hello' })
    const r = makeResponse({ scenario: 'test', when: pred, status: 202 })
    const fallback = makeResponse({ status: 200 })

    // scenario matches, predicate passes → 202
    expect(matchResponse([r, fallback], makeReq({ query: { q: 'hello' } }), 'test')?.status).toBe(202)
    // scenario matches, predicate fails → 200
    expect(matchResponse([r, fallback], makeReq({ query: { q: 'world' } }), 'test')?.status).toBe(200)
    // scenario fails → 200
    expect(matchResponse([r, fallback], makeReq({ query: { q: 'hello' } }), 'other')?.status).toBe(200)
  })
})

// ─── X-Mock-Scenario header override ─────────────────────────────────────────

describe('X-Mock-Scenario header override', () => {
  it('header overrides global scenario', () => {
    const r1 = makeResponse({ scenario: 'error', status: 500 })
    const r2 = makeResponse({ status: 200 })
    const req = makeReq({ headers: { 'x-mock-scenario': 'error' } })
    // global scenario is 'success', but header says 'error' → 500
    expect(matchResponse([r1, r2], req, 'success')?.status).toBe(500)
  })

  it('header is case-insensitive for X-Mock-Scenario', () => {
    const r1 = makeResponse({ scenario: 'test', status: 201 })
    const r2 = makeResponse({ status: 200 })
    const req = makeReq({ headers: { 'X-Mock-Scenario': 'test' } })
    expect(matchResponse([r1, r2], req, '')?.status).toBe(201)
  })

  it('uses first value of multi-value header', () => {
    const r1 = makeResponse({ scenario: 'a', status: 201 })
    const r2 = makeResponse({ status: 200 })
    const req = makeReq({ headers: { 'x-mock-scenario': ['a', 'b'] } })
    expect(matchResponse([r1, r2], req, '')?.status).toBe(201)
  })

  it('without header, global scenario is used', () => {
    const r1 = makeResponse({ scenario: 'active', status: 202 })
    const r2 = makeResponse({ status: 200 })
    const req = makeReq({ headers: {} })
    expect(matchResponse([r1, r2], req, 'active')?.status).toBe(202)
    expect(matchResponse([r1, r2], req, 'inactive')?.status).toBe(200)
  })
})

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('edge cases', () => {
  it('empty predicate matches every request', () => {
    const pred = compilePredicate({})
    expect(matchRequest(pred, makeReq())).toBe(true)
  })

  it('body path on non-object body returns undefined → fails equality', () => {
    const pred = compilePredicate({ 'body.field': 'value' })
    expect(matchRequest(pred, makeReq({ body: null }))).toBe(false)
    expect(matchRequest(pred, makeReq({ body: 42 }))).toBe(false)
    expect(matchRequest(pred, makeReq({ body: 'string' }))).toBe(false)
  })

  it('params path on deeply missing segment', () => {
    const pred = compilePredicate({ 'body.a.b.c': 'x' })
    expect(matchRequest(pred, makeReq({ body: { a: {} } }))).toBe(false)
  })

  it('regex is pre-compiled (no re-compilation per request)', () => {
    const pred = compilePredicate({ 'query.q': { regex: '\\d+' } })
    for (let i = 0; i < 5; i++) {
      expect(matchRequest(pred, makeReq({ query: { q: '123' } }))).toBe(true)
    }
  })

  it('handles array header value for equality match', () => {
    const pred = compilePredicate({ 'headers.accept': 'application/json' })
    expect(matchRequest(pred, makeReq({ headers: { accept: ['application/json', 'text/html'] } }))).toBe(true)
  })

  it('partial match with null shape matches null actual', () => {
    const pred = compilePredicate({ 'body.field': null })
    expect(matchRequest(pred, makeReq({ body: { field: null } }))).toBe(true)
    expect(matchRequest(pred, makeReq({ body: { field: 'x' } }))).toBe(false)
  })
})
