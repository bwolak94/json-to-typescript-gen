// ─── Types ────────────────────────────────────────────────────────────────────

export interface JournalRequest {
  method: string
  path: string
  headers: Record<string, string | string[]>
  body: unknown
}

export interface JournalResponse {
  status: number
  headers: Record<string, string>
}

export interface JournalEntry {
  /** Auto-incremented numeric id (1-based). */
  id: number
  /** Unix timestamp (ms) when the request was received. */
  timestamp: number
  request: JournalRequest
  /** Matched route id, or undefined when no route matched. */
  routeId?: string
  /** Response metadata (set after the response is sent). */
  response?: JournalResponse
  /** Wall-clock duration in ms from request receipt to response end. */
  duration: number
  /** Active scenario name at the time of the request. */
  scenario: string
}

export interface JournalQueryOptions {
  method?: string
  path?: string
  routeId?: string
  /** Include only entries at or after this Unix timestamp (ms). */
  from?: number
  /** Include only entries at or before this Unix timestamp (ms). */
  to?: number
}

/** Partial-match object checked against `entry.request.body`. */
export type BodyMatcher = Record<string, unknown>

/** Function or partial-body object used in `lastCalledWith`. */
export type EntryMatcher = ((entry: JournalEntry) => boolean) | BodyMatcher

// ─── Ring buffer ──────────────────────────────────────────────────────────────

class RingBuffer {
  private readonly buf: Array<JournalEntry | undefined>
  private writeIdx = 0
  private _size = 0

  constructor(readonly capacity: number) {
    this.buf = new Array<JournalEntry | undefined>(capacity).fill(undefined)
  }

  push(entry: JournalEntry): void {
    this.buf[this.writeIdx] = entry
    this.writeIdx = (this.writeIdx + 1) % this.capacity
    if (this._size < this.capacity) this._size++
  }

  /** Return all entries in chronological (oldest-first) order. */
  toArray(): JournalEntry[] {
    if (this._size === 0) return []
    if (this._size < this.capacity) {
      return this.buf.slice(0, this._size) as JournalEntry[]
    }
    // Buffer full: oldest entry is at writeIdx
    return [
      ...(this.buf.slice(this.writeIdx) as JournalEntry[]),
      ...(this.buf.slice(0, this.writeIdx) as JournalEntry[]),
    ]
  }

  get size(): number {
    return this._size
  }

  clear(): void {
    this.buf.fill(undefined)
    this.writeIdx = 0
    this._size = 0
  }
}

// ─── Journal ─────────────────────────────────────────────────────────────────

/**
 * In-process ring buffer of request/response entries.
 *
 * - Capped at `maxSize` (default 1 000).
 * - Thread-safe in the Node.js single-threaded sense (no async gaps during mutation).
 * - Used by the server pipeline to record every mock request.
 * - Exposed via `GET /__admin/journal` and the test verification helpers.
 */
export class Journal {
  private readonly buf: RingBuffer
  private counter = 0
  private readonly _unmatched: JournalEntry[] = []

  constructor(readonly maxSize = 1000) {
    this.buf = new RingBuffer(maxSize)
  }

  // ── Recording ──────────────────────────────────────────────────────────────

  /**
   * Add an entry to the journal.
   * Returns the stored entry (with assigned `id`).
   */
  record(entry: Omit<JournalEntry, 'id'>): JournalEntry {
    const stored: JournalEntry = { id: ++this.counter, ...entry }
    this.buf.push(stored)
    if (stored.routeId === undefined) {
      this._unmatched.push(stored)
    }
    return stored
  }

  // ── Query ──────────────────────────────────────────────────────────────────

  /**
   * Return all entries (oldest first) optionally filtered.
   */
  query(opts: JournalQueryOptions = {}): JournalEntry[] {
    return this.buf.toArray().filter((e) => matchesQuery(e, opts))
  }

  /** Number of entries currently in the buffer. */
  get size(): number {
    return this.buf.size
  }

  /** Entries with no matched route (unmatched requests). */
  get unmatched(): JournalEntry[] {
    return [...this._unmatched]
  }

  /** Remove all entries from the buffer and the unmatched list. */
  clear(): void {
    this.buf.clear()
    this._unmatched.length = 0
  }

  // ── Verification helpers ───────────────────────────────────────────────────

  /**
   * Return the number of calls matching `method` + `path`.
   */
  count(method: string, path: string): number {
    return this.query({ method: method.toUpperCase(), path }).length
  }

  /**
   * Return the last entry matching `method` + `path` (and optional `matcher`).
   * Throws a readable error when no matching entry is found.
   */
  lastCalledWith(
    method: string,
    path: string,
    matcher?: EntryMatcher,
  ): JournalEntry {
    const candidates = this.query({ method: method.toUpperCase(), path })

    const matches = matcher
      ? candidates.filter((e) => applyEntryMatcher(matcher, e))
      : candidates

    if (matches.length === 0) {
      const total = this.count(method, path)
      const hint =
        total === 0
          ? `No calls recorded for ${method.toUpperCase()} ${path}.`
          : `${total} call(s) recorded for ${method.toUpperCase()} ${path} but none matched the provided matcher.`
      throw new JournalAssertionError(
        `lastCalledWith(${method.toUpperCase()}, ${path}): ${hint}\n` +
          formatEntries(candidates),
      )
    }

    return matches[matches.length - 1]!
  }

  /**
   * Assert that `method` + `path` was **never** called.
   * Throws a readable error if any matching entry exists.
   */
  never(method: string, path: string): void {
    const entries = this.query({ method: method.toUpperCase(), path })
    if (entries.length > 0) {
      throw new JournalAssertionError(
        `never(${method.toUpperCase()}, ${path}): expected no calls but found ${entries.length}.\n` +
          formatEntries(entries),
      )
    }
  }
}

// ─── JournalAssertionError ────────────────────────────────────────────────────

export class JournalAssertionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JournalAssertionError'
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function matchesQuery(entry: JournalEntry, opts: JournalQueryOptions): boolean {
  if (opts.method && entry.request.method.toUpperCase() !== opts.method.toUpperCase()) return false
  if (opts.path && entry.request.path !== opts.path) return false
  if (opts.routeId !== undefined && entry.routeId !== opts.routeId) return false
  if (opts.from !== undefined && entry.timestamp < opts.from) return false
  if (opts.to !== undefined && entry.timestamp > opts.to) return false
  return true
}

function applyEntryMatcher(matcher: EntryMatcher, entry: JournalEntry): boolean {
  if (typeof matcher === 'function') return matcher(entry)
  // Plain object → partial match against request body
  return partialMatch(matcher, entry.request.body)
}

function partialMatch(shape: unknown, actual: unknown): boolean {
  if (shape === null || shape === undefined) return actual === shape
  if (typeof shape !== 'object') return shape === actual
  if (Array.isArray(shape)) {
    if (!Array.isArray(actual)) return false
    return shape.every((item, i) => partialMatch(item, (actual as unknown[])[i]))
  }
  if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false
  const shapeObj = shape as Record<string, unknown>
  const actualObj = actual as Record<string, unknown>
  return Object.entries(shapeObj).every(([k, v]) => partialMatch(v, actualObj[k]))
}

function formatEntries(entries: JournalEntry[]): string {
  if (entries.length === 0) return '  (no entries)'
  return entries
    .map((e) => `  [${e.id}] ${e.request.method} ${e.request.path} → ${e.response?.status ?? '?'} (${e.duration}ms)`)
    .join('\n')
}
