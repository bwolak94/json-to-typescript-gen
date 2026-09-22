import type { LoadedRoute, LoadedFile, RouteOrigin } from './loader.js'
import type { ResourceConfig } from './schema.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RouteCollision {
  key: string
  kept: LoadedRoute
  dropped: LoadedRoute
  reason: string
}

export interface MergeResult {
  routes: LoadedRoute[]
  resources: ResourceConfig[]
  collisions: RouteCollision[]
  warnings: string[]
}

// ─── Route key ───────────────────────────────────────────────────────────────

/**
 * Returns the collision-detection key(s) for a route.
 * A route with method array produces one key per method.
 */
function routeKeys(route: LoadedRoute): string[] {
  const methods = Array.isArray(route.method) ? route.method : [route.method]
  return methods.map((m) => `${m}:${route.path}`)
}

// ─── Route priority ───────────────────────────────────────────────────────────

/**
 * Returns numeric priority for collision resolution.
 * Higher = wins.
 */
function originPriority(origin: RouteOrigin): number {
  return origin === 'manual' ? 1 : 0
}

// ─── Merge ────────────────────────────────────────────────────────────────────

/**
 * Merges routes from multiple loaded files.
 *
 * Collision rules:
 * - Manual file wins over OpenAPI-imported route.
 * - Among manual files, the first declaration wins (file-sort order).
 * - A warning is emitted for every collision.
 */
export function mergeRoutes(files: LoadedFile[]): MergeResult {
  const allRoutes = files.flatMap((f) => f.routes)
  const allResources = files.flatMap((f) => f.resources)

  const seen = new Map<string, LoadedRoute>()
  const merged: LoadedRoute[] = []
  const collisions: RouteCollision[] = []
  const warnings: string[] = []

  for (const route of allRoutes) {
    const keys = routeKeys(route)

    for (const key of keys) {
      const existing = seen.get(key)

      if (!existing) {
        seen.set(key, route)
        if (!merged.includes(route)) merged.push(route)
        continue
      }

      // Collision detected
      const incomingPriority = originPriority(route._origin)
      const existingPriority = originPriority(existing._origin)

      if (incomingPriority > existingPriority) {
        // Incoming manual route replaces existing OpenAPI route
        const idx = merged.indexOf(existing)
        if (idx !== -1) merged[idx] = route
        seen.set(key, route)

        const collision: RouteCollision = {
          key,
          kept: route,
          dropped: existing,
          reason: `manual route overrides OpenAPI-imported route`,
        }
        collisions.push(collision)
        warnings.push(formatCollisionWarning(collision))
      } else {
        // Keep existing, drop incoming
        const collision: RouteCollision = {
          key,
          kept: existing,
          dropped: route,
          reason:
            incomingPriority === existingPriority
              ? `duplicate route — first declaration wins`
              : `OpenAPI route shadowed by manual route`,
        }
        collisions.push(collision)
        warnings.push(formatCollisionWarning(collision))
      }
    }
  }

  return {
    routes: merged,
    resources: allResources,
    collisions,
    warnings,
  }
}

function formatCollisionWarning(c: RouteCollision): string {
  return (
    `[qms] Route collision on "${c.key}": ${c.reason}\n` +
    `  kept    → ${c.kept._source.file}\n` +
    `  dropped → ${c.dropped._source.file}`
  )
}

// ─── Deterministic route ID ───────────────────────────────────────────────────

/**
 * Generates a deterministic, human-readable route ID.
 * Format: `METHOD_path_segments_<hash>`
 */
export function generateRouteId(
  method: string | string[],
  path: string,
  sourceFile: string,
): string {
  const methodStr = Array.isArray(method) ? method.join('_') : method
  const key = `${methodStr}:${path}:${sourceFile}`

  // djb2 hash
  let hash = 5381
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash) ^ (key.charCodeAt(i) | 0)
    hash |= 0
  }

  const pathSlug = path
    .replace(/^\//, '')
    .replace(/\//g, '_')
    .replace(/:/g, '')
    .replace(/\?/g, 'opt')
    .replace(/\*/g, 'wild')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .slice(0, 40)

  return `${methodStr.toLowerCase()}_${pathSlug}_${Math.abs(hash).toString(36)}`
}
