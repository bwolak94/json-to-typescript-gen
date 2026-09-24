import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import http from 'node:http'
import { once } from 'node:events'
import { AddressInfo } from 'node:net'
import { runChaosPre, wrapSlowBody } from '../chaos/middleware.js'
import type { ChaosConfig } from '../chaos/index.js'

// ─── Fake response helpers ────────────────────────────────────────────────────

interface FakeRes {
  statusCode: number
  headers: Record<string, string | number>
  body: Buffer
  ended: boolean
  writeHead: (status: number, hdrs?: Record<string, string | number>) => void
  write: (chunk: Buffer | string, enc?: BufferEncoding | ((e?: Error | null) => void), cb?: (e?: Error | null) => void) => boolean
  end: (chunk?: Buffer | string | null, enc?: BufferEncoding | (() => void), cb?: () => void) => http.ServerResponse
}

function makeFakeRes(): FakeRes {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string | number>,
    body: Buffer.alloc(0),
    ended: false,
    headersSent: false,
    writeHead(status: number, hdrs?: Record<string, string | number>) {
      res.statusCode = status
      if (hdrs) Object.assign(res.headers, hdrs)
    },
    write(chunk: Buffer | string, enc?: BufferEncoding | ((e?: Error | null) => void), cb?: (e?: Error | null) => void): boolean {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
      res.body = Buffer.concat([res.body, buf])
      const callback = typeof enc === 'function' ? enc : cb
      callback?.(null)
      return true
    },
    end(chunk?: Buffer | string | null, enc?: BufferEncoding | (() => void), cb?: () => void): http.ServerResponse {
      if (chunk != null && chunk !== '') {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
        res.body = Buffer.concat([res.body, buf])
      }
      res.ended = true
      const callback = typeof enc === 'function' ? enc : cb
      callback?.()
      return res as unknown as http.ServerResponse
    },
  }
  return res
}

function makeFakeReq(socketDestroyed = { value: false }): http.IncomingMessage {
  return {
    socket: {
      destroy() { socketDestroyed.value = true },
    },
  } as unknown as http.IncomingMessage
}

// ─── runChaosPre — disabled ───────────────────────────────────────────────────

describe('runChaosPre — chaos disabled', () => {
  it('returns continue when enabled is false', async () => {
    const config: ChaosConfig = { enabled: false, latency: 500, errorRate: 1 }
    const outcome = await runChaosPre(config, makeFakeReq(), makeFakeRes() as unknown as http.ServerResponse)
    expect(outcome).toBe('continue')
  })

  it('returns continue for empty config', async () => {
    const outcome = await runChaosPre({}, makeFakeReq(), makeFakeRes() as unknown as http.ServerResponse)
    expect(outcome).toBe('continue')
  })
})

// ─── runChaosPre — drop ───────────────────────────────────────────────────────

describe('runChaosPre — drop', () => {
  it('destroys the socket', async () => {
    const destroyed = { value: false }
    const outcome = await runChaosPre(
      { drop: true },
      makeFakeReq(destroyed),
      makeFakeRes() as unknown as http.ServerResponse,
    )
    expect(outcome).toBe('drop')
    expect(destroyed.value).toBe(true)
  })

  it('drop takes priority over timeout', async () => {
    const destroyed = { value: false }
    const outcome = await runChaosPre(
      { drop: true, timeout: true },
      makeFakeReq(destroyed),
      makeFakeRes() as unknown as http.ServerResponse,
    )
    expect(outcome).toBe('drop')
    expect(destroyed.value).toBe(true)
  })
})

// ─── runChaosPre — timeout ────────────────────────────────────────────────────

describe('runChaosPre — timeout', () => {
  it('returns timeout outcome without sending a response', async () => {
    const res = makeFakeRes()
    const outcome = await runChaosPre(
      { timeout: true },
      makeFakeReq(),
      res as unknown as http.ServerResponse,
    )
    expect(outcome).toBe('timeout')
    expect(res.ended).toBe(false)
  })

  it('timeout takes priority over errorRate', async () => {
    const res = makeFakeRes()
    const outcome = await runChaosPre(
      { timeout: true, errorRate: 1 },
      makeFakeReq(),
      res as unknown as http.ServerResponse,
      () => 0,
    )
    expect(outcome).toBe('timeout')
    expect(res.ended).toBe(false)
  })
})

// ─── runChaosPre — errorRate ──────────────────────────────────────────────────

describe('runChaosPre — errorRate', () => {
  it('injects error when rng < errorRate', async () => {
    const res = makeFakeRes()
    const outcome = await runChaosPre(
      { errorRate: 0.5 },
      makeFakeReq(),
      res as unknown as http.ServerResponse,
      () => 0.3, // < 0.5 → inject
    )
    expect(outcome).toBe('error')
    expect(res.statusCode).toBeGreaterThanOrEqual(500)
    expect(res.ended).toBe(true)
  })

  it('does not inject error when rng >= errorRate', async () => {
    const res = makeFakeRes()
    const outcome = await runChaosPre(
      { errorRate: 0.5 },
      makeFakeReq(),
      res as unknown as http.ServerResponse,
      () => 0.7, // >= 0.5 → skip
    )
    expect(outcome).toBe('continue')
    expect(res.ended).toBe(false)
  })

  it('uses default 500 when errorStatus not provided', async () => {
    const res = makeFakeRes()
    await runChaosPre({ errorRate: 1 }, makeFakeReq(), res as unknown as http.ServerResponse, () => 0)
    expect(res.statusCode).toBe(500)
  })

  it('picks from errorStatus list', async () => {
    const res = makeFakeRes()
    await runChaosPre(
      { errorRate: 1, errorStatus: [503] },
      makeFakeReq(),
      res as unknown as http.ServerResponse,
      () => 0,
    )
    expect(res.statusCode).toBe(503)
  })

  it('error response body is JSON', async () => {
    const res = makeFakeRes()
    await runChaosPre({ errorRate: 1 }, makeFakeReq(), res as unknown as http.ServerResponse, () => 0)
    expect(() => JSON.parse(res.body.toString())).not.toThrow()
  })

  it('sets X-Chaos-Injected header', async () => {
    const res = makeFakeRes()
    await runChaosPre({ errorRate: 1 }, makeFakeReq(), res as unknown as http.ServerResponse, () => 0)
    expect(res.headers['X-Chaos-Injected']).toBe('error')
  })
})

// ─── runChaosPre — latency ────────────────────────────────────────────────────

describe('runChaosPre — latency', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('resolves with continue after fixed latency', async () => {
    const res = makeFakeRes()
    const p = runChaosPre({ latency: 300 }, makeFakeReq(), res as unknown as http.ServerResponse)
    vi.advanceTimersByTime(300)
    const outcome = await p
    expect(outcome).toBe('continue')
  })

  it('does not resolve before the delay', async () => {
    let resolved = false
    const res = makeFakeRes()
    const p = runChaosPre({ latency: 500 }, makeFakeReq(), res as unknown as http.ServerResponse)
      .then((o) => { resolved = true; return o })
    vi.advanceTimersByTime(499)
    await Promise.resolve()
    expect(resolved).toBe(false)
    vi.advanceTimersByTime(1)
    await p
    expect(resolved).toBe(true)
  })

  it('range latency resolves after sampled delay', async () => {
    const res = makeFakeRes()
    const p = runChaosPre(
      { latency: { min: 100, max: 200 } },
      makeFakeReq(),
      res as unknown as http.ServerResponse,
      () => 0.5, // → 150ms
    )
    vi.advanceTimersByTime(150)
    const outcome = await p
    expect(outcome).toBe('continue')
  })

  it('latency + errorRate: error is injected after delay', async () => {
    const res = makeFakeRes()
    const p = runChaosPre(
      { latency: 100, errorRate: 1 },
      makeFakeReq(),
      res as unknown as http.ServerResponse,
      () => 0,
    )
    vi.advanceTimersByTime(100)
    const outcome = await p
    expect(outcome).toBe('error')
    expect(res.ended).toBe(true)
  })
})

// ─── wrapSlowBody ─────────────────────────────────────────────────────────────

describe('wrapSlowBody', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends complete body eventually', async () => {
    const res = makeFakeRes()
    wrapSlowBody(res as unknown as http.ServerResponse, { chunkSize: 4, delayMs: 50 })

    const p = new Promise<void>((resolve) => {
      res.end('Hello World', undefined, resolve)
    })
    await vi.runAllTimersAsync()
    await p
    expect(res.body.toString()).toBe('Hello World')
    expect(res.ended).toBe(true)
  })

  it('splits body into chunks of chunkSize', async () => {
    const writes: number[] = []
    const res = makeFakeRes()
    const origWrite = res.write.bind(res)
    res.write = (chunk: Buffer | string, ...args: Parameters<typeof res.write>[1][]) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
      writes.push(buf.length)
      return origWrite(chunk, ...args as Parameters<typeof origWrite>[1][])
    }

    wrapSlowBody(res as unknown as http.ServerResponse, { chunkSize: 3, delayMs: 10 })
    const p = new Promise<void>((r) => { res.end('ABCDEF', undefined, r) })
    await vi.runAllTimersAsync()
    await p
    expect(writes).toEqual([3, 3])
  })

  it('delays between chunks', async () => {
    const timestamps: number[] = []
    const res = makeFakeRes()
    const origWrite = res.write.bind(res)
    res.write = (chunk: Buffer | string, ...args: Parameters<typeof res.write>[1][]) => {
      timestamps.push(Date.now())
      return origWrite(chunk, ...args as Parameters<typeof origWrite>[1][])
    }

    wrapSlowBody(res as unknown as http.ServerResponse, { chunkSize: 2, delayMs: 100 })
    const p = new Promise<void>((r) => { res.end('ABCD', undefined, r) })
    await vi.runAllTimersAsync()
    await p
    expect(timestamps).toHaveLength(2)
    expect(timestamps[1]! - timestamps[0]!).toBeGreaterThanOrEqual(100)
  })

  it('buffers write() calls and flushes on end()', async () => {
    const res = makeFakeRes()
    wrapSlowBody(res as unknown as http.ServerResponse, { chunkSize: 100, delayMs: 10 })
    res.write('part1')
    res.write('part2')
    expect(res.body.toString()).toBe('') // not yet sent

    const p = new Promise<void>((r) => { res.end(undefined, undefined, r) })
    await vi.runAllTimersAsync()
    await p
    expect(res.body.toString()).toBe('part1part2')
  })

  it('invokes end callback when streaming is complete', async () => {
    const res = makeFakeRes()
    wrapSlowBody(res as unknown as http.ServerResponse, { chunkSize: 5, delayMs: 20 })
    let called = false
    const p = new Promise<void>((r) => {
      res.end('Hello', undefined, () => { called = true; r() })
    })
    await vi.runAllTimersAsync()
    await p
    expect(called).toBe(true)
  })
})

// ─── Integration — real HTTP server ──────────────────────────────────────────

describe('chaos middleware — real HTTP integration', () => {
  it('latency delays the response', async () => {
    const server = http.createServer(async (req, res) => {
      const outcome = await runChaosPre({ latency: 50 }, req, res)
      if (outcome !== 'continue') return
      res.writeHead(200)
      res.end('ok')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const { port } = server.address() as AddressInfo

    const t0 = Date.now()
    const r = await fetch(`http://127.0.0.1:${port}/`)
    const elapsed = Date.now() - t0
    expect(r.status).toBe(200)
    expect(elapsed).toBeGreaterThanOrEqual(40) // allow ±10ms jitter

    await new Promise<void>((r) => server.close(() => r()))
  })

  it('errorRate=1 returns error status', async () => {
    const server = http.createServer(async (req, res) => {
      const outcome = await runChaosPre({ errorRate: 1, errorStatus: [503] }, req, res)
      if (outcome !== 'continue') return
      res.writeHead(200)
      res.end('ok')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const { port } = server.address() as AddressInfo

    const r = await fetch(`http://127.0.0.1:${port}/`)
    expect(r.status).toBe(503)

    await new Promise<void>((r) => server.close(() => r()))
  })

  it('slowBody delivers complete response', async () => {
    const server = http.createServer((req, res) => {
      wrapSlowBody(res, { chunkSize: 3, delayMs: 5 })
      res.writeHead(200)
      res.end('Hello World')
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const { port } = server.address() as AddressInfo

    const r = await fetch(`http://127.0.0.1:${port}/`)
    const text = await r.text()
    expect(r.status).toBe(200)
    expect(text).toBe('Hello World')

    await new Promise<void>((r) => server.close(() => r()))
  })
})
