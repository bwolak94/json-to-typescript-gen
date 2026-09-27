import { resolve, dirname } from 'node:path'
import { readFile } from 'node:fs/promises'
import { compilePredicate } from '../matcher/matcher.js'
import { buildResourceRoutes, seedCollection } from '../state/index.js'
import { renderBody } from '../template/index.js'
import type { TemplateContext } from '../template/index.js'
import { executeHandler } from '../responders/index.js'
import type { StateStore } from '../state/index.js'
import type { CompiledRoute, CompiledResponse, HttpMethod, MockContext, HandlerResult } from '../types.js'
import type { LoadedRoute } from './loader.js'
import type { ResourceConfig } from './schema.js'

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compile loaded routes and resource configs into CompiledRoute[].
 *
 * - Compiles `when` predicates once (reused per-request).
 * - Wraps template bodies as context-aware functions.
 * - Wraps `bodyFile` paths as async file readers.
 * - Converts resource configs into full CRUD handler routes.
 * - Seeds collections from `resource.seed` if configured.
 */
export async function compileRoutes(
  routes: LoadedRoute[],
  resources: ResourceConfig[],
  store: StateStore,
  seed = 42,
  mocksDir = process.cwd(),
): Promise<CompiledRoute[]> {
  const compiled: CompiledRoute[] = []

  // ── Declared routes ──────────────────────────────────────────────────────
  for (const route of routes) {
    const methods: HttpMethod[] = Array.isArray(route.method)
      ? route.method as HttpMethod[]
      : [route.method as HttpMethod]

    for (const method of methods) {
      const id = `${method}:${route.path}:${route._source.file}`

      let responses: CompiledResponse[]

      if (typeof route.handler === 'function') {
        // TypeScript handler — wraps the function as a context-aware handler
        const fn = route.handler as Parameters<typeof executeHandler>[0]
        responses = [{
          status: 200,
          headers: {},
          body: undefined,
          handler: async (ctx: MockContext): Promise<HandlerResult> => {
            const reply = await executeHandler(fn, ctx, id, true)
            return { status: reply.status, headers: reply.headers, body: reply.body }
          },
        }]
      } else {
        responses = route.responses.map((r): CompiledResponse => {
          const cr: CompiledResponse = {
            status: r.status ?? 200,
            headers: r.headers ?? {},
            body: undefined,
          }

          if (r.scenario !== undefined) cr.scenario = r.scenario
          if (r.delay !== undefined) cr.delay = r.delay
          if (r.when) cr.when = compilePredicate(r.when as Record<string, unknown>)

          if (r.bodyFile) {
            const baseDir = dirname(route._source.file)
            const absPath = resolve(baseDir, r.bodyFile)
            cr.body = async (_ctx: MockContext) => {
              const content = await readFile(absPath, 'utf8')
              return JSON.parse(content) as unknown
            }
          } else if (hasTemplateExpr(r.body)) {
            const rawBody = r.body
            cr.body = (ctx: MockContext) => {
              const tCtx: TemplateContext = {
                params: ctx.params,
                query: ctx.query,
                headers: ctx.req.headers,
                body: ctx.body,
                state: ctx.state,
              }
              return renderBody(rawBody, tCtx, { globalSeed: seed, routeId: id })
            }
          } else {
            cr.body = r.body
          }

          return cr
        })
      }

      // Inherit route-level delay into responses that don't set their own
      if (route.delay !== undefined) {
        const routeDelay = route.delay
        responses = responses.map((r): CompiledResponse => {
          if (r.delay !== undefined) return r
          const withDelay: CompiledResponse = { ...r }
          withDelay.delay = routeDelay
          return withDelay
        })
      }

      const compiledRoute: CompiledRoute = {
        id,
        method,
        path: route.path,
        source: route._source,
        priority: 1,
        responses,
      }
      if (route.scenarios !== undefined) compiledRoute.scenarios = route.scenarios

      compiled.push(compiledRoute)
    }
  }

  // ── Resource (CRUD) routes ────────────────────────────────────────────────
  for (const resource of resources) {
    if (resource.seed) {
      const col = store.collection(resource.name)
      await seedCollection(resource, col, seed, mocksDir)
    }

    const resourceRoutes = buildResourceRoutes(resource, store)
    for (const rr of resourceRoutes) {
      compiled.push({
        id: rr.id,
        method: rr.method,
        path: rr.path,
        source: { file: '__resource__' },
        priority: 1,
        responses: [{
          status: 200,
          headers: {},
          body: undefined,
          handler: async (ctx: MockContext): Promise<HandlerResult> => {
            const reply = await executeHandler(rr.handler, ctx, rr.id, true)
            return { status: reply.status, headers: reply.headers, body: reply.body }
          },
        }],
      })
    }
  }

  return compiled
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hasTemplateExpr(value: unknown): boolean {
  if (typeof value === 'string') return value.includes('{{')
  if (Array.isArray(value)) return value.some(hasTemplateExpr)
  if (value !== null && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasTemplateExpr)
  }
  return false
}
