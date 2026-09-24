import { request as undiciRequest } from 'undici'
import type http from 'node:http'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RecorderConfig {
  /** Directory to write fixtures. Default: `'mocks/recorded'`. */
  dir?: string
  /** Additional header names to strip from recorded fixtures. */
  sensitiveFields?: string[]
  /**
   * Which keys determine uniqueness when deduplicating fixture files.
   * Default: `['method', 'path', 'query']`.
   */
  dedupKeys?: Array<'method' | 'path' | 'query'>
}

export interface ProxyConfig {
  /** Upstream base URL, e.g. `'http://api.example.com'`. */
  target: string
  /**
   * Regex-keyed path rewrite rules applied before forwarding.
   * e.g. `{ '^/api': '' }` strips the `/api` prefix.
   */
  pathRewrite?: Record<string, string>
  /**
   * Proxy mode.
   * - `'off'`               — return 404 for unmatched requests (default)
   * - `'passthrough'`       — forward to upstream, return response
   * - `'record'`            — forward to upstream + write fixture file
   * - `'replay-or-record'`  — serve fixture if exists, else proxy + record
   */
  mode?: 'off' | 'passthrough' | 'record' | 'replay-or-record'
  /** Recorder config. Required when mode is `'record'` or `'replay-or-record'`. */
  record?: RecorderConfig
}

// ─── Hop-by-hop headers (must not be forwarded) ───────────────────────────────

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
  'proxy-connection',
])

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Apply all rewrite rules in order (first match wins per rule). */
export function rewritePath(urlPath: string, rules: Record<string, string>): string {
  let result = urlPath
  for (const [pattern, replacement] of Object.entries(rules)) {
    result = result.replace(new RegExp(pattern), replacement)
  }
  return result || '/'
}

/** Strip hop-by-hop headers from a headers object. */
export function stripHopByHop(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {}
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(key.toLowerCase())) {
      out[key] = value
    }
  }
  return out
}

// ─── proxyRequest ─────────────────────────────────────────────────────────────

/**
 * Forward a request to the configured upstream and stream the response back to `res`.
 * The `rawBody` should be the already-buffered request body (since it may have been
 * read for route matching before proxying). Rewrites the `Host` header and strips
 * hop-by-hop headers in both directions.
 */
export async function proxyRequest(
  config: ProxyConfig,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  urlPath: string,
  search: string,
  rawBody?: Buffer,
): Promise<void> {
  const target = new URL(config.target)

  // Apply path rewrite rules
  let rewritten = rewritePath(urlPath, config.pathRewrite ?? {})
  if (search) rewritten = `${rewritten}?${search}`

  const upstreamUrl = `${target.origin}${rewritten}`

  // Build request headers: strip hop-by-hop, overwrite Host
  const reqHeaders = stripHopByHop(req.headers as Record<string, string | string[] | undefined>)
  reqHeaders['host'] = target.host

  // Forward request (body as buffer since stream is already consumed)
  const { statusCode, headers: upstreamHeaders, body } = await undiciRequest(upstreamUrl, {
    method: req.method ?? 'GET',
    headers: reqHeaders as Record<string, string | string[]>,
    body: rawBody && rawBody.length > 0 ? rawBody : null,
  })

  // Build response headers: strip hop-by-hop
  const resHeaders = stripHopByHop(
    upstreamHeaders as Record<string, string | string[] | undefined>,
  )

  res.writeHead(statusCode ?? 200, resHeaders)

  // Stream response body
  for await (const chunk of body) {
    res.write(chunk)
  }
  res.end()
}
