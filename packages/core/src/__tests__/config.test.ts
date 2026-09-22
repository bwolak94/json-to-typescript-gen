import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

import {
  defineConfig,
  defineRoutes,
  loadConfig,
  ConfigError,
} from '../config/index.js'
import { loadMockFile, findMockFiles } from '../config/loader.js'
import { mergeRoutes, generateRouteId } from '../config/merger.js'
import { didYouMean } from '../config/errors.js'
import {
  QmsConfigSchema,
  MockFileSchema,
  RawRouteSchema,
} from '../config/schema.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string

beforeAll(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'qms-test-'))
})

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true })
})

async function writeFixture(name: string, content: string): Promise<string> {
  const filePath = join(tmpDir, name)
  await mkdir(join(tmpDir, name.split('/').slice(0, -1).join('/')), { recursive: true })
  await writeFile(filePath, content, 'utf8')
  return filePath
}

// ─── didYouMean ───────────────────────────────────────────────────────────────

describe('didYouMean', () => {
  it('returns exact match', () => {
    expect(didYouMean('port', ['port', 'host'])).toBe('port')
  })

  it('returns close match (1 edit)', () => {
    expect(didYouMean('prot', ['port', 'host', 'seed'])).toBe('port')
  })

  it('returns null when nothing close enough', () => {
    expect(didYouMean('zzzzz', ['port', 'host'])).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(didYouMean('PORT', ['port', 'host'])).toBe('port')
  })
})

// ─── QmsConfigSchema ──────────────────────────────────────────────────────────

describe('QmsConfigSchema', () => {
  it('parses empty object with defaults', () => {
    const cfg = QmsConfigSchema.parse({})
    expect(cfg.port).toBe(3999)
    expect(cfg.host).toBe('0.0.0.0')
    expect(cfg.mocksDir).toBe('./mocks')
    expect(cfg.seed).toBe(42)
    expect(cfg.admin.enabled).toBe(true)
    expect(cfg.admin.path).toBe('/__admin')
  })

  it('accepts valid full config', () => {
    const cfg = QmsConfigSchema.parse({
      port: 4000,
      host: 'localhost',
      mocksDir: './fixtures',
      cors: true,
      seed: 100,
    })
    expect(cfg.port).toBe(4000)
    expect(cfg.mocksDir).toBe('./fixtures')
  })

  it('rejects unknown keys', () => {
    const result = QmsConfigSchema.safeParse({ unknownField: true })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues[0]
      expect(issue?.code).toBe('unrecognized_keys')
    }
  })

  it('rejects port out of range', () => {
    expect(QmsConfigSchema.safeParse({ port: 99999 }).success).toBe(false)
    expect(QmsConfigSchema.safeParse({ port: -1 }).success).toBe(false)
  })

  it('accepts proxy config', () => {
    const cfg = QmsConfigSchema.parse({
      proxy: { target: 'https://api.example.com' },
    })
    expect(cfg.proxy?.target).toBe('https://api.example.com')
    expect(cfg.proxy?.mode).toBe('passthrough')
  })

  it('rejects invalid proxy target URL', () => {
    expect(QmsConfigSchema.safeParse({ proxy: { target: 'not-a-url' } }).success).toBe(false)
  })
})

// ─── RawRouteSchema ───────────────────────────────────────────────────────────

describe('RawRouteSchema', () => {
  it('defaults method to GET', () => {
    const r = RawRouteSchema.parse({ path: '/users' })
    expect(r.method).toBe('GET')
  })

  it('accepts array of methods', () => {
    const r = RawRouteSchema.parse({ method: ['GET', 'POST'], path: '/x' })
    expect(r.method).toEqual(['GET', 'POST'])
  })

  it('defaults status to 200 in responses', () => {
    const r = RawRouteSchema.parse({ path: '/x', responses: [{ body: 'ok' }] })
    expect(r.responses[0]?.status).toBe(200)
  })

  it('rejects status out of range', () => {
    const result = RawRouteSchema.safeParse({ path: '/x', responses: [{ status: 99 }] })
    expect(result.success).toBe(false)
  })

  it('requires path to start with /', () => {
    expect(RawRouteSchema.safeParse({ path: 'noslash' }).success).toBe(false)
  })

  it('accepts invalid_enum_value for method and reports it', () => {
    const result = RawRouteSchema.safeParse({ path: '/x', method: 'get' })
    // 'get' is not in enum (only 'GET'), should fail
    expect(result.success).toBe(false)
  })
})

// ─── MockFileSchema ───────────────────────────────────────────────────────────

describe('MockFileSchema', () => {
  it('parses empty object', () => {
    const r = MockFileSchema.parse({})
    expect(r.routes).toEqual([])
    expect(r.resources).toEqual([])
  })

  it('parses routes and resources', () => {
    const r = MockFileSchema.parse({
      routes: [{ path: '/users', method: 'GET' }],
      resources: [{ name: 'products', path: '/products' }],
    })
    expect(r.routes).toHaveLength(1)
    expect(r.resources).toHaveLength(1)
    expect(r.resources[0]?.idField).toBe('id')
  })
})

// ─── defineConfig / defineRoutes ─────────────────────────────────────────────

describe('defineConfig', () => {
  it('returns the config object unchanged', () => {
    const cfg = defineConfig({ port: 4000 })
    expect(cfg).toEqual({ port: 4000 })
  })
})

describe('defineRoutes', () => {
  it('returns the routes array unchanged', () => {
    const routes = defineRoutes([{ method: 'GET', path: '/test', responses: [] }])
    expect(routes).toHaveLength(1)
    expect(routes[0]?.path).toBe('/test')
  })
})

// ─── loadMockFile — YAML ──────────────────────────────────────────────────────

describe('loadMockFile — YAML', () => {
  it('loads a valid YAML mock file', async () => {
    const f = await writeFixture('users.yaml', `
routes:
  - method: GET
    path: /users
    responses:
      - status: 200
        body:
          - id: 1
            name: Alice
`)
    const result = await loadMockFile(f)
    expect(result.routes).toHaveLength(1)
    expect(result.routes[0]?.method).toBe('GET')
    expect(result.routes[0]?.path).toBe('/users')
  })

  it('loads routes + resources from YAML', async () => {
    const f = await writeFixture('full.yaml', `
routes:
  - method: POST
    path: /orders
    responses:
      - status: 201

resources:
  - name: products
    path: /products
`)
    const result = await loadMockFile(f)
    expect(result.routes).toHaveLength(1)
    expect(result.resources).toHaveLength(1)
  })

  it('throws ConfigError on invalid YAML syntax', async () => {
    const f = await writeFixture('bad.yaml', `routes: [unclosed`)
    await expect(loadMockFile(f)).rejects.toBeInstanceOf(ConfigError)
  })

  it('throws ConfigError on schema-invalid YAML', async () => {
    const f = await writeFixture('bad-schema.yaml', `
routes:
  - method: GET
    path: no-slash
`)
    await expect(loadMockFile(f)).rejects.toBeInstanceOf(ConfigError)
  })

  it('loads .yml extension', async () => {
    const f = await writeFixture('test.yml', `routes:\n  - path: /x`)
    const result = await loadMockFile(f)
    expect(result.routes[0]?.path).toBe('/x')
  })
})

// ─── loadMockFile — JSON ──────────────────────────────────────────────────────

describe('loadMockFile — JSON', () => {
  it('loads a valid JSON mock file', async () => {
    const f = await writeFixture('posts.json', JSON.stringify({
      routes: [{ method: 'GET', path: '/posts', responses: [{ status: 200 }] }],
    }))
    const result = await loadMockFile(f)
    expect(result.routes[0]?.path).toBe('/posts')
  })

  it('throws ConfigError on invalid JSON', async () => {
    const f = await writeFixture('bad.json', '{bad json}')
    await expect(loadMockFile(f)).rejects.toBeInstanceOf(ConfigError)
  })
})

// ─── loadMockFile — TS (via jiti) ─────────────────────────────────────────────

describe('loadMockFile — TS (via jiti)', () => {
  it('loads a TS file that exports default array (defineRoutes style)', async () => {
    const f = await writeFixture('cart.ts', `
export default [
  { method: 'POST', path: '/cart', responses: [{ status: 201 }] }
]
`)
    const result = await loadMockFile(f)
    expect(result.routes).toHaveLength(1)
    expect(result.routes[0]?.path).toBe('/cart')
  })

  it('loads a TS file with routes object', async () => {
    const f = await writeFixture('items.ts', `
export default {
  routes: [{ method: 'GET', path: '/items', responses: [] }]
}
`)
    const result = await loadMockFile(f)
    expect(result.routes[0]?.path).toBe('/items')
  })
})

// ─── findMockFiles ────────────────────────────────────────────────────────────

describe('findMockFiles', () => {
  it('finds yaml, yml, json, ts files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qms-glob-'))
    try {
      await writeFile(join(dir, 'a.yaml'), 'routes: []')
      await writeFile(join(dir, 'b.json'), '{}')
      await writeFile(join(dir, 'c.ts'), 'export default []')

      const files = await findMockFiles(dir)
      const names = files.map((f) => f.split('/').pop())
      expect(names).toContain('a.yaml')
      expect(names).toContain('b.json')
      expect(names).toContain('c.ts')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns empty array for empty directory', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qms-empty-'))
    try {
      const files = await findMockFiles(dir)
      expect(files).toHaveLength(0)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('returns sorted results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qms-sort-'))
    try {
      await writeFile(join(dir, 'z.yaml'), 'routes: []')
      await writeFile(join(dir, 'a.yaml'), 'routes: []')
      const files = await findMockFiles(dir)
      const names = files.map((f) => f.split('/').pop())
      expect(names.indexOf('a.yaml')).toBeLessThan(names.indexOf('z.yaml'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ─── mergeRoutes ─────────────────────────────────────────────────────────────

const makeRoute = (
  method: string,
  path: string,
  file: string,
  origin: 'manual' | 'openapi' = 'manual',
) => ({
  method: method as 'GET',
  path,
  responses: [] as [],
  _source: { file },
  _origin: origin,
})

describe('mergeRoutes', () => {
  it('merges non-conflicting routes', () => {
    const r = mergeRoutes([
      { routes: [makeRoute('GET', '/a', 'a.yaml'), makeRoute('GET', '/b', 'b.yaml')], resources: [], file: 'x' },
    ])
    expect(r.routes).toHaveLength(2)
    expect(r.collisions).toHaveLength(0)
  })

  it('detects collision and emits warning', () => {
    const r = mergeRoutes([
      {
        routes: [
          makeRoute('GET', '/users', 'a.yaml'),
          makeRoute('GET', '/users', 'b.yaml'),
        ],
        resources: [],
        file: 'x',
      },
    ])
    expect(r.routes).toHaveLength(1) // only one kept
    expect(r.collisions).toHaveLength(1)
    expect(r.warnings[0]).toContain('collision')
  })

  it('manual route wins over openapi on collision', () => {
    const manual = makeRoute('GET', '/users', 'manual.yaml', 'manual')
    const openapi = makeRoute('GET', '/users', 'openapi.yaml', 'openapi')

    // openapi first, then manual overrides
    const r = mergeRoutes([
      { routes: [openapi, manual], resources: [], file: 'x' },
    ])
    expect(r.routes[0]?._origin).toBe('manual')
    expect(r.routes[0]?._source.file).toBe('manual.yaml')
  })

  it('among manual files, first declaration wins', () => {
    const first = makeRoute('GET', '/x', 'first.yaml', 'manual')
    const second = makeRoute('GET', '/x', 'second.yaml', 'manual')
    const r = mergeRoutes([{ routes: [first, second], resources: [], file: 'x' }])
    expect(r.routes[0]?._source.file).toBe('first.yaml')
    expect(r.warnings[0]).toContain('first declaration wins')
  })

  it('includes warning with both file paths', () => {
    const r = mergeRoutes([
      {
        routes: [
          makeRoute('POST', '/login', 'file1.yaml'),
          makeRoute('POST', '/login', 'file2.yaml'),
        ],
        resources: [],
        file: 'x',
      },
    ])
    expect(r.warnings[0]).toContain('file1.yaml')
    expect(r.warnings[0]).toContain('file2.yaml')
  })

  it('handles multi-method routes', () => {
    const r = mergeRoutes([
      {
        routes: [
          { ...makeRoute('GET', '/x', 'a.yaml'), method: ['GET', 'POST'] as unknown as 'GET' },
        ],
        resources: [],
        file: 'x',
      },
    ])
    expect(r.routes).toHaveLength(1)
  })
})

// ─── generateRouteId ─────────────────────────────────────────────────────────

describe('generateRouteId', () => {
  it('generates a non-empty string', () => {
    const id = generateRouteId('GET', '/users/:id', 'mocks/users.yaml')
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('is deterministic for the same inputs', () => {
    const a = generateRouteId('GET', '/users', 'mocks/a.yaml')
    const b = generateRouteId('GET', '/users', 'mocks/a.yaml')
    expect(a).toBe(b)
  })

  it('differs for different paths', () => {
    const a = generateRouteId('GET', '/users', 'mocks/a.yaml')
    const b = generateRouteId('GET', '/orders', 'mocks/a.yaml')
    expect(a).not.toBe(b)
  })

  it('differs for different source files', () => {
    const a = generateRouteId('GET', '/users', 'mocks/a.yaml')
    const b = generateRouteId('GET', '/users', 'mocks/b.yaml')
    expect(a).not.toBe(b)
  })
})

// ─── loadConfig (integration) ─────────────────────────────────────────────────

describe('loadConfig', () => {
  it('returns defaults when no config file exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qms-cfg-'))
    try {
      const result = await loadConfig({ cwd: dir })
      expect(result.config.port).toBe(3999)
      expect(result.config.seed).toBe(42)
      expect(result.routes).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('loads routes from mocksDir', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qms-cfg2-'))
    try {
      await mkdir(join(dir, 'mocks'), { recursive: true })
      await writeFile(join(dir, 'mocks', 'users.yaml'), `
routes:
  - method: GET
    path: /users
    responses:
      - status: 200
`)
      const result = await loadConfig({ cwd: dir })
      expect(result.routes).toHaveLength(1)
      expect(result.routes[0]?.path).toBe('/users')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('respects custom mocksDir from config file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qms-cfg3-'))
    try {
      await mkdir(join(dir, 'api-mocks'), { recursive: true })
      await writeFile(join(dir, 'qms.config.json'), JSON.stringify({ mocksDir: './api-mocks' }))
      await writeFile(join(dir, 'api-mocks', 'health.json'), JSON.stringify({
        routes: [{ method: 'GET', path: '/health', responses: [{ status: 200 }] }],
      }))
      const result = await loadConfig({ cwd: dir })
      expect(result.config.mocksDir).toBe('./api-mocks')
      expect(result.routes[0]?.path).toBe('/health')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('emits warnings for route collisions across files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qms-col-'))
    try {
      await mkdir(join(dir, 'mocks'), { recursive: true })
      await writeFile(join(dir, 'mocks', 'a.yaml'), `
routes:
  - method: GET
    path: /users
`)
      await writeFile(join(dir, 'mocks', 'b.yaml'), `
routes:
  - method: GET
    path: /users
`)
      const result = await loadConfig({ cwd: dir })
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings[0]).toContain('/users')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('collects resources from mock files', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'qms-res-'))
    try {
      await mkdir(join(dir, 'mocks'), { recursive: true })
      await writeFile(join(dir, 'mocks', 'store.yaml'), `
resources:
  - name: products
    path: /products
`)
      const result = await loadConfig({ cwd: dir })
      expect(result.resources).toHaveLength(1)
      expect(result.resources[0]?.name).toBe('products')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
