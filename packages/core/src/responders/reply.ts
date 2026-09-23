import { readFile } from 'node:fs/promises'

// ─── Public types ─────────────────────────────────────────────────────────────

export type BodyType = 'json' | 'text' | 'file' | 'empty'

export interface ReplyData {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  readonly body: unknown
  readonly bodyType: BodyType
}

// ─── Fluent reply builder ─────────────────────────────────────────────────────

/**
 * Fluent, chainable response builder for TypeScript handler functions.
 *
 * @example
 * ```ts
 * return reply(200)
 *   .header('x-request-id', '123')
 *   .json({ ok: true })
 * ```
 */
export class ReplyBuilder implements ReplyData {
  readonly status: number
  readonly headers: Record<string, string>
  body: unknown = undefined
  bodyType: BodyType = 'empty'

  constructor(status: number) {
    this.status = status
    this.headers = {}
  }

  /** Add (or overwrite) a single response header. Chainable. */
  header(name: string, value: string): this {
    this.headers[name.toLowerCase()] = value
    return this
  }

  /**
   * Set response body as JSON.
   * Automatically sets `content-type: application/json` if not already set.
   */
  json(body: unknown): this {
    this.body = body
    this.bodyType = 'json'
    this.headers['content-type'] ??= 'application/json'
    return this
  }

  /**
   * Set response body as plain text.
   * Automatically sets `content-type: text/plain; charset=utf-8` if not already set.
   */
  text(body: string): this {
    this.body = body
    this.bodyType = 'text'
    this.headers['content-type'] ??= 'text/plain; charset=utf-8'
    return this
  }

  /**
   * Set response body from a file path (resolved at response time).
   * Content-type is inferred from extension unless set explicitly.
   */
  file(path: string): this {
    this.body = path
    this.bodyType = 'file'
    return this
  }
}

/** Create a new reply chain starting with the given HTTP status code. */
export function reply(status = 200): ReplyBuilder {
  return new ReplyBuilder(status)
}

// ─── Resolve file body ────────────────────────────────────────────────────────

const FILE_CONTENT_TYPES: Record<string, string> = {
  '.json':  'application/json',
  '.yaml':  'application/yaml',
  '.yml':   'application/yaml',
  '.xml':   'application/xml',
  '.html':  'text/html; charset=utf-8',
  '.txt':   'text/plain; charset=utf-8',
  '.csv':   'text/csv',
}

/**
 * Materialise a reply with `bodyType === 'file'`:
 * reads the file from disk and returns a new reply with the file content.
 * Infers Content-Type from the file extension if not already set.
 */
export async function resolveFileReply(r: ReplyBuilder): Promise<ReplyBuilder> {
  if (r.bodyType !== 'file' || typeof r.body !== 'string') return r

  const filePath = r.body
  const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase()
  const content = await readFile(filePath, 'utf8')

  const resolved = new ReplyBuilder(r.status)
  Object.assign(resolved.headers, r.headers)
  resolved.headers['content-type'] ??= FILE_CONTENT_TYPES[ext] ?? 'application/octet-stream'

  const isJson = (resolved.headers['content-type'] ?? '').startsWith('application/json')
  if (isJson) {
    return resolved.json(JSON.parse(content) as unknown)
  }
  return resolved.text(content)
}
