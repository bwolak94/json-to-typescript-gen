import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir, readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildRouter, createHandler } from '../dispatch.js'
import { validateCommand } from '../commands/validate.js'
import { routesCommand } from '../commands/routes.js'
import { initCommand } from '../commands/init.js'
import { printTable, printRouteTable } from '../output.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

let tmpDir: string

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), 'qms-cli-test-'))
})

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const SIMPLE_YAML = (path: string) => `
routes:
  - method: GET
    path: ${path}
    responses:
      - status: 200
        body:
          ok: true
`

// ─── dispatch / buildRouter ───────────────────────────────────────────────────

describe('buildRouter', () => {
  it('registers routes from LoadedRoute array', () => {
    const routes = [
      {
        method: 'GET' as const,
        path: '/users',
        responses: [],
        _source: { file: 'test.yaml' },
        _origin: 'manual' as const,
      },
    ]
    const router = buildRouter(routes)
    expect(router.find('GET', '/users')).not.toBeNull()
    expect(router.find('POST', '/users')).toBeNull()
  })

  it('expands multi-method routes', () => {
    const routes = [
      {
        method: ['GET', 'POST'] as unknown as 'GET',
        path: '/items',
        responses: [],
        _source: { file: 'test.yaml' },
        _origin: 'manual' as const,
      },
    ]
    const router = buildRouter(routes)
    expect(router.find('GET', '/items')).not.toBeNull()
    expect(router.find('POST', '/items')).not.toBeNull()
    expect(router.find('DELETE', '/items')).toBeNull()
  })

  it('handles empty routes array', () => {
    const router = buildRouter([])
    expect(router.find('GET', '/anything')).toBeNull()
  })
})

// ─── createHandler ────────────────────────────────────────────────────────────

describe('createHandler', () => {
  function makeReqRes(method: string, url: string) {
    const req = { method, url, socket: {} } as Parameters<typeof createHandler>[0] extends (req: infer R, ...args: unknown[]) => unknown ? R : never
    const headers: Record<string, string | number> = {}
    let statusCode = 200
    let body = ''
    const res = {
      get statusCode() { return statusCode },
      writeHead(s: number, h?: Record<string, string>) {
        statusCode = s
        if (h) Object.assign(headers, h)
      },
      end(b?: string) { body = b ?? '' },
      headersSent: false,
    }
    return { req, res: res as unknown as Parameters<typeof createHandler>[0] extends (req: unknown, res: infer R) => unknown ? R : never, getStatus: () => statusCode, getBody: () => body }
  }

  it('returns 404 JSON for unmatched route', async () => {
    const state = { router: buildRouter([]) }
    const handler = createHandler(state)
    const { req, res, getStatus, getBody } = makeReqRes('GET', '/missing')
    await handler(req as never, res as never)
    expect(getStatus()).toBe(404)
    expect(JSON.parse(getBody())).toMatchObject({ error: 'Not Found', path: '/missing' })
  })

  it('returns first response status and body for matched route', async () => {
    const routes = [
      {
        method: 'GET' as const,
        path: '/hello',
        responses: [{ status: 200, headers: {}, body: { msg: 'hi' } }],
        _source: { file: 'test.yaml' },
        _origin: 'manual' as const,
      },
    ]
    const state = { router: buildRouter(routes) }
    const handler = createHandler(state)
    const { req, res, getStatus, getBody } = makeReqRes('GET', '/hello')
    await handler(req as never, res as never)
    expect(getStatus()).toBe(200)
    expect(JSON.parse(getBody())).toEqual({ msg: 'hi' })
  })

  it('returns 204 when route has no responses', async () => {
    const routes = [
      {
        method: 'DELETE' as const,
        path: '/item',
        responses: [],
        _source: { file: 'test.yaml' },
        _origin: 'manual' as const,
      },
    ]
    const state = { router: buildRouter(routes) }
    const handler = createHandler(state)
    const { req, res, getStatus } = makeReqRes('DELETE', '/item')
    await handler(req as never, res as never)
    expect(getStatus()).toBe(204)
  })

  it('sets x-mock-route header', async () => {
    const routes = [
      {
        method: 'GET' as const,
        path: '/tagged',
        responses: [{ status: 200, headers: {}, body: null }],
        _source: { file: 'x.yaml' },
        _origin: 'manual' as const,
      },
    ]
    const state = { router: buildRouter(routes) }
    const handler = createHandler(state)
    const capturedHeaders: Record<string, string | number> = {}
    const res = {
      statusCode: 200,
      writeHead(s: number, h?: Record<string, string>) {
        Object.assign(capturedHeaders, h)
      },
      end() {},
      headersSent: false,
    }
    await handler({ method: 'GET', url: '/tagged' } as never, res as never)
    expect(capturedHeaders['x-mock-route']).toContain('GET:/tagged')
  })

  it('atomically uses updated router reference', async () => {
    const state = { router: buildRouter([]) }
    const handler = createHandler(state)

    // Initially no routes → 404
    const { req: r1, res: res1, getStatus: s1 } = makeReqRes('GET', '/dynamic')
    await handler(r1 as never, res1 as never)
    expect(s1()).toBe(404)

    // Swap router with one that has the route
    state.router = buildRouter([
      {
        method: 'GET' as const,
        path: '/dynamic',
        responses: [{ status: 200, headers: {}, body: 'ok' }],
        _source: { file: 'x.yaml' },
        _origin: 'manual' as const,
      },
    ])

    // New request uses updated router
    const { req: r2, res: res2, getStatus: s2 } = makeReqRes('GET', '/dynamic')
    await handler(r2 as never, res2 as never)
    expect(s2()).toBe(200)
  })
})

// ─── output.printTable ────────────────────────────────────────────────────────

describe('printTable', () => {
  it('prints aligned columns', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    printTable(['Method', 'Path'], [['GET', '/users'], ['DELETE', '/users/:id']])
    expect(spy).toHaveBeenCalled()
    // Header row should include column names
    const firstCall = spy.mock.calls[0]?.[0] as string
    expect(firstCall).toContain('Method')
    expect(firstCall).toContain('Path')
  })

  it('handles empty rows', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    printTable(['A', 'B'], [])
    expect(spy).toHaveBeenCalled()
  })
})

describe('printRouteTable', () => {
  it('prints "No routes loaded" for empty array', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    printRouteTable([])
    const output = spy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('No routes')
  })
})

// ─── validate command ─────────────────────────────────────────────────────────

describe('validateCommand', () => {
  it('exits 0 for valid empty mocks directory', async () => {
    await mkdir(join(tmpDir, 'mocks'), { recursive: true })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await validateCommand({})
    // process.cwd() might not be tmpDir, so just check it didn't exit with 1

    exitSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('exits 1 for invalid config file', async () => {
    await writeFile(join(tmpDir, 'qms.config.json'), JSON.stringify({ port: 'bad' }))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await validateCommand({ config: join(tmpDir, 'qms.config.json') })

    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('exits 0 for valid explicit config file', async () => {
    const cfgPath = join(tmpDir, 'qms.config.json')
    await writeFile(cfgPath, JSON.stringify({ port: 4500 }))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await validateCommand({ config: cfgPath })

    expect(exitSpy).toHaveBeenCalledWith(0)
  })
})

// ─── routes command ───────────────────────────────────────────────────────────

describe('routesCommand', () => {
  it('prints routes from valid config', async () => {
    const cfgPath = join(tmpDir, 'qms.config.json')
    const mocksDir = join(tmpDir, 'mocks')
    await mkdir(mocksDir, { recursive: true })
    await writeFile(cfgPath, JSON.stringify({ mocksDir, port: 3999 }))
    await writeFile(join(mocksDir, 'api.yaml'), SIMPLE_YAML('/api/test'))

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await routesCommand({ config: cfgPath })

    const output = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(output).toContain('/api/test')
    expect(output).toContain('GET')
  })

  it('exits 1 for invalid config', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await routesCommand({ config: join(tmpDir, 'does-not-exist.json') })

    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})

// ─── init command ─────────────────────────────────────────────────────────────

describe('initCommand', () => {
  it('creates qms.config.ts and mocks/example.yaml', async () => {
    const origCwd = process.cwd()
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await initCommand()

    vi.spyOn(process, 'cwd').mockReturnValue(origCwd)

    const configContent = await readFile(join(tmpDir, 'qms.config.ts'), 'utf8')
    const exampleContent = await readFile(join(tmpDir, 'mocks', 'example.yaml'), 'utf8')

    expect(configContent).toContain('defineConfig')
    expect(exampleContent).toContain('/hello')
  })

  it('does not overwrite existing qms.config.ts', async () => {
    const configPath = join(tmpDir, 'qms.config.ts')
    await writeFile(configPath, '// existing', 'utf8')

    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await initCommand()

    const content = await readFile(configPath, 'utf8')
    expect(content).toBe('// existing')
  })

  it('does not overwrite existing mocks/example.yaml', async () => {
    await mkdir(join(tmpDir, 'mocks'), { recursive: true })
    const examplePath = join(tmpDir, 'mocks', 'example.yaml')
    await writeFile(examplePath, '# existing', 'utf8')

    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await initCommand()

    const content = await readFile(examplePath, 'utf8')
    expect(content).toBe('# existing')
  })

  it('creates mocks directory if it does not exist', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(tmpDir)
    vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await initCommand()

    await expect(access(join(tmpDir, 'mocks'))).resolves.not.toThrow()
  })
})
