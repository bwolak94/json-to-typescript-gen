import http from 'node:http'
import { URL } from 'node:url'
import { StateStore } from '../state/store.js'
import { Journal } from '../journal/index.js'
import { Router } from '../router/router.js'
import { matchResponse } from '../matcher/matcher.js'
import { runChaosPre, wrapSlowBody } from '../chaos/middleware.js'
import { resolveChaos } from '../chaos/index.js'
import { createAdminHandler } from '../admin/index.js'
import { isAdminPath } from '../admin/index.js'
import type { CompiledRoute, CompiledResponse, HttpMethod, MockRequest } from '../types.js'
import type { ChaosConfig } from '../chaos/index.js'
import type { AdminConfig } from '../admin/index.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface MockServerOptions {
  /** Port to listen on. Use `0` for OS-assigned (default). */
  port?: number
  /** Bind host. Defaults to `'127.0.0.1'`. */
  host?: string
  /** Default scenario name. */
  defaultScenario?: string
  /** Global chaos config applied to every request. */
  chaos?: ChaosConfig
  /** Admin API config. Defaults to enabled at `/__admin`. */
  admin?: Partial<AdminConfig>
}

export interface MockServerStartResult {
  url: string
  port: number
}

/** Minimal route spec for `server.use()`. */
export interface UseRouteSpec {
  method?: HttpMethod | string
  path: string
  status?: number
  headers?: Record<string, string>
  body?: unknown
  responses?: Partial<CompiledResponse>[]
  scenarios?: string[]
}

export interface MockServer {
  /** Start the HTTP server. Returns the bound URL and port. */
  start(): Promise<MockServerStartResult>
  /** Gracefully stop the server. */
  stop(): Promise<void>
  /** Add a runtime route override (highest priority). */
  use(route: UseRouteSpec): void
  /** Set the globally active scenario. */
  scenario(name: string): void
  /** Access the shared state store. */
  readonly state: StateStore
  /** Access the request journal. */
  readonly journal: Journal
  /** Base URL — available after `start()`. */
  readonly url: string
}

// ─── createMockServer ─────────────────────────────────────────────────────────

export function createMockServer(options: MockServerOptions = {}): MockServer {
  const {
    port: bindPort = 0,
    host = '127.0.0.1',
    defaultScenario = '',
    chaos: initialChaos = {},
    admin: adminOpts = {},
  } = options

  // Shared state
  const store = new StateStore(defaultScenario)
  const journal = new Journal()
  const runtimeRoutes: CompiledRoute[] = []
  let chaosConfig: ChaosConfig = { ...initialChaos }
  let baseUrl = ''
  let startedAt: Date | undefined

  const adminConfig: AdminConfig = {
    enabled: adminOpts.enabled !== false,
    path: adminOpts.path ?? '/__admin',
  }
  if (adminOpts.token !== undefined) adminConfig.token = adminOpts.token

  // Rebuild router whenever routes change.
  // runtimeRoutes is newest-first (prepended); deduplicate by method+path so the
  // most recently added route wins — the trie overwrites on duplicate inserts,
  // so we only add the first (newest) occurrence of each method+path pair.
  function buildRouter(): Router<CompiledRoute> {
    const router = new Router<CompiledRoute>()
    const seen = new Set<string>()
    for (const route of runtimeRoutes) {
      const key = `${route.method.toUpperCase()}:${route.path}`
      if (!seen.has(key)) {
        seen.add(key)
        router.add(route)
      }
    }
    return router
  }

  let router = buildRouter()

  const adminHandler = createAdminHandler({
    getRoutes: () => [...runtimeRoutes],
    state: store,
    getChaos: () => chaosConfig,
    setChaos: (cfg) => { chaosConfig = cfg },
    addRuntimeRoute: (r) => {
      runtimeRoutes.unshift(r) // highest priority
      router = buildRouter()
    },
    config: adminConfig,
    journal,
    get startedAt() { return startedAt },
  })

  // ── Request handler ────────────────────────────────────────────────────────

  const requestHandler = async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const rawUrl = req.url ?? '/'
    const parsedUrl = new URL(rawUrl, 'http://localhost')
    const urlPath = parsedUrl.pathname
    const method = (req.method ?? 'GET').toUpperCase()

    // Admin routes bypass chaos + journal
    if (adminConfig.enabled && isAdminPath(urlPath, adminConfig.path)) {
      await adminHandler(req, res)
      return
    }

    // Parse query
    const query: Record<string, string | string[]> = {}
    for (const [k, v] of parsedUrl.searchParams) {
      const existing = query[k]
      if (existing === undefined) {
        query[k] = v
      } else if (Array.isArray(existing)) {
        existing.push(v)
      } else {
        query[k] = [existing, v]
      }
    }

    // Parse headers
    const headers: Record<string, string | string[]> = {}
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined) headers[k] = v
    }

    // Parse body
    const body = await readBody(req)

    const mockReq: MockRequest = {
      method,
      path: urlPath,
      params: {},
      query,
      headers,
      body,
    }

    const t0 = Date.now()

    // Apply chaos pre
    const resolved = resolveChaos(chaosConfig)
    const outcome = await runChaosPre(resolved, req, res)
    if (outcome !== 'continue') {
      journal.record({
        timestamp: t0,
        request: { method, path: urlPath, headers, body },
        duration: Date.now() - t0,
        scenario: store.scenarios.active,
      })
      return
    }

    // Match route
    const found = router.find(method, urlPath)
    if (!found) {
      journal.record({
        timestamp: t0,
        request: { method, path: urlPath, headers, body },
        response: { status: 404, headers: {} },
        duration: Date.now() - t0,
        scenario: store.scenarios.active,
      })
      const errBody = JSON.stringify({ error: 'Not found', method, path: urlPath })
      res.writeHead(404, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(errBody),
      })
      res.end(errBody)
      return
    }

    const { route, params } = found
    mockReq.params = params

    const response = matchResponse(
      route.responses,
      mockReq,
      store.scenarios.active,
      route.scenarios,
    )

    if (!response) {
      journal.record({
        timestamp: t0,
        request: { method, path: urlPath, headers, body },
        routeId: route.id,
        response: { status: 404, headers: {} },
        duration: Date.now() - t0,
        scenario: store.scenarios.active,
      })
      const errBody = JSON.stringify({ error: 'No matching response', method, path: urlPath })
      res.writeHead(404, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(errBody),
      })
      res.end(errBody)
      return
    }

    // Resolve body
    const resolvedBody = await resolveBody(response.body)
    const isJson = resolvedBody !== null && typeof resolvedBody === 'object'
    const bodyStr = resolvedBody === undefined || resolvedBody === null
      ? ''
      : typeof resolvedBody === 'string'
        ? resolvedBody
        : JSON.stringify(resolvedBody)

    const responseHeaders: Record<string, string> = {
      ...(isJson ? { 'Content-Type': 'application/json' } : {}),
      'Content-Length': String(Buffer.byteLength(bodyStr)),
      'X-Mock-Route': route.id,
      ...response.headers,
    }

    // Wrap slow body if configured
    if (resolved.slowBody) {
      wrapSlowBody(res, resolved.slowBody)
    }

    journal.record({
      timestamp: t0,
      request: { method, path: urlPath, headers, body },
      routeId: route.id,
      response: { status: response.status, headers: responseHeaders },
      duration: Date.now() - t0,
      scenario: store.scenarios.active,
    })

    res.writeHead(response.status, responseHeaders)
    if (method !== 'HEAD') res.end(bodyStr)
    else res.end()
  }

  // ── HTTP server ────────────────────────────────────────────────────────────

  let server: http.Server | undefined

  // ── Public API ─────────────────────────────────────────────────────────────

  return {
    get state() { return store },
    get journal() { return journal },
    get url() { return baseUrl },

    async start(): Promise<MockServerStartResult> {
      startedAt = new Date()
      server = http.createServer((req, res) => {
        requestHandler(req, res).catch((err: unknown) => {
          if (!res.headersSent) {
            res.writeHead(500)
            res.end('Internal Server Error')
          }
          console.error('[qms] request handler error:', err)
        })
      })

      await new Promise<void>((resolve) => {
        server!.listen(bindPort, host, resolve)
      })

      const addr = server.address() as import('node:net').AddressInfo
      const displayHost = host === '0.0.0.0' ? 'localhost' : host
      baseUrl = `http://${displayHost}:${addr.port}`

      return { url: baseUrl, port: addr.port }
    },

    async stop(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        if (!server) { resolve(); return }
        server.close((err) => err ? reject(err) : resolve())
      })
      server = undefined
      baseUrl = ''
    },

    use(spec: UseRouteSpec): void {
      const method = ((spec.method ?? 'GET') as string).toUpperCase() as HttpMethod
      const id = `runtime:${method}:${spec.path}:${Date.now()}`

      const responses: CompiledResponse[] = spec.responses
        ? spec.responses.map((r) => {
            const cr: CompiledResponse = {
              status: r.status ?? 200,
              headers: r.headers ?? {},
              body: r.body,
            }
            if (r.scenario !== undefined) cr.scenario = r.scenario
            if (r.when !== undefined) cr.when = r.when
            if (r.delay !== undefined) cr.delay = r.delay
            return cr
          })
        : [{
            status: spec.status ?? 200,
            headers: spec.headers ?? {},
            body: spec.body,
          }]

      const route: CompiledRoute = {
        id,
        method,
        path: spec.path,
        source: { file: '__programmatic__' },
        priority: 9999,
        responses,
      }
      if (spec.scenarios !== undefined) route.scenarios = spec.scenarios

      runtimeRoutes.unshift(route)
      router = buildRouter()
    },

    scenario(name: string): void {
      store.scenarios.set(name)
    },
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8')
      if (!raw) { resolve(undefined); return }
      try { resolve(JSON.parse(raw)) } catch { resolve(raw) }
    })
    req.on('error', () => resolve(undefined))
  })
}

async function resolveBody(body: unknown): Promise<unknown> {
  if (typeof body === 'function') {
    return (body as () => unknown | Promise<unknown>)()
  }
  return body
}
