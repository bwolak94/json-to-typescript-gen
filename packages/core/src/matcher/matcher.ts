import type { MockRequest, CompiledResponse } from '../types.js'

// ─── Operator types ───────────────────────────────────────────────────────────

type CompiledMatcher =
  | { type: 'eq'; value: unknown }
  | { type: 'regex'; re: RegExp }
  | { type: 'in'; values: unknown[] }
  | { type: 'absent' }
  | { type: 'present' }
  | { type: 'gt'; value: number }
  | { type: 'lt'; value: number }
  | { type: 'contains'; substring: string }
  | { type: 'partial'; shape: unknown }

// ─── Compiled predicate ───────────────────────────────────────────────────────

interface PredicateEntry {
  source: 'params' | 'query' | 'headers' | 'body'
  /** Dotted path segments within the source object */
  path: string[]
  /** JSONPath expression (only when source='body' and key starts with '$') */
  jsonpath?: string
  matcher: CompiledMatcher
}

/** An opaque array of compiled predicate entries. Produced by compilePredicate. */
export type CompiledPredicate = PredicateEntry[]

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Compile a raw `when` clause (from YAML/JSON config) into an optimized
 * predicate. Call once at route-compile time; reuse for every request.
 *
 * Keys: `params.x`, `query.x`, `headers.x`, `body.x.y`, `body.$.x[0].y`
 * Values: primitive (equality), or operator object: `{ regex }`, `{ in }`,
 *   `{ absent }`, `{ present }`, `{ gt }`, `{ lt }`, `{ contains }`, or
 *   a plain object/array for partial deep match.
 */
export function compilePredicate(when: Record<string, unknown>): CompiledPredicate {
  const entries: PredicateEntry[] = []
  for (const [key, value] of Object.entries(when)) {
    const entry = parseKey(key, value)
    if (entry) entries.push(entry)
  }
  return entries
}

/**
 * Test a compiled predicate against a live request.
 * All entries must match (AND semantics).
 */
export function matchRequest(predicate: CompiledPredicate, req: MockRequest): boolean {
  for (const entry of predicate) {
    const resolved = resolveSource(entry, req)
    if (!applyMatcher(entry.matcher, resolved)) return false
  }
  return true
}

/**
 * Find the first response that matches the request and active scenario.
 * Responses without `when`/`scenario` constraints match everything.
 *
 * Scenario resolution order:
 * 1. `X-Mock-Scenario` request header (per-request override, no global state change).
 * 2. `globalScenario` (from StateStore / CLI `--scenario`).
 *
 * A response with `scenario: "name"` only activates when the effective
 * scenario matches.
 *
 * @param routeScenarios  Optional allowlist of scenario names declared at the
 *   route level (`scenarios: [...]` in YAML). When provided and non-empty, the
 *   entire route is skipped unless the effective scenario is in the list.
 */
export function matchResponse(
  responses: CompiledResponse[],
  req: MockRequest,
  globalScenario: string,
  routeScenarios?: string[],
): CompiledResponse | undefined {
  const headerScenario = getHeader(req.headers, 'x-mock-scenario')
  const activeScenario = headerScenario ?? globalScenario

  // Route-level scenario filter: if the route declares a scenarios allowlist,
  // the active scenario must be present in it — otherwise no response matches.
  if (routeScenarios && routeScenarios.length > 0 && !routeScenarios.includes(activeScenario)) {
    return undefined
  }

  for (const response of responses) {
    if (response.scenario !== undefined && response.scenario !== activeScenario) {
      continue
    }
    if (response.when !== undefined) {
      if (!matchRequest(response.when as CompiledPredicate, req)) continue
    }
    return response
  }
  return undefined
}

// ─── Key parser ───────────────────────────────────────────────────────────────

function parseKey(key: string, value: unknown): PredicateEntry | null {
  const dot = key.indexOf('.')
  if (dot === -1) return null

  const sourceRaw = key.slice(0, dot)
  if (!['params', 'query', 'headers', 'body'].includes(sourceRaw)) return null
  const source = sourceRaw as PredicateEntry['source']

  const rest = key.slice(dot + 1)
  const matcher = compileOperator(value)

  // JSONPath: body.$.items[0].sku or body.$path
  if (source === 'body' && rest.startsWith('$')) {
    return { source, path: [], jsonpath: rest, matcher }
  }

  return { source, path: rest.split('.'), matcher }
}

// ─── Operator compiler ────────────────────────────────────────────────────────

function compileOperator(value: unknown): CompiledMatcher {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>

    if ('regex' in obj && typeof obj['regex'] === 'string') {
      return { type: 'regex', re: new RegExp(obj['regex']) }
    }
    if ('in' in obj && Array.isArray(obj['in'])) {
      return { type: 'in', values: obj['in'] }
    }
    if ('absent' in obj && obj['absent'] === true) {
      return { type: 'absent' }
    }
    if ('present' in obj && obj['present'] === true) {
      return { type: 'present' }
    }
    if ('gt' in obj && typeof obj['gt'] === 'number') {
      return { type: 'gt', value: obj['gt'] }
    }
    if ('lt' in obj && typeof obj['lt'] === 'number') {
      return { type: 'lt', value: obj['lt'] }
    }
    if ('contains' in obj && typeof obj['contains'] === 'string') {
      return { type: 'contains', substring: obj['contains'] }
    }
    // Plain object → partial deep match
    return { type: 'partial', shape: value }
  }

  if (Array.isArray(value)) {
    return { type: 'partial', shape: value }
  }

  return { type: 'eq', value }
}

// ─── Source resolver ──────────────────────────────────────────────────────────

function resolveSource(entry: PredicateEntry, req: MockRequest): unknown {
  let root: unknown
  switch (entry.source) {
    case 'params':  root = req.params;  break
    case 'query':   root = req.query;   break
    case 'headers': root = req.headers; break
    case 'body':    root = req.body;    break
  }

  if (entry.jsonpath) {
    return evaluateJsonPath(entry.jsonpath, root)
  }

  let current: unknown = root
  for (const part of entry.path) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  // Normalize multi-value headers to first element for scalar comparisons
  if (entry.source === 'headers' && Array.isArray(current)) {
    return current[0]
  }
  return current
}

// ─── Matcher evaluator ────────────────────────────────────────────────────────

function applyMatcher(matcher: CompiledMatcher, value: unknown): boolean {
  switch (matcher.type) {
    case 'eq':
      return looseEqual(value, matcher.value)

    case 'regex': {
      const str = value == null ? '' : String(value)
      return matcher.re.test(str)
    }

    case 'in':
      return matcher.values.some((v) => looseEqual(value, v))

    case 'absent':
      return value === undefined

    case 'present':
      return value !== undefined && value !== null && value !== ''

    case 'gt':
      return typeof value === 'number' && value > matcher.value

    case 'lt':
      return typeof value === 'number' && value < matcher.value

    case 'contains': {
      if (typeof value === 'string') return value.includes(matcher.substring)
      if (Array.isArray(value)) return value.some((v) => looseEqual(v, matcher.substring))
      return false
    }

    case 'partial':
      return partialMatch(matcher.shape, value)
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Loose equality: coerces across string/number boundary for query/header
 * comparisons where values arrive as strings (e.g. `"42"` matches `42`).
 */
function looseEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return false
  if (typeof a !== typeof b) return String(a) === String(b)
  return false
}

/**
 * Partial/subset deep match.
 * Every key in `shape` must exist in `actual` with a matching value.
 * Extra keys in `actual` are allowed.
 */
function partialMatch(shape: unknown, actual: unknown): boolean {
  if (shape === null || shape === undefined) return actual === shape
  if (typeof shape !== 'object') return looseEqual(actual, shape)
  if (Array.isArray(shape)) {
    if (!Array.isArray(actual)) return false
    return shape.every((item, i) => partialMatch(item, (actual as unknown[])[i]))
  }
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false
  const shapeObj = shape as Record<string, unknown>
  const actualObj = actual as Record<string, unknown>
  return Object.entries(shapeObj).every(([k, v]) => partialMatch(v, actualObj[k]))
}

function getHeader(
  headers: Record<string, string | string[]>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase()
  // Try exact, then lowercase, then case-insensitive scan
  for (const key of [name, lower]) {
    const val = headers[key]
    if (val !== undefined) return Array.isArray(val) ? val[0] : val
  }
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return Array.isArray(v) ? v[0] : v
  }
  return undefined
}

// ─── Basic JSONPath evaluator ─────────────────────────────────────────────────

/**
 * Evaluate a JSONPath expression against a root value.
 * Supports: `$` (root), `.prop`, `[n]` (index), `['prop']`, `..prop`
 * (recursive descent). Returns undefined when not found, the value when
 * exactly one node matches, or an array when multiple nodes match.
 */
function evaluateJsonPath(path: string, root: unknown): unknown {
  const tokens = tokenizeJsonPath(path)
  let current: unknown[] = [root]

  for (const token of tokens) {
    if (token === '$') continue
    const next: unknown[] = []
    for (const node of current) {
      if (token.type === 'prop') {
        if (node !== null && typeof node === 'object' && !Array.isArray(node)) {
          const val = (node as Record<string, unknown>)[token.name]
          if (val !== undefined) next.push(val)
        }
      } else if (token.type === 'index') {
        if (Array.isArray(node) && token.index >= 0 && token.index < node.length) {
          const val = node[token.index]
          if (val !== undefined) next.push(val)
        }
      } else if (token.type === 'recursive') {
        collectRecursive(node, token.name, next)
      }
    }
    current = next
  }

  if (current.length === 0) return undefined
  if (current.length === 1) return current[0]
  return current
}

type JsonPathToken =
  | '$'
  | { type: 'prop'; name: string }
  | { type: 'index'; index: number }
  | { type: 'recursive'; name: string }

function tokenizeJsonPath(path: string): JsonPathToken[] {
  const tokens: JsonPathToken[] = []
  let i = 0
  while (i < path.length) {
    if (path[i] === '$') {
      tokens.push('$')
      i++
    } else if (i + 1 < path.length && path[i] === '.' && path[i + 1] === '.') {
      i += 2
      const id = readIdent(path, i)
      tokens.push({ type: 'recursive', name: id.value })
      i += id.consumed
    } else if (path[i] === '.') {
      i++
      const id = readIdent(path, i)
      if (id.value) tokens.push({ type: 'prop', name: id.value })
      i += id.consumed
    } else if (path[i] === '[') {
      i++
      const end = path.indexOf(']', i)
      if (end === -1) break
      const inner = path.slice(i, end).trim()
      i = end + 1
      if (/^\d+$/.test(inner)) {
        tokens.push({ type: 'index', index: parseInt(inner, 10) })
      } else {
        tokens.push({ type: 'prop', name: inner.replace(/^['"]|['"]$/g, '') })
      }
    } else {
      i++
    }
  }
  return tokens
}

function readIdent(s: string, start: number): { value: string; consumed: number } {
  let i = start
  while (i < s.length && s[i] !== '.' && s[i] !== '[' && s[i] !== ']') i++
  return { value: s.slice(start, i), consumed: i - start }
}

function collectRecursive(node: unknown, name: string, out: unknown[]): void {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) collectRecursive(item, name, out)
  } else {
    const obj = node as Record<string, unknown>
    if (name in obj && obj[name] !== undefined) out.push(obj[name])
    for (const val of Object.values(obj)) collectRecursive(val, name, out)
  }
}
