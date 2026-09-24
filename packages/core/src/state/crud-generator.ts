import type { HttpMethod } from '../types.js'
import type { MockContext } from '../types.js'
import type { MockHandler } from '../responders/handler.js'
import { reply } from '../responders/reply.js'
import type { StateStore } from './store.js'
import type { Collection, AnyRecord, ListOptions } from './collection.js'
import type { ResourceConfig } from '../config/index.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ResourceRoute {
  method: HttpMethod
  /** Full URL path including any parent prefix from `belongsTo`. */
  path: string
  id: string
  handler: MockHandler
}

// ─── Route builder ────────────────────────────────────────────────────────────

/**
 * Generate the six standard CRUD route handlers for a resource config.
 *
 * If `config.belongsTo` is set, an additional set of nested routes is produced
 * (e.g. `GET /users/:userId/orders`).
 */
export function buildResourceRoutes(
  config: ResourceConfig,
  store: StateStore,
): ResourceRoute[] {
  const routes: ResourceRoute[] = []

  // Base (non-nested) routes
  addRoutes(routes, config, store, config.path, null)

  // Nested routes
  if (config.belongsTo) {
    const { parentPath, foreignKey } = config.belongsTo
    const parentParam = config.belongsTo.parentParam ?? deriveParentParam(parentPath)
    const nestedBase = `${parentPath}/:${parentParam}${config.path}`
    addRoutes(routes, config, store, nestedBase, { param: parentParam, foreignKey })
  }

  return routes
}

// ─── Core route construction ──────────────────────────────────────────────────

interface BelongsToContext {
  /** URL param holding the parent's ID (e.g. `userId`) */
  param: string
  /** Field in this collection that stores the parent ID (e.g. `userId`) */
  foreignKey: string
}

function addRoutes(
  routes: ResourceRoute[],
  config: ResourceConfig,
  store: StateStore,
  basePath: string,
  nested: BelongsToContext | null,
): void {
  const name = config.name
  const idField = config.idField
  const pagination = config.pagination ?? { style: 'page', pageParam: 'page', sizeParam: 'limit', default: 10 }
  const prefix = nested ? `nested-${nested.param}-` : ''

  // ── GET /basePath ──────────────────────────────────────────────────────────
  routes.push({
    method: 'GET',
    path: basePath,
    id: `${prefix}${name}:list`,
    handler: (ctx) => {
      const col = store.collection(name) as Collection<AnyRecord>
      const opts = buildListOptions(ctx, pagination, nested)
      const { items, total, nextCursor } = col.list(opts)
      const headers: Record<string, string> = {
        'x-total-count': String(total),
      }
      buildLinkHeader(ctx, opts, total, nextCursor, pagination, headers)
      return Promise.resolve(
        Object.entries(headers).reduce(
          (r, [k, v]) => r.header(k, v),
          reply(200).json(items),
        ),
      )
    },
  })

  // ── GET /basePath/:id ──────────────────────────────────────────────────────
  routes.push({
    method: 'GET',
    path: `${basePath}/:${idField}`,
    id: `${prefix}${name}:get`,
    handler: (ctx) => {
      const col = store.collection(name) as Collection<AnyRecord>
      const id = ctx.params[idField] ?? ''
      const item = col.get(id)
      if (!item) return Promise.resolve(notFound(name, id))
      if (nested && String(item[nested.foreignKey]) !== ctx.params[nested.param]) {
        return Promise.resolve(notFound(name, id))
      }
      return Promise.resolve(reply(200).json(item))
    },
  })

  // ── POST /basePath ─────────────────────────────────────────────────────────
  routes.push({
    method: 'POST',
    path: basePath,
    id: `${prefix}${name}:create`,
    handler: (ctx) => {
      const col = store.collection(name) as Collection<AnyRecord>
      const validationError = validateBody(config, ctx.body)
      if (validationError) return Promise.resolve(unprocessable(validationError))
      const raw = (typeof ctx.body === 'object' && ctx.body !== null ? ctx.body : {}) as AnyRecord
      if (nested) {
        raw[nested.foreignKey] = ctx.params[nested.param]
      }
      let item: AnyRecord
      try {
        item = col.insert(raw)
      } catch {
        return Promise.resolve(reply(409).json({ error: 'Conflict', message: `Item already exists` }))
      }
      const location = `${basePath}/${item[idField]}`
      return Promise.resolve(reply(201).header('location', location).json(item))
    },
  })

  // ── PUT /basePath/:id ──────────────────────────────────────────────────────
  routes.push({
    method: 'PUT',
    path: `${basePath}/:${idField}`,
    id: `${prefix}${name}:replace`,
    handler: (ctx) => {
      const col = store.collection(name) as Collection<AnyRecord>
      const id = ctx.params[idField] ?? ''
      const validationError = validateBody(config, ctx.body)
      if (validationError) return Promise.resolve(unprocessable(validationError))
      const raw = (typeof ctx.body === 'object' && ctx.body !== null ? ctx.body : {}) as AnyRecord
      if (nested) raw[nested.foreignKey] = ctx.params[nested.param]
      const item = col.upsert({ ...raw, [idField]: id })
      return Promise.resolve(reply(200).json(item))
    },
  })

  // ── PATCH /basePath/:id ────────────────────────────────────────────────────
  routes.push({
    method: 'PATCH',
    path: `${basePath}/:${idField}`,
    id: `${prefix}${name}:patch`,
    handler: (ctx) => {
      const col = store.collection(name) as Collection<AnyRecord>
      const id = ctx.params[idField] ?? ''
      const raw = (typeof ctx.body === 'object' && ctx.body !== null ? ctx.body : {}) as AnyRecord
      const updated = col.patch(id, raw)
      if (!updated) return Promise.resolve(notFound(name, id))
      if (nested && String(updated[nested.foreignKey]) !== ctx.params[nested.param]) {
        return Promise.resolve(notFound(name, id))
      }
      return Promise.resolve(reply(200).json(updated))
    },
  })

  // ── DELETE /basePath/:id ───────────────────────────────────────────────────
  routes.push({
    method: 'DELETE',
    path: `${basePath}/:${idField}`,
    id: `${prefix}${name}:delete`,
    handler: (ctx) => {
      const col = store.collection(name) as Collection<AnyRecord>
      const id = ctx.params[idField] ?? ''
      if (nested) {
        const existing = col.get(id)
        if (!existing || String(existing[nested.foreignKey]) !== ctx.params[nested.param]) {
          return Promise.resolve(notFound(name, id))
        }
      }
      const removed = col.remove(id)
      if (!removed) return Promise.resolve(notFound(name, id))
      return Promise.resolve(reply(204))
    },
  })
}

// ─── Pagination helpers ───────────────────────────────────────────────────────

type PaginationConfig = NonNullable<ResourceConfig['pagination']>

function buildListOptions(
  ctx: MockContext,
  pagination: PaginationConfig,
  nested: BelongsToContext | null,
): ListOptions {
  const q = ctx.query as Record<string, string | string[]>

  // Separate pagination params from filter params
  const paginationKeys = new Set([pagination.pageParam, pagination.sizeParam, 'offset', 'sort', 'cursor'])
  const filters: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(q)) {
    if (!paginationKeys.has(k)) {
      filters[k] = v
    }
  }

  // If this is a nested route, pre-filter by foreignKey
  if (nested) {
    filters[nested.foreignKey] = ctx.params[nested.param] ?? ''
  }

  const sortParam = scalar(q['sort'])
  const cursor = scalar(q['cursor'])
  const limitParam = scalar(q[pagination.sizeParam])
  const limit = limitParam ? Math.max(1, parseInt(limitParam, 10)) : pagination.default
  const opts: ListOptions = { filters, limit }

  if (sortParam) opts.sort = sortParam
  if (cursor !== undefined) {
    opts.cursor = cursor
  } else if (pagination.style === 'offset') {
    const offsetParam = scalar(q['offset'])
    opts.offset = offsetParam ? parseInt(offsetParam, 10) : 0
  } else {
    // page style (default)
    const pageParam = scalar(q[pagination.pageParam])
    opts.page = pageParam ? Math.max(1, parseInt(pageParam, 10)) : 1
  }

  return opts
}

function buildLinkHeader(
  ctx: MockContext,
  opts: ListOptions,
  total: number,
  nextCursor: string | undefined,
  pagination: PaginationConfig,
  headers: Record<string, string>,
): void {
  const baseUrl = `${ctx.req.path}`
  const links: string[] = []

  if (pagination.style === 'cursor') {
    if (nextCursor !== undefined) {
      links.push(`<${baseUrl}?cursor=${encodeURIComponent(nextCursor)}>; rel="next"`)
    }
  } else {
    const limit = opts.limit ?? pagination.default
    const totalPages = Math.ceil(total / limit)
    let currentPage: number

    if (pagination.style === 'offset') {
      const offset = opts.offset ?? 0
      currentPage = Math.floor(offset / limit) + 1
    } else {
      currentPage = opts.page ?? 1
    }

    if (currentPage < totalPages) {
      if (pagination.style === 'offset') {
        links.push(`<${baseUrl}?offset=${currentPage * limit}&limit=${limit}>; rel="next"`)
        links.push(`<${baseUrl}?offset=${(totalPages - 1) * limit}&limit=${limit}>; rel="last"`)
      } else {
        links.push(`<${baseUrl}?${pagination.pageParam}=${currentPage + 1}&${pagination.sizeParam}=${limit}>; rel="next"`)
        links.push(`<${baseUrl}?${pagination.pageParam}=${totalPages}&${pagination.sizeParam}=${limit}>; rel="last"`)
      }
    }
    if (currentPage > 1) {
      if (pagination.style === 'offset') {
        links.push(`<${baseUrl}?offset=${(currentPage - 2) * limit}&limit=${limit}>; rel="prev"`)
        links.push(`<${baseUrl}?offset=0&limit=${limit}>; rel="first"`)
      } else {
        links.push(`<${baseUrl}?${pagination.pageParam}=${currentPage - 1}&${pagination.sizeParam}=${limit}>; rel="prev"`)
        links.push(`<${baseUrl}?${pagination.pageParam}=1&${pagination.sizeParam}=${limit}>; rel="first"`)
      }
    }
  }

  if (links.length > 0) {
    headers['link'] = links.join(', ')
  }
}

// ─── Validation ───────────────────────────────────────────────────────────────

interface ZodLike {
  safeParse: (data: unknown) => { success: boolean; error?: { errors: unknown[] } }
}

function isZodSchema(v: unknown): v is ZodLike {
  return typeof v === 'object' && v !== null && typeof (v as ZodLike).safeParse === 'function'
}

function validateBody(
  config: ResourceConfig,
  body: unknown,
): unknown[] | null {
  const schema = (config as { validation?: unknown }).validation
  if (!schema || !isZodSchema(schema)) return null
  const result = schema.safeParse(body)
  if (result.success) return null
  return result.error?.errors ?? ['Validation failed']
}

// ─── Error helpers ────────────────────────────────────────────────────────────

function notFound(resource: string, id: string) {
  return reply(404).json({ error: 'Not Found', resource, id })
}

function unprocessable(errors: unknown[]) {
  return reply(422).json({ error: 'Unprocessable Entity', errors })
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function scalar(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0]
  return v
}

function deriveParentParam(parentPath: string): string {
  const segments = parentPath.split('/').filter(Boolean)
  const last = segments[segments.length - 1] ?? 'parent'
  // Strip trailing 's' for plurals: users → userId, accounts → accountId
  const singular = last.endsWith('s') ? last.slice(0, -1) : last
  return `${singular}Id`
}
