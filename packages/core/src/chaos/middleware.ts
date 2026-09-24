import type http from 'node:http'
import {
  isChaosEnabled,
  sampleDelay,
  shouldInjectError,
  pickErrorStatus,
  applyDelay,
  type ChaosConfig,
  type SlowBodyConfig,
} from './index.js'

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * What the chaos middleware decided to do with the request.
 *
 * - `'continue'`  — proceed with normal route matching and response.
 * - `'drop'`      — socket was destroyed; caller must not write to `res`.
 * - `'timeout'`   — no response will be sent; caller must not write to `res`.
 * - `'error'`     — an error status was sent; caller must not write to `res`.
 */
export type ChaosOutcome = 'continue' | 'drop' | 'timeout' | 'error'

// ─── runChaosPre ─────────────────────────────────────────────────────────────

/**
 * Apply chaos effects **before** the normal response is generated.
 *
 * Priority order (highest first):
 * 1. `drop`       — destroy socket immediately.
 * 2. `timeout`    — swallow the request silently (no response).
 * 3. `errorRate`  — randomly send an error status.
 * 4. `latency`    — delay, then return `'continue'`.
 *
 * @param config  Resolved chaos config for this request (via `resolveChaos`).
 * @param req     Incoming request (needed to access the socket for `drop`).
 * @param res     Outgoing response (used to send error status).
 * @param rng     Deterministic RNG for testing. Defaults to `Math.random`.
 * @returns       Outcome string — caller should stop processing unless `'continue'`.
 */
export async function runChaosPre(
  config: ChaosConfig,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rng: () => number = Math.random,
): Promise<ChaosOutcome> {
  if (!isChaosEnabled(config)) return 'continue'

  // 1. drop — destroy socket immediately
  if (config.drop) {
    req.socket?.destroy()
    return 'drop'
  }

  // 2. timeout — never respond
  if (config.timeout) {
    return 'timeout'
  }

  // 3. errorRate — probabilistic error injection
  if (config.errorRate !== undefined && shouldInjectError(config.errorRate, rng)) {
    const status = pickErrorStatus(config.errorStatus, rng)
    const body = JSON.stringify({ error: 'Chaos error injection', status })
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-Chaos-Injected': 'error',
    })
    res.end(body)
    return 'error'
  }

  // 4. latency — delay before proceeding
  if (config.latency !== undefined) {
    const ms = sampleDelay(config.latency, rng)
    await applyDelay(ms)
  }

  return 'continue'
}

// ─── wrapSlowBody ─────────────────────────────────────────────────────────────

/**
 * Patch a `ServerResponse` so that the body is streamed in chunks with a
 * configurable delay between each chunk.
 *
 * **Must be called before `res.writeHead` / `res.write` / `res.end`.**
 *
 * How it works: `res.write` calls are buffered; `res.end` flushes the
 * accumulated body as timed chunks then calls the original `end`.
 *
 * @param res     The response to patch (mutated in place).
 * @param config  Slow-body parameters (`chunkSize`, `delayMs`).
 */
export function wrapSlowBody(res: http.ServerResponse, config: SlowBodyConfig): void {
  const { chunkSize = 1024, delayMs } = config
  const chunks: Buffer[] = []

  const origWrite = res.write.bind(res)
  const origEnd = res.end.bind(res)

  // Intercept write() — buffer instead of sending
  res.write = (
    chunk: unknown,
    encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void,
  ): boolean => {
    const buf = toBuffer(chunk, typeof encodingOrCb === 'string' ? encodingOrCb : 'utf-8')
    chunks.push(buf)
    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb
    callback?.(null)
    return true
  }

  // Intercept end() — flush buffered body as timed chunks
  res.end = (
    chunkArg?: unknown,
    encodingOrCb?: BufferEncoding | (() => void),
    cb?: () => void,
  ): http.ServerResponse => {
    if (chunkArg != null && chunkArg !== '') {
      const enc = typeof encodingOrCb === 'string' ? encodingOrCb : 'utf-8'
      chunks.push(toBuffer(chunkArg, enc))
    }

    const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb

    const body = Buffer.concat(chunks)
    void streamChunks(origWrite, origEnd, body, chunkSize, delayMs, callback)

    return res
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function streamChunks(
  write: (chunk: Buffer) => boolean,
  end: () => http.ServerResponse,
  body: Buffer,
  chunkSize: number,
  delayMs: number,
  callback?: (() => void) | undefined,
): Promise<void> {
  let offset = 0
  while (offset < body.length) {
    const slice = body.subarray(offset, offset + chunkSize)
    write(slice)
    offset += chunkSize
    if (offset < body.length) {
      await applyDelay(delayMs)
    }
  }
  end()
  callback?.()
}

function toBuffer(chunk: unknown, encoding: BufferEncoding): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk
  if (typeof chunk === 'string') return Buffer.from(chunk, encoding)
  return Buffer.from(String(chunk), encoding)
}
