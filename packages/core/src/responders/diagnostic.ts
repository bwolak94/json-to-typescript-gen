// ─── Diagnostic 404 ───────────────────────────────────────────────────────────

export interface DiagnosticNotFoundBody {
  error: string
  method: string
  path: string
  closestRoutes: string[]
}

export interface SimplifiedNotFoundBody {
  error: string
}

/**
 * Build a 404 response body for an unmatched request.
 *
 * When `enabled === true`, includes `method`, `path`, and up to
 * `MAX_SUGGESTIONS` closest registered routes ranked by Levenshtein distance.
 * Useful for development — disable in production with `admin.diagnostic404: false`.
 */
export function diagnosticNotFound(
  method: string,
  path: string,
  registeredRoutes: string[],
  enabled: boolean,
): { status: 404; body: DiagnosticNotFoundBody | SimplifiedNotFoundBody } {
  if (!enabled) {
    return { status: 404, body: { error: 'Not Found' } }
  }

  const closestRoutes = findClosest(path, registeredRoutes)
  return {
    status: 404,
    body: { error: 'Not Found', method, path, closestRoutes },
  }
}

// ─── Levenshtein distance ──────────────────────────────────────────────────────

/**
 * Compute the Levenshtein (edit) distance between two strings.
 * Uses an iterative DP approach — O(m × n) time, O(n) space via two rows.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m

  // Two-row DP (space-optimised)
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  let curr = new Array<number>(n + 1)

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]!
          : 1 + Math.min(prev[j - 1]!, prev[j]!, curr[j - 1]!)
    }
    ;[prev, curr] = [curr, prev]
  }

  return prev[n]!
}

const MAX_SUGGESTIONS = 3
const MAX_DISTANCE = 5

/**
 * Return up to `MAX_SUGGESTIONS` routes whose path is within
 * `MAX_DISTANCE` edit steps of `path`, sorted nearest-first.
 */
function findClosest(path: string, routes: string[]): string[] {
  return routes
    .map((r) => ({ route: r, dist: levenshtein(path, r) }))
    .filter(({ dist }) => dist <= MAX_DISTANCE)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, MAX_SUGGESTIONS)
    .map(({ route }) => route)
}
