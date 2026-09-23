import { describe, it, expect } from 'vitest'
import { renderBody, createSeededFaker } from '../template/index.js'
import type { TemplateContext, RenderOptions } from '../template/index.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ctx: TemplateContext = {
  params: { id: '42', name: 'alice' },
  query: { page: '1', search: 'hello' },
  headers: { 'x-user': 'bob', authorization: 'Bearer token' },
  body: { user: { age: 30 }, items: ['a', 'b', 'c'] },
  state: { count: 5 },
}

const opts: RenderOptions = { globalSeed: 42, routeId: 'GET:/users' }

function render(body: unknown, overrideCtx?: Partial<TemplateContext>): unknown {
  return renderBody(body, { ...ctx, ...overrideCtx }, opts)
}

// ─── Path lookups ─────────────────────────────────────────────────────────────

describe('path lookups', () => {
  it('params.*', () => {
    expect(render('{{ params.id }}')).toBe('42')
    expect(render('{{ params.name }}')).toBe('alice')
  })

  it('query.*', () => {
    expect(render('{{ query.page }}')).toBe('1')
    expect(render('{{ query.search }}')).toBe('hello')
  })

  it('headers.*', () => {
    expect(render('{{ headers.x-user }}')).toBe('bob')
  })

  it('body.*', () => {
    expect(render('{{ body.user.age }}')).toBe(30)
  })

  it('state.*', () => {
    expect(render('{{ state.count }}')).toBe(5)
  })

  it('returns undefined for missing path', () => {
    expect(render('{{ params.missing }}')).toBe('')   // inline → empty string
    expect(render({ v: '{{ params.missing }}' })).toEqual({ v: '' })
  })

  it('nested body path', () => {
    expect(render('{{ body.items }}')).toEqual(['a', 'b', 'c'])
  })
})

// ─── Type preservation ────────────────────────────────────────────────────────

describe('type preservation (whole-value template)', () => {
  it('returns native number from body path', () => {
    const result = render('{{ body.user.age }}')
    expect(typeof result).toBe('number')
    expect(result).toBe(30)
  })

  it('returns native array from body path', () => {
    const result = render('{{ body.items }}')
    expect(Array.isArray(result)).toBe(true)
  })

  it('returns native object from body path', () => {
    const result = render('{{ body.user }}')
    expect(typeof result).toBe('object')
    expect(result).toEqual({ age: 30 })
  })

  it('stringifies when template is mixed with literal text', () => {
    const result = render('user age is {{ body.user.age }} years')
    expect(typeof result).toBe('string')
    expect(result).toBe('user age is 30 years')
  })

  it('returns state number as native number', () => {
    const result = render('{{ state.count }}')
    expect(typeof result).toBe('number')
    expect(result).toBe(5)
  })
})

// ─── Recursive rendering ──────────────────────────────────────────────────────

describe('recursive rendering', () => {
  it('renders template inside object values', () => {
    const result = render({ userId: '{{ params.id }}', name: '{{ params.name }}' })
    expect(result).toEqual({ userId: '42', name: 'alice' })
  })

  it('renders templates inside arrays', () => {
    const result = render(['{{ params.id }}', '{{ params.name }}'])
    expect(result).toEqual(['42', 'alice'])
  })

  it('passes non-template values through unchanged', () => {
    const result = render({ flag: true, count: 10, label: 'static' })
    expect(result).toEqual({ flag: true, count: 10, label: 'static' })
  })

  it('renders nested objects recursively', () => {
    const result = render({ a: { b: '{{ params.id }}' } })
    expect(result).toEqual({ a: { b: '42' } })
  })
})

// ─── `now` helper ─────────────────────────────────────────────────────────────

describe('now', () => {
  it('returns a number (ms timestamp)', () => {
    const before = Date.now()
    const result = render('{{ now }}')
    const after = Date.now()
    expect(typeof result).toBe('number')
    expect(result as number).toBeGreaterThanOrEqual(before)
    expect(result as number).toBeLessThanOrEqual(after)
  })

  it('inlines as string in partial template', () => {
    const result = render('ts={{ now }}')
    expect(typeof result).toBe('string')
    expect(String(result)).toMatch(/^ts=\d+$/)
  })
})

// ─── `uuid` helper ────────────────────────────────────────────────────────────

describe('uuid', () => {
  it('returns a UUID string', () => {
    const result = render('{{ uuid }}')
    expect(typeof result).toBe('string')
    expect(String(result)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('produces a different UUID each call', () => {
    const a = render('{{ uuid }}')
    const b = render('{{ uuid }}')
    // Different because faker advances state between calls
    expect(a).not.toBe(b)
  })
})

// ─── `random` helper ──────────────────────────────────────────────────────────

describe('random', () => {
  it('returns a number within the specified range', () => {
    for (let i = 0; i < 20; i++) {
      const result = renderBody('{{ random 1 10 }}', ctx, {
        globalSeed: 42,
        routeId: `GET:/test/${i}`,
      }) as number
      expect(result).toBeGreaterThanOrEqual(1)
      expect(result).toBeLessThanOrEqual(10)
    }
  })

  it('returns an integer', () => {
    const result = render('{{ random 5 5 }}')
    expect(result).toBe(5)
  })

  it('defaults min/max to 0 and 1 when args missing', () => {
    const result = render('{{ random }}') as number
    expect(result).toBeGreaterThanOrEqual(0)
    expect(result).toBeLessThanOrEqual(1)
  })
})

// ─── `jwt` helper ─────────────────────────────────────────────────────────────

describe('jwt', () => {
  it('returns a three-part JWT string', () => {
    const result = render('{{ jwt sub=user123 exp=3600 }}')
    expect(typeof result).toBe('string')
    const parts = (result as string).split('.')
    expect(parts).toHaveLength(3)
  })

  it('encodes the provided sub claim', () => {
    const result = render('{{ jwt sub=alice exp=7200 }}') as string
    const payload = JSON.parse(Buffer.from(result.split('.')[1]!, 'base64url').toString())
    expect(payload.sub).toBe('alice')
  })

  it('encodes the expiry as iat + exp seconds', () => {
    const before = Math.floor(Date.now() / 1000)
    const result = render('{{ jwt sub=u exp=3600 }}') as string
    const payload = JSON.parse(Buffer.from(result.split('.')[1]!, 'base64url').toString())
    expect(payload.exp - payload.iat).toBe(3600)
    expect(payload.iat).toBeGreaterThanOrEqual(before)
  })

  it('generates a sub uuid when not provided', () => {
    const result = render('{{ jwt exp=600 }}') as string
    const payload = JSON.parse(Buffer.from(result.split('.')[1]!, 'base64url').toString())
    expect(payload.sub).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('header declares HS256 alg', () => {
    const result = render('{{ jwt sub=x }}') as string
    const header = JSON.parse(Buffer.from(result.split('.')[0]!, 'base64url').toString())
    expect(header.alg).toBe('HS256')
    expect(header.typ).toBe('JWT')
  })
})

// ─── `repeat` helper ─────────────────────────────────────────────────────────

describe('repeat', () => {
  it('returns an array of n empty objects', () => {
    const result = render('{{ repeat 3 }}')
    expect(Array.isArray(result)).toBe(true)
    expect((result as unknown[]).length).toBe(3)
    expect((result as unknown[])[0]).toEqual({})
  })

  it('returns an empty array for repeat 0', () => {
    const result = render('{{ repeat 0 }}')
    expect(result).toEqual([])
  })

  it('returns native array (type preserved)', () => {
    const result = render('{{ repeat 2 }}')
    expect(Array.isArray(result)).toBe(true)
  })
})

// ─── `pick` helper ────────────────────────────────────────────────────────────

describe('pick', () => {
  it('picks one element from inline list', () => {
    const choices = ['red', 'green', 'blue']
    for (let i = 0; i < 20; i++) {
      const result = renderBody('{{ pick red green blue }}', ctx, {
        globalSeed: 42,
        routeId: `GET:/test/${i}`,
      })
      expect(choices).toContain(result)
    }
  })

  it('picks from a path pointing to an array', () => {
    const result = render('{{ pick body.items }}')
    expect(['a', 'b', 'c']).toContain(result)
  })

  it('picks single item from single-item list', () => {
    const result = render('{{ pick only }}')
    expect(result).toBe('only')
  })

  it('returns undefined when path is empty array', () => {
    const result = renderBody('{{ pick body.empty }}', { ...ctx, body: { empty: [] } }, opts)
    expect(result).toBeUndefined()
  })
})

// ─── `upper` helper ───────────────────────────────────────────────────────────

describe('upper', () => {
  it('uppercases a path value', () => {
    expect(render('{{ upper params.name }}')).toBe('ALICE')
  })

  it('uppercases an inline literal', () => {
    // "hello" is treated as unknown expression returning literal
    const result = render('{{ upper hello }}')
    expect(result).toBe('HELLO')
  })

  it('works in a mixed string', () => {
    const result = render('Hello {{ upper params.name }}!')
    expect(result).toBe('Hello ALICE!')
  })
})

// ─── `default` helper ────────────────────────────────────────────────────────

describe('default', () => {
  it('returns path value when present', () => {
    expect(render('{{ default params.id unknown }}')).toBe('42')
  })

  it('returns fallback when path is missing', () => {
    expect(render('{{ default params.missing fallback }}')).toBe('fallback')
  })

  it('returns fallback when path resolves to empty string', () => {
    const result = renderBody(
      '{{ default params.empty none }}',
      { ...ctx, params: { empty: '' } },
      opts,
    )
    expect(result).toBe('none')
  })
})

// ─── `faker.*` helper ─────────────────────────────────────────────────────────

describe('faker.*', () => {
  it('faker.person.firstName returns a non-empty string', () => {
    const result = render('{{ faker.person.firstName }}')
    expect(typeof result).toBe('string')
    expect((result as string).length).toBeGreaterThan(0)
  })

  it('faker.internet.email returns an email-like string', () => {
    const result = render('{{ faker.internet.email }}')
    expect(String(result)).toContain('@')
  })

  it('faker.number.int 1 100 returns integer in range', () => {
    for (let i = 0; i < 10; i++) {
      const result = renderBody('{{ faker.number.int 1 100 }}', ctx, {
        globalSeed: 42,
        routeId: `route-${i}`,
      }) as number
      expect(result).toBeGreaterThanOrEqual(1)
      expect(result).toBeLessThanOrEqual(100)
      expect(Number.isInteger(result)).toBe(true)
    }
  })

  it('faker.string.uuid returns a UUID', () => {
    const result = render('{{ faker.string.uuid }}')
    expect(String(result)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    )
  })

  it('unknown faker method returns undefined', () => {
    const result = render('{{ faker.person.nonExistentMethod123 }}')
    expect(result).toBeUndefined()
  })

  it('faker.number.int returns native number type (preserved)', () => {
    const result = render('{{ faker.number.int 5 5 }}')
    expect(typeof result).toBe('number')
    expect(result).toBe(5)
  })
})

// ─── Faker seeding ────────────────────────────────────────────────────────────

describe('faker seeding', () => {
  it('same seed + route + params produces same output', () => {
    const a = renderBody('{{ faker.person.firstName }}', ctx, opts)
    const b = renderBody('{{ faker.person.firstName }}', ctx, opts)
    expect(a).toBe(b)
  })

  it('different params produce different output', () => {
    const ctxA = { ...ctx, params: { id: '1' } }
    const ctxB = { ...ctx, params: { id: '2' } }
    const a = renderBody('{{ faker.person.firstName }}', ctxA, opts)
    const b = renderBody('{{ faker.person.firstName }}', ctxB, opts)
    // Extremely likely to differ with different seeds
    // (could theoretically collide but probability is negligible)
    expect(a).not.toBe(b)
  })

  it('different routeId produces different output', () => {
    const optsA = { ...opts, routeId: 'GET:/users' }
    const optsB = { ...opts, routeId: 'GET:/products' }
    const a = renderBody('{{ faker.person.firstName }}', ctx, optsA)
    const b = renderBody('{{ faker.person.firstName }}', ctx, optsB)
    expect(a).not.toBe(b)
  })

  it('createSeededFaker produces same faker for same inputs', () => {
    const f1 = createSeededFaker(42, 'route', { id: '1' })
    const f2 = createSeededFaker(42, 'route', { id: '1' })
    expect(f1.person.firstName()).toBe(f2.person.firstName())
  })

  it('object body renders all faker fields deterministically', () => {
    const body = {
      name: '{{ faker.person.firstName }}',
      email: '{{ faker.internet.email }}',
    }
    const a = renderBody(body, ctx, opts) as Record<string, unknown>
    const b = renderBody(body, ctx, opts) as Record<string, unknown>
    expect(a['name']).toBe(b['name'])
    expect(a['email']).toBe(b['email'])
  })
})

// ─── Multiple expressions in one string ──────────────────────────────────────

describe('multiple expressions', () => {
  it('replaces multiple {{ }} in one string', () => {
    const result = render('{{ params.id }}/{{ params.name }}')
    expect(result).toBe('42/alice')
  })

  it('handles three expressions', () => {
    const result = render('{{ params.id }}-{{ params.name }}-{{ query.page }}')
    expect(result).toBe('42-alice-1')
  })
})

// ─── No-template pass-through ─────────────────────────────────────────────────

describe('no-template pass-through', () => {
  it('returns string without {{ }} unchanged', () => {
    expect(render('hello world')).toBe('hello world')
  })

  it('returns number unchanged', () => {
    expect(render(42)).toBe(42)
  })

  it('returns boolean unchanged', () => {
    expect(render(true)).toBe(true)
    expect(render(false)).toBe(false)
  })

  it('returns null unchanged', () => {
    expect(render(null)).toBeNull()
  })
})
