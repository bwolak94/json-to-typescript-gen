import type http from 'node:http'
import { Router } from '@quick-mock-server/core'
import type { LoadedRoute, RouteEntry } from '@quick-mock-server/core'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RouteHandle extends RouteEntry {
  responses: LoadedRoute['responses']
  _source: { file: string }
}

// ─── Router builder ───────────────────────────────────────────────────────────

export function buildRouter(routes: LoadedRoute[]): Router<RouteHandle> {
  const router = new Router<RouteHandle>()
  for (const route of routes) {
    const methods = Array.isArray(route.method) ? route.method : [route.method]
    for (const method of methods) {
      router.add({
        id: `${method}:${route.path}:${route._source.file}`,
        method,
        path: route.path,
        responses: route.responses,
        _source: route._source,
      })
    }
  }
  return router
}

// ─── Request dispatcher ───────────────────────────────────────────────────────

/**
 * State ref holding the current router.
 * Replaced atomically on hot reload — in-flight requests hold their snapshot.
 */
export interface DispatchState {
  router: Router<RouteHandle>
}

export function createHandler(state: DispatchState) {
  return async (req: http.IncomingMessage, res: http.ServerResponse): Promise<void> => {
    const urlStr = req.url ?? '/'
    let pathname: string
    try {
      pathname = new URL(urlStr, 'http://localhost').pathname
    } catch {
      pathname = urlStr
    }

    const method = req.method ?? 'GET'
    const snap = state.router // snapshot captured for this request

    const match = snap.find(method, pathname)

    if (!match) {
      res.writeHead(404, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not Found', method, path: pathname }))
      return
    }

    // Basic response dispatch — picks first response in the array.
    // Conditional matching (F3) and scenario filtering (F6) will be
    // layered on top of this in their respective feature branches.
    const first = match.route.responses[0]
    if (!first) {
      res.writeHead(204)
      res.end()
      return
    }

    const body = first.body !== undefined ? JSON.stringify(first.body) : undefined
    const headers: Record<string, string> = {
      'content-type': body !== undefined ? 'application/json' : 'text/plain',
      'x-mock-route': match.route.id,
      ...first.headers,
    }

    res.writeHead(first.status, headers)
    res.end(body ?? '')
  }
}
