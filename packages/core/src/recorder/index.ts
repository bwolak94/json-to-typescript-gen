import fs from 'node:fs/promises'
import path from 'node:path'
import { stringify, parse } from 'yaml'
import type { ProxyConfig, RecorderConfig } from '../proxy/index.js'
import type http from 'node:http'

export type { RecorderConfig } from '../proxy/index.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const ALWAYS_STRIP_HEADERS = new Set(['authorization', 'cookie', 'set-cookie'])

const DEFAULT_DIR = 'mocks/recorded'
const DEFAULT_DEDUP_KEYS: Array<'method' | 'path' | 'query'> = ['method', 'path', 'query']

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Strip sensitive headers from a response header map before recording.
 * Always removes `authorization`, `cookie`, and `set-cookie`.
 * Optionally removes additional fields from `sensitiveFields`.
 */
export function maskHeaders(
  headers: Record<string, string | string[]>,
  sensitiveFields?: string[],
): Record<string, string | string[]> {
  const extra = new Set((sensitiveFields ?? []).map((f) => f.toLowerCase()))
  const out: Record<string, string | string[]> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (!ALWAYS_STRIP_HEADERS.has(k.toLowerCase()) && !extra.has(k.toLowerCase())) {
      out[k] = v
    }
  }
  return out
}

/** Convert a URL path to a filename-safe slug. */
export function buildSlug(urlPath: string): string {
  return urlPath.replace(/^\//, '').replace(/\//g, '-') || 'root'
}

/**
 * Build the fixture file path for a given request.
 * Format: `<dir>/<host>/<METHOD>-<path-slug>[-q<queryHash>].yaml`
 */
export function buildFixturePath(
  dir: string,
  host: string,
  method: string,
  urlPath: string,
  query: string,
  dedupKeys: Array<'method' | 'path' | 'query'> = DEFAULT_DEDUP_KEYS,
): string {
  const safeHost = host.replace(/[:.]/g, '_')
  const slug = buildSlug(urlPath)

  let queryPart = ''
  if (dedupKeys.includes('query') && query) {
    // Short base64url fingerprint of query string
    queryPart = `-q${Buffer.from(query).toString('base64url').slice(0, 8)}`
  }

  const filename = `${method.toUpperCase()}-${slug}${queryPart}.yaml`
  return path.join(dir, safeHost, filename)
}

// ─── I/O helpers ──────────────────────────────────────────────────────────────

export interface FixtureEntry {
  status: number
  headers: Record<string, string | string[]>
  body: unknown
}

/** Read a fixture file. Returns `null` if the file does not exist. */
export async function readFixture(filePath: string): Promise<FixtureEntry | null> {
  try {
    const content = await fs.readFile(filePath, 'utf-8')
    const data = parse(content) as {
      responses?: Array<{ status: number; headers?: Record<string, string>; body?: unknown }>
    }
    const first = data.responses?.[0]
    if (!first) return null
    return {
      status: first.status ?? 200,
      headers: first.headers ?? {},
      body: first.body,
    }
  } catch {
    return null
  }
}

/** Write a fixture file in `RawRoute` YAML format. Creates parent dirs as needed. */
export async function writeFixture(
  filePath: string,
  method: string,
  urlPath: string,
  status: number,
  headers: Record<string, string | string[]>,
  body: unknown,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const data = {
    method: method.toUpperCase(),
    path: urlPath,
    responses: [{ status, headers, body }],
  }
  await fs.writeFile(filePath, stringify(data), 'utf-8')
}

// ─── High-level recording actions ─────────────────────────────────────────────

/**
 * Proxy the request to upstream, record the response to a fixture file if no
 * fixture exists yet for this method+path+query combination, then send the
 * upstream response back to the client.
 */
export async function proxyAndRecord(
  proxyConfig: ProxyConfig,
  recorderConfig: RecorderConfig,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  urlPath: string,
  search: string,
  rawBody?: Buffer,
): Promise<void> {
  const dir = recorderConfig.dir ?? DEFAULT_DIR
  const dedupKeys = recorderConfig.dedupKeys ?? DEFAULT_DEDUP_KEYS
  const target = new URL(proxyConfig.target)

  const fixturePath = buildFixturePath(dir, target.host, req.method ?? 'GET', urlPath, search, dedupKeys)

  // Capture the upstream response so we can both record and forward it
  const captured = await captureProxyResponse(proxyConfig, req, urlPath, search, rawBody)

  // Only write if no fixture exists yet (deduplication: file-existence check)
  const fixtureExists = await fs.access(fixturePath).then(() => true).catch(() => false)
  if (!fixtureExists) {
    const maskedHeaders = maskHeaders(captured.headers, recorderConfig.sensitiveFields)
    await writeFixture(fixturePath, req.method ?? 'GET', urlPath, captured.status, maskedHeaders, captured.body)
  }

  // Send response to client
  res.writeHead(captured.status, captured.headers)
  res.end(captured.rawBody)
}

/**
 * Serve a recorded fixture if one exists; otherwise proxy to upstream,
 * record the fixture, and serve the upstream response.
 */
export async function replayOrRecord(
  proxyConfig: ProxyConfig,
  recorderConfig: RecorderConfig,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  urlPath: string,
  search: string,
  rawBody?: Buffer,
): Promise<void> {
  const dir = recorderConfig.dir ?? DEFAULT_DIR
  const dedupKeys = recorderConfig.dedupKeys ?? DEFAULT_DEDUP_KEYS
  const target = new URL(proxyConfig.target)

  const fixturePath = buildFixturePath(dir, target.host, req.method ?? 'GET', urlPath, search, dedupKeys)
  const fixture = await readFixture(fixturePath)

  if (fixture) {
    // Serve from fixture
    const bodyStr = fixture.body === undefined || fixture.body === null
      ? ''
      : typeof fixture.body === 'string'
        ? fixture.body
        : JSON.stringify(fixture.body)
    // Strip any existing content-length (case-insensitive) and recalculate
    const responseHeaders: Record<string, string | string[]> = {}
    for (const [k, v] of Object.entries(fixture.headers)) {
      if (k.toLowerCase() !== 'content-length') responseHeaders[k] = v
    }
    responseHeaders['Content-Length'] = String(Buffer.byteLength(bodyStr))
    res.writeHead(fixture.status, responseHeaders)
    res.end(bodyStr)
    return
  }

  // No fixture — proxy + record
  await proxyAndRecord(proxyConfig, recorderConfig, req, res, urlPath, search, rawBody)
}

// ─── Internal: capture proxy response ─────────────────────────────────────────

interface CapturedResponse {
  status: number
  headers: Record<string, string | string[]>
  body: unknown
  rawBody: Buffer
}

async function captureProxyResponse(
  proxyConfig: ProxyConfig,
  req: http.IncomingMessage,
  urlPath: string,
  search: string,
  rawBody?: Buffer,
): Promise<CapturedResponse> {
  // Use a fake ServerResponse that captures the response
  const { request: undiciRequest } = await import('undici')
  const { rewritePath, stripHopByHop } = await import('../proxy/index.js')

  const target = new URL(proxyConfig.target)
  let rewritten = rewritePath(urlPath, proxyConfig.pathRewrite ?? {})
  if (search) rewritten = `${rewritten}?${search}`
  const upstreamUrl = `${target.origin}${rewritten}`

  const reqHeaders = stripHopByHop(req.headers as Record<string, string | string[] | undefined>)
  reqHeaders['host'] = target.host

  const { statusCode, headers: upstreamHeaders, body } = await undiciRequest(upstreamUrl, {
    method: req.method ?? 'GET',
    headers: reqHeaders as Record<string, string | string[]>,
    body: rawBody && rawBody.length > 0 ? rawBody : null,
  })

  const resHeaders = stripHopByHop(upstreamHeaders as Record<string, string | string[] | undefined>)

  // Buffer the full response body
  const chunks: Buffer[] = []
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array))
  }
  const responseRaw = Buffer.concat(chunks)
  const responseStr = responseRaw.toString('utf-8')

  let parsedBody: unknown
  try {
    parsedBody = JSON.parse(responseStr)
  } catch {
    parsedBody = responseStr || undefined
  }

  return {
    status: statusCode ?? 200,
    headers: resHeaders,
    body: parsedBody,
    rawBody: responseRaw,
  }
}
