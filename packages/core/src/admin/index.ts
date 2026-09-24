import type http from 'node:http'
import type { CompiledRoute } from '../types.js'
import type { StateStore } from '../state/store.js'
import type { AnyRecord } from '../state/collection.js'
import type { ChaosConfig } from '../chaos/index.js'

// ─── Public API types ─────────────────────────────────────────────────────────

export interface AdminConfig {
  /** URL prefix for admin endpoints (e.g. `/__admin`). */
  path: string
  /** When set, requests must carry `Authorization: Bearer <token>`. */
  token?: string
  /** When false the admin handler rejects all requests with 404. */
  enabled: boolean
}

export interface AdminDeps {
  /** Return the live compiled route list. Called per-request so hot-reload works. */
  getRoutes: () => CompiledRoute[]
  /** Shared state store (collections + scenario). */
  state: StateStore
  /** Return the current global chaos config. */
  getChaos: () => ChaosConfig
  /** Replace the global chaos config. */
  setChaos: (cfg: ChaosConfig) => void
  /** Prepend a runtime override route (highest priority). */
  addRuntimeRoute: (route: CompiledRoute) => void
  /** Admin mount config. */
  config: AdminConfig
  /** Server start time, used to compute uptime in /health. */
  startedAt?: Date
}

// ─── createAdminHandler ───────────────────────────────────────────────────────

/**
 * Build a request handler that serves all `/__admin/*` endpoints.
 *
 * Admin requests bypass the chaos middleware and journal — wire this handler
 * BEFORE the regular mock pipeline in your server dispatcher.
 */
export function createAdminHandler(deps: AdminDeps): (
  req: http.IncomingMessage,
  res: http.ServerResponse,
) => Promise<boolean> {
  const snapshots = new Map<string, Record<string, AnyRecord[]>>()
  let snapshotCounter = 0

  /**
   * Handle an incoming request.
   * @returns `true` when the request was handled (caller must not process it further),
   *          `false` when the path is not an admin route.
   */
  return async function adminHandler(req, res): Promise<boolean> {
    const { config, state, getRoutes, getChaos, setChaos, addRuntimeRoute, startedAt } = deps

    if (!config.enabled) return false

    const url = req.url ?? '/'
    const urlPath = url.split('?')[0]!

    // Only handle paths under the admin prefix
    if (urlPath !== config.path && !urlPath.startsWith(config.path + '/')) {
      return false
    }

    // ── Token auth ──────────────────────────────────────────────────────────
    if (config.token) {
      const auth = req.headers['authorization'] ?? ''
      const expected = `Bearer ${config.token}`
      if (auth !== expected) {
        sendJson(res, 401, { error: 'Unauthorized' })
        return true
      }
    }

    const method = req.method?.toUpperCase() ?? 'GET'
    // Strip the admin prefix to get the sub-path
    const sub = urlPath.slice(config.path.length) || '/'

    // ── GET /__admin/health ──────────────────────────────────────────────────
    if (method === 'GET' && sub === '/health') {
      const uptime = startedAt ? Math.floor((Date.now() - startedAt.getTime()) / 1000) : 0
      sendJson(res, 200, { status: 'ok', uptime })
      return true
    }

    // ── GET /__admin/routes ──────────────────────────────────────────────────
    if (method === 'GET' && sub === '/routes') {
      const routes = getRoutes().map((r) => ({
        id: r.id,
        method: r.method,
        path: r.path,
        source: r.source,
        priority: r.priority,
        responseCount: r.responses.length,
        scenarios: r.scenarios,
      }))
      sendJson(res, 200, routes)
      return true
    }

    // ── GET /__admin/scenario ────────────────────────────────────────────────
    if (method === 'GET' && sub === '/scenario') {
      sendJson(res, 200, { active: state.scenarios.active })
      return true
    }

    // ── PUT /__admin/scenario ────────────────────────────────────────────────
    if (method === 'PUT' && sub === '/scenario') {
      const body = await readBody(req)
      const parsed = tryParseJson(body)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        sendJson(res, 400, { error: 'Expected JSON object with "scenario" field' })
        return true
      }
      const name = (parsed as Record<string, unknown>)['scenario']
      if (typeof name !== 'string') {
        sendJson(res, 400, { error: '"scenario" must be a string' })
        return true
      }
      state.scenarios.set(name)
      sendJson(res, 200, { active: state.scenarios.active })
      return true
    }

    // ── POST /__admin/state/reset ────────────────────────────────────────────
    if (method === 'POST' && sub === '/state/reset') {
      state.reset()
      sendJson(res, 200, { ok: true })
      return true
    }

    // ── POST /__admin/state/snapshot ─────────────────────────────────────────
    if (method === 'POST' && sub === '/state/snapshot') {
      const body = await readBody(req)
      const parsed = body ? tryParseJson(body) : {}
      const nameFromBody =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)['name']
          : undefined
      const name = typeof nameFromBody === 'string' && nameFromBody
        ? nameFromBody
        : `snap-${++snapshotCounter}`
      snapshots.set(name, state.snapshot())
      sendJson(res, 200, { name })
      return true
    }

    // ── POST /__admin/state/restore/:name ────────────────────────────────────
    const restoreMatch = sub.match(/^\/state\/restore\/(.+)$/)
    if (method === 'POST' && restoreMatch) {
      const name = decodeURIComponent(restoreMatch[1]!)
      const snap = snapshots.get(name)
      if (!snap) {
        sendJson(res, 404, { error: `Snapshot "${name}" not found` })
        return true
      }
      state.restore(snap)
      sendJson(res, 200, { ok: true, name })
      return true
    }

    // ── GET /__admin/journal ─────────────────────────────────────────────────
    if (method === 'GET' && sub === '/journal') {
      // Journal module (F11) not yet implemented — return empty list
      sendJson(res, 200, { entries: [] })
      return true
    }

    // ── DELETE /__admin/journal ──────────────────────────────────────────────
    if (method === 'DELETE' && sub === '/journal') {
      sendJson(res, 200, { ok: true })
      return true
    }

    // ── PUT /__admin/chaos ───────────────────────────────────────────────────
    if (method === 'PUT' && sub === '/chaos') {
      const body = await readBody(req)
      const patch = tryParseJson(body)
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        sendJson(res, 400, { error: 'Expected JSON object' })
        return true
      }
      const current = getChaos()
      const updated: ChaosConfig = { ...current, ...(patch as Partial<ChaosConfig>) }
      setChaos(updated)
      sendJson(res, 200, updated)
      return true
    }

    // ── POST /__admin/routes ─────────────────────────────────────────────────
    if (method === 'POST' && sub === '/routes') {
      const body = await readBody(req)
      const parsed = tryParseJson(body)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        sendJson(res, 400, { error: 'Expected JSON route object' })
        return true
      }
      const route = parsed as Record<string, unknown>
      if (typeof route['method'] !== 'string' || typeof route['path'] !== 'string') {
        sendJson(res, 400, { error: '"method" and "path" are required' })
        return true
      }
      const override: CompiledRoute = {
        id: `runtime:${route['method']}:${route['path']}`,
        method: route['method'] as CompiledRoute['method'],
        path: route['path'] as string,
        source: { file: '__admin' },
        priority: 9999,
        responses: Array.isArray(route['responses'])
          ? (route['responses'] as CompiledRoute['responses'])
          : [],
      }
      addRuntimeRoute(override)
      sendJson(res, 201, { id: override.id })
      return true
    }

    // ── 404 for unknown admin paths ──────────────────────────────────────────
    sendJson(res, 404, { error: `Unknown admin endpoint: ${method} ${sub}` })
    return true
  }
}

// ─── isAdminPath ─────────────────────────────────────────────────────────────

/**
 * Returns `true` when `urlPath` falls under the admin prefix.
 * Use this to short-circuit normal route matching.
 */
export function isAdminPath(urlPath: string, adminPath: string): boolean {
  return urlPath === adminPath || urlPath.startsWith(adminPath + '/')
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
  })
  res.end(json)
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', () => resolve(''))
  })
}

function tryParseJson(raw: string | undefined): unknown {
  if (!raw || !raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
