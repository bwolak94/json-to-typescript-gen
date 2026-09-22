import { resolve } from 'node:path'
import { loadConfigFile, loadMockDirectory } from './loader.js'
import { mergeRoutes } from './merger.js'
import type { QmsConfig, RawRoute, ResourceConfig } from './schema.js'
import type { LoadedRoute } from './loader.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export type { QmsConfig, RawRoute, ResourceConfig }
export type { LoadedRoute, RouteOrigin, LoadedFile } from './loader.js'
export type { RouteCollision, MergeResult } from './merger.js'
export type {
  RawResponse,
  MockFileInput,
  DelaySpecSchema,
} from './schema.js'
export { ConfigError } from './errors.js'

// ─── Load result ──────────────────────────────────────────────────────────────

export interface LoadResult {
  /** Validated main config (merged with defaults). */
  config: QmsConfig
  /** All routes from all mock files, after collision resolution. */
  routes: LoadedRoute[]
  /** All resource configs from all mock files. */
  resources: ResourceConfig[]
  /** Non-fatal warnings (collisions, soft issues). */
  warnings: string[]
}

// ─── defineConfig / defineRoutes helpers ──────────────────────────────────────

/**
 * Type helper for `qms.config.ts`.
 * Provides editor auto-complete and type checking at authoring time.
 *
 * @example
 * ```ts
 * import { defineConfig } from 'quick-mock-server'
 * export default defineConfig({ port: 4000, mocksDir: './mocks' })
 * ```
 */
export function defineConfig(config: Partial<QmsConfig>): Partial<QmsConfig> {
  return config
}

/**
 * Type helper for TS mock files.
 * Provides editor auto-complete and type checking at authoring time.
 *
 * @example
 * ```ts
 * import { defineRoutes } from 'quick-mock-server'
 * export default defineRoutes([
 *   { method: 'GET', path: '/hello', responses: [{ status: 200, body: 'hi' }] },
 * ])
 * ```
 */
export function defineRoutes(routes: RawRoute[]): RawRoute[] {
  return routes
}

// ─── loadConfig ───────────────────────────────────────────────────────────────

export interface LoadConfigOptions {
  /** Path to config file. Auto-detected if not provided. */
  configFile?: string
  /** Working directory for resolving paths. Defaults to process.cwd(). */
  cwd?: string
}

/**
 * Main entry point for loading the full qms configuration.
 *
 * 1. Finds and validates `qms.config.*` (using defaults if absent).
 * 2. Globs all mock files from `mocksDir`.
 * 3. Merges routes, resolves collisions, emits warnings.
 */
export async function loadConfig(options: LoadConfigOptions = {}): Promise<LoadResult> {
  const cwd = options.cwd ?? process.cwd()

  // Load main config (or use defaults)
  const configResult = await loadConfigFile(options.configFile, cwd)
  const config = configResult?.config ?? getDefaultConfig()

  // Load all mock files
  const { files, errors } = await loadMockDirectory(
    resolve(cwd, config.mocksDir),
    cwd,
    'manual',
  )

  // Re-throw first hard error (individual file errors are collected)
  if (errors.length > 0) {
    const first = errors[0]
    if (first) {
      // Emit warnings for subsequent errors, throw the first
      const warnings = errors.slice(1).map((e) => `[qms] ${e.message}`)
      const result = mergeRoutes(files)
      return {
        config,
        routes: result.routes,
        resources: result.resources,
        warnings: [...warnings, ...result.warnings],
      }
    }
  }

  const { routes, resources, warnings } = mergeRoutes(files)

  return { config, routes, resources, warnings }
}

function getDefaultConfig(): QmsConfig {
  return {
    port: 3999,
    host: '0.0.0.0',
    prefix: '',
    mocksDir: './mocks',
    cors: false,
    seed: 42,
    openapi: [],
    scenarios: {},
    admin: { enabled: true, path: '/__admin' },
  }
}
