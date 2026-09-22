import type { ZodError, ZodIssue } from 'zod'
import { QMS_CONFIG_KEYS } from './schema.js'

// ─── Levenshtein distance ─────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  const row = Array.from({ length: n + 1 }, (_, i) => i)

  for (let i = 1; i <= m; i++) {
    let prev = i
    for (let j = 1; j <= n; j++) {
      const val =
        a[i - 1] === b[j - 1]
          ? (row[j - 1] ?? 0)
          : 1 + Math.min(prev, row[j] ?? 0, row[j - 1] ?? 0)
      row[j - 1] = prev
      prev = val
    }
    row[n] = prev
  }
  return row[n] ?? Math.max(m, n)
}

/**
 * Returns the closest candidate to `input` if within edit distance 3,
 * otherwise returns null.
 */
export function didYouMean(input: string, candidates: readonly string[]): string | null {
  const lower = input.toLowerCase()
  let bestDist = 4 // only suggest if dist <= 3
  let best: string | null = null

  for (const c of candidates) {
    const d = levenshtein(lower, c.toLowerCase())
    if (d < bestDist) {
      bestDist = d
      best = c
    }
  }
  return best
}

// ─── Config error class ───────────────────────────────────────────────────────

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly file: string,
    public readonly issues?: ZodIssue[],
  ) {
    super(message)
    this.name = 'ConfigError'
  }
}

// ─── Zod error formatter ──────────────────────────────────────────────────────

function formatIssue(issue: ZodIssue): string {
  const pathStr =
    issue.path.length > 0
      ? `"${issue.path.join('.')}": `
      : ''

  let msg = `${pathStr}${issue.message}`

  // "did you mean?" for unrecognized keys at the top config level
  if (issue.code === 'unrecognized_keys') {
    const suggestions = issue.keys
      .map((k) => {
        const s = didYouMean(k, QMS_CONFIG_KEYS)
        return s ? `"${k}" → did you mean "${s}"?` : `"${k}" is not a valid key`
      })
      .join(', ')
    msg = `Unrecognized key(s): ${suggestions}`
  }

  return `  • ${msg}`
}

/**
 * Formats a ZodError into a human-readable string with file context.
 */
export function formatZodError(err: ZodError, file: string): string {
  const lines = err.issues.map(formatIssue)
  return `Config validation error in ${file}:\n${lines.join('\n')}`
}

/**
 * Formats a YAML/JSON parse error into a human-readable string.
 */
export function formatParseError(err: unknown, file: string): string {
  if (err instanceof Error) {
    return `Parse error in ${file}: ${err.message}`
  }
  return `Parse error in ${file}: ${String(err)}`
}
