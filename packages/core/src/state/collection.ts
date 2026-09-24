import { randomUUID } from 'node:crypto'

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnyRecord = Record<string, unknown>

export interface ListOptions {
  /** Raw query-string map — filter keys may carry `_gte/_lte/_like/_ne` suffixes */
  filters?: Record<string, string | string[]>
  /** Field to sort by; prefix `-` for descending (e.g. `-createdAt`) */
  sort?: string
  /** 1-based page number (used together with `limit`) */
  page?: number
  /** Max items to return */
  limit?: number
  /** 0-based offset (alternative to page) */
  offset?: number
  /** Opaque cursor from previous page's `nextCursor` */
  cursor?: string
}

export interface ListResult<T> {
  items: T[]
  total: number
  /** Only present when cursor-style pagination is active and more items follow */
  nextCursor?: string
}

// ─── Collection ──────────────────────────────────────────────────────────────

export class Collection<T extends AnyRecord = AnyRecord> {
  readonly idField: string
  private map: Map<string, T> = new Map()

  constructor(idField: string, initial?: T[]) {
    this.idField = idField
    if (initial) this._seed(initial)
  }

  // ── Reads ──────────────────────────────────────────────────────────────────

  get(id: string): T | undefined {
    return this.map.get(id)
  }

  list(opts: ListOptions = {}): ListResult<T> {
    let items = [...this.map.values()]

    // Filters
    if (opts.filters) {
      items = applyFilters(items, opts.filters)
    }

    // Sort
    if (opts.sort) {
      items = applySort(items, opts.sort)
    }

    const total = items.length

    // Cursor pagination
    if (opts.cursor !== undefined) {
      const limit = opts.limit ?? 10
      const idx = items.findIndex((it) => String(it[this.idField]) === opts.cursor)
      const start = idx === -1 ? 0 : idx + 1
      const page = items.slice(start, start + limit)
      const r: ListResult<T> = { items: page, total }
      if (page.length === limit && start + limit < items.length) {
        r.nextCursor = String(page[page.length - 1]![this.idField])
      }
      return r
    }

    // Offset / page pagination
    const limit = opts.limit ?? (opts.page !== undefined ? 10 : undefined)
    if (limit !== undefined) {
      const offset = opts.offset ?? (opts.page !== undefined ? (opts.page - 1) * limit : 0)
      items = items.slice(offset, offset + limit)
    } else if (opts.offset !== undefined) {
      items = items.slice(opts.offset)
    }

    return { items, total }
  }

  size(): number {
    return this.map.size
  }

  toArray(): T[] {
    return [...this.map.values()]
  }

  // ── Writes ─────────────────────────────────────────────────────────────────

  insert(item: T): T {
    const id = String(item[this.idField] ?? randomUUID())
    if (this.map.has(id)) {
      throw new CollectionError(`Duplicate ${this.idField}: ${id}`)
    }
    const stored = { ...item, [this.idField]: id } as T
    this.map.set(id, stored)
    return stored
  }

  upsert(item: T): T {
    const id = String(item[this.idField] ?? randomUUID())
    const stored = { ...item, [this.idField]: id } as T
    this.map.set(id, stored)
    return stored
  }

  patch(id: string, partial: AnyRecord): T | undefined {
    const existing = this.map.get(id)
    if (!existing) return undefined
    const updated = deepMerge(existing, partial) as T
    this.map.set(id, updated)
    return updated
  }

  remove(id: string): boolean {
    return this.map.delete(id)
  }

  reset(items?: T[]): void {
    this.map.clear()
    if (items) this._seed(items)
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _seed(items: T[]): void {
    for (const item of items) {
      const id = String(item[this.idField] ?? randomUUID())
      this.map.set(id, { ...item, [this.idField]: id })
    }
  }
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class CollectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CollectionError'
  }
}

// ─── Filtering ───────────────────────────────────────────────────────────────

const FILTER_SUFFIXES = ['_gte', '_lte', '_like', '_ne'] as const

/**
 * Apply filter params to an array of items.
 *
 * Supported patterns:
 *   `field=value`      equality (loose: "42" matches 42)
 *   `field_gte=value`  >=
 *   `field_lte=value`  <=
 *   `field_ne=value`   !=
 *   `field_like=value` substring / regex match (case-insensitive)
 */
export function applyFilters<T extends AnyRecord>(
  items: T[],
  filters: Record<string, string | string[]>,
): T[] {
  const predicates: Array<(item: T) => boolean> = []

  for (const [rawKey, rawValue] of Object.entries(filters)) {
    const value = Array.isArray(rawValue) ? rawValue[0]! : rawValue

    let field = rawKey
    let op: (typeof FILTER_SUFFIXES)[number] | 'eq' = 'eq'

    for (const suffix of FILTER_SUFFIXES) {
      if (rawKey.endsWith(suffix)) {
        field = rawKey.slice(0, -suffix.length)
        op = suffix
        break
      }
    }

    predicates.push((item) => {
      const itemVal = item[field]
      return matchFilter(itemVal, op, value)
    })
  }

  return items.filter((item) => predicates.every((p) => p(item)))
}

function matchFilter(
  itemVal: unknown,
  op: 'eq' | '_gte' | '_lte' | '_like' | '_ne',
  filterVal: string,
): boolean {
  switch (op) {
    case 'eq':
      return looseEqual(itemVal, filterVal)
    case '_ne':
      return !looseEqual(itemVal, filterVal)
    case '_gte':
      return compareNumOrStr(itemVal, filterVal) >= 0
    case '_lte':
      return compareNumOrStr(itemVal, filterVal) <= 0
    case '_like': {
      const haystack = itemVal == null ? '' : String(itemVal).toLowerCase()
      return haystack.includes(filterVal.toLowerCase())
    }
  }
}

function looseEqual(a: unknown, b: string): boolean {
  if (a === b) return true
  if (typeof a === 'number') return a === Number(b)
  if (typeof a === 'boolean') return a === (b === 'true')
  return String(a ?? '') === b
}

function compareNumOrStr(a: unknown, b: string): number {
  if (typeof a === 'number') {
    const n = Number(b)
    return isNaN(n) ? -1 : a - n
  }
  return String(a ?? '').localeCompare(b)
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

/**
 * Sort items by a field name.  Prefix `-` means descending.
 */
export function applySort<T extends AnyRecord>(items: T[], sort: string): T[] {
  const desc = sort.startsWith('-')
  const field = desc ? sort.slice(1) : sort.startsWith('+') ? sort.slice(1) : sort

  return [...items].sort((a, b) => {
    const av = a[field]
    const bv = b[field]
    let cmp: number
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv
    } else {
      cmp = String(av ?? '').localeCompare(String(bv ?? ''))
    }
    return desc ? -cmp : cmp
  })
}

// ─── Deep merge ──────────────────────────────────────────────────────────────

export function deepMerge(base: AnyRecord, patch: AnyRecord): AnyRecord {
  const result: AnyRecord = { ...base }
  for (const [k, v] of Object.entries(patch)) {
    if (
      v !== null &&
      typeof v === 'object' &&
      !Array.isArray(v) &&
      result[k] !== null &&
      typeof result[k] === 'object' &&
      !Array.isArray(result[k])
    ) {
      result[k] = deepMerge(result[k] as AnyRecord, v as AnyRecord)
    } else {
      result[k] = v
    }
  }
  return result
}
