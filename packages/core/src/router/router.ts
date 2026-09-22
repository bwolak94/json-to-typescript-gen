import { Trie } from './trie.js'
import type { Params } from './trie.js'
import type { HttpMethod } from '../types.js'

export type { Params }

export interface RouteEntry {
  id: string
  method: HttpMethod
  path: string
}

export interface FindResult<T extends RouteEntry> {
  route: T
  params: Params
}

/**
 * HTTP router backed by per-method radix tries.
 *
 * - Supports GET/POST/PUT/PATCH/DELETE/OPTIONS/HEAD/ALL
 * - AUTO HEAD: falls back to GET handler if no HEAD handler registered
 * - AUTO OPTIONS: derives allowed methods from registered routes
 * - ALL: matches any HTTP method (used as wildcard)
 */
export class Router<T extends RouteEntry> {
  private trees = new Map<string, Trie<T>>()

  add(route: T): void {
    const method = route.method.toUpperCase()
    if (!this.trees.has(method)) {
      this.trees.set(method, new Trie<T>())
    }
    this.trees.get(method)!.insert(route.path, route)
  }

  find(method: string, path: string): FindResult<T> | null {
    const upper = method.toUpperCase()

    // HEAD falls back to GET if no HEAD handler registered
    if (upper === 'HEAD') {
      return this.lookup('HEAD', path) ?? this.lookup('GET', path) ?? this.lookup('ALL', path)
    }

    return this.lookup(upper, path) ?? this.lookup('ALL', path)
  }

  /**
   * Returns all HTTP methods that have handlers registered for the given path.
   * Used to build the Allow header in OPTIONS responses.
   */
  allowedMethods(path: string): string[] {
    const methods: string[] = []

    for (const [method, trie] of this.trees) {
      if (method === 'ALL') continue
      if (trie.find(path)) {
        methods.push(method)
      }
    }

    // If ALL is registered for this path, add all standard methods
    if (this.trees.get('ALL')?.find(path)) {
      for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        if (!methods.includes(m)) methods.push(m)
      }
    }

    // HEAD is implicitly allowed when GET is allowed
    if (methods.includes('GET') && !methods.includes('HEAD')) {
      methods.push('HEAD')
    }

    // OPTIONS is always included when the path exists
    if (methods.length > 0 && !methods.includes('OPTIONS')) {
      methods.push('OPTIONS')
    }

    return methods.sort()
  }

  private lookup(method: string, path: string): FindResult<T> | null {
    const result = this.trees.get(method)?.find(path)
    if (!result) return null
    return { route: result.data, params: result.params }
  }
}
