import { z } from 'zod'

// ─── HTTP Method ─────────────────────────────────────────────────────────────

export const HTTP_METHODS = [
  'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'ALL', '*',
] as const

export const HttpMethodSchema = z.enum(HTTP_METHODS)

// ─── Delay ───────────────────────────────────────────────────────────────────

export const DelaySpecSchema = z.union([
  z.number().int().nonnegative(),
  z.object({ min: z.number().int().nonnegative(), max: z.number().int().nonnegative() }),
  z.object({ p50: z.number().int().nonnegative(), p99: z.number().int().nonnegative() }),
])

// ─── When clause (permissive — fully validated in feat/f3-conditional-matcher) ──

export const WhenClauseSchema = z.record(z.string(), z.unknown())

// ─── Response ────────────────────────────────────────────────────────────────

export const RawResponseSchema = z.object({
  when: WhenClauseSchema.optional(),
  scenario: z.string().optional(),
  status: z.number().int().min(100).max(599).default(200),
  headers: z.record(z.string(), z.string()).default({}),
  delay: DelaySpecSchema.optional(),
  body: z.unknown().optional(),
  bodyFile: z.string().optional(),
})

// ─── Route ───────────────────────────────────────────────────────────────────

export const RawRouteSchema = z.object({
  method: z
    .union([HttpMethodSchema, z.array(HttpMethodSchema).min(1)])
    .default('GET'),
  path: z.string().startsWith('/'),
  scenarios: z.array(z.string()).optional(),
  delay: DelaySpecSchema.optional(),
  responses: z.array(RawResponseSchema).default([]),
  // handler: TS function — validated as unknown, type-narrowed by caller
  handler: z.unknown().optional(),
})

// ─── Resource (CRUD generator) ────────────────────────────────────────────────

export const ResourceSeedSchema = z.union([
  z.object({
    count: z.number().int().positive(),
    fixture: z.string().optional(),
  }),
  z.object({
    count: z.number().int().positive(),
    schema: z.record(z.string(), z.unknown()),
  }),
])

export const ResourcePaginationSchema = z.object({
  style: z.enum(['page', 'offset', 'cursor']).default('page'),
  pageParam: z.string().default('page'),
  sizeParam: z.string().default('limit'),
  default: z.number().int().positive().default(10),
})

export const ResourceSchema = z.object({
  name: z.string().min(1),
  path: z.string().startsWith('/'),
  idField: z.string().default('id'),
  seed: ResourceSeedSchema.optional(),
  pagination: ResourcePaginationSchema.optional(),
  filters: z.array(z.string()).default([]),
  sort: z.boolean().default(false),
})

// ─── Mock file (single YAML/JSON/TS file) ────────────────────────────────────

export const MockFileSchema = z.object({
  routes: z.array(RawRouteSchema).default([]),
  resources: z.array(ResourceSchema).default([]),
})

// ─── Top-level qms.config.* ──────────────────────────────────────────────────

export const CorsSchema = z.union([
  z.boolean(),
  z.object({
    origins: z.union([z.string(), z.array(z.string())]).optional(),
    credentials: z.boolean().optional(),
    headers: z.array(z.string()).optional(),
  }),
])

export const ProxySchema = z.object({
  target: z.string().url('proxy.target must be a valid URL'),
  mode: z
    .enum(['off', 'passthrough', 'record', 'replay-or-record'])
    .default('passthrough'),
  record: z.boolean().default(false),
  pathRewrite: z.record(z.string(), z.string()).optional(),
})

export const QmsConfigSchema = z
  .object({
    port: z.number().int().min(0).max(65535).default(3999),
    host: z.string().default('0.0.0.0'),
    prefix: z.string().default(''),
    mocksDir: z.string().default('./mocks'),
    cors: CorsSchema.default(false),
    seed: z.number().int().default(42),
    delay: DelaySpecSchema.optional(),
    proxy: ProxySchema.optional(),
    openapi: z.array(z.string()).default([]),
    scenarios: z
      .object({ default: z.string().optional() })
      .default({}),
    admin: z
      .object({
        enabled: z.boolean().default(true),
        path: z.string().default('/__admin'),
        token: z.string().optional(),
      })
      .default({ enabled: true, path: '/__admin' }),
  })
  .strict()

// ─── Exported types ──────────────────────────────────────────────────────────

export type RawResponse = z.infer<typeof RawResponseSchema>
export type RawRoute = z.infer<typeof RawRouteSchema>
export type MockFileInput = z.infer<typeof MockFileSchema>
export type QmsConfig = z.infer<typeof QmsConfigSchema>
export type ResourceConfig = z.infer<typeof ResourceSchema>

/** Known top-level config keys — used for "did you mean?" suggestions. */
export const QMS_CONFIG_KEYS = [
  'port', 'host', 'prefix', 'mocksDir', 'cors', 'seed', 'delay',
  'proxy', 'openapi', 'scenarios', 'admin',
] as const
