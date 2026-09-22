import { describe, it, expect, afterEach } from 'vitest'
import { HttpAdapter } from '../server/adapter.js'

let adapter: HttpAdapter | undefined

afterEach(async () => {
  if (adapter?.isRunning) {
    await adapter.stop()
  }
  adapter = undefined
})

describe('HttpAdapter', () => {
  describe('lifecycle', () => {
    it('starts on port 0 and returns an OS-assigned port', async () => {
      adapter = new HttpAdapter((_req, res) => { res.end() })
      const { port, url } = await adapter.start(0)
      expect(port).toBeGreaterThan(0)
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
      expect(adapter.isRunning).toBe(true)
    })

    it('stops cleanly', async () => {
      adapter = new HttpAdapter((_req, res) => { res.end() })
      await adapter.start(0)
      await adapter.stop()
      expect(adapter.isRunning).toBe(false)
    })

    it('stop() is a no-op when not started', async () => {
      adapter = new HttpAdapter((_req, res) => { res.end() })
      await expect(adapter.stop()).resolves.toBeUndefined()
    })

    it('throws when start() is called twice', async () => {
      adapter = new HttpAdapter((_req, res) => { res.end() })
      await adapter.start(0)
      await expect(adapter.start(0)).rejects.toThrow('already started')
    })

    it('reports correct URL for host 0.0.0.0', async () => {
      adapter = new HttpAdapter((_req, res) => { res.end() })
      const { url } = await adapter.start(0, '0.0.0.0')
      expect(url).toMatch(/^http:\/\/localhost:\d+$/)
    })
  })

  describe('request handling', () => {
    it('serves requests', async () => {
      adapter = new HttpAdapter((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true }))
      })
      const { url } = await adapter.start(0)
      const res = await fetch(`${url}/test`)
      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({ ok: true })
    })

    it('handles async request handlers', async () => {
      adapter = new HttpAdapter(async (_req, res) => {
        await new Promise<void>((r) => setTimeout(r, 10))
        res.writeHead(204)
        res.end()
      })
      const { url } = await adapter.start(0)
      const res = await fetch(`${url}/`)
      expect(res.status).toBe(204)
    })

    it('returns 500 when handler throws synchronously', async () => {
      adapter = new HttpAdapter((_req, _res) => {
        throw new Error('boom')
      })
      const { url } = await adapter.start(0)
      const res = await fetch(`${url}/`)
      expect(res.status).toBe(500)
    })

    it('returns 500 when async handler rejects', async () => {
      adapter = new HttpAdapter(async (_req, _res) => {
        await Promise.reject(new Error('async boom'))
      })
      const { url } = await adapter.start(0)
      const res = await fetch(`${url}/`)
      expect(res.status).toBe(500)
    })
  })

  describe('lifecycle hooks', () => {
    it('calls onStart and onStop hooks in order', async () => {
      const events: string[] = []
      adapter = new HttpAdapter((_req, res) => { res.end() })
      adapter.onStart(() => { events.push('start') })
      adapter.onStop(() => { events.push('stop') })

      await adapter.start(0)
      await adapter.stop()

      expect(events).toEqual(['start', 'stop'])
    })

    it('supports multiple hooks', async () => {
      const events: string[] = []
      adapter = new HttpAdapter((_req, res) => { res.end() })
      adapter
        .onStart(() => { events.push('s1') })
        .onStart(() => { events.push('s2') })
        .onStop(() => { events.push('t1') })
        .onStop(() => { events.push('t2') })

      await adapter.start(0)
      await adapter.stop()

      expect(events).toEqual(['s1', 's2', 't1', 't2'])
    })

    it('supports async hooks', async () => {
      const events: string[] = []
      adapter = new HttpAdapter((_req, res) => { res.end() })
      adapter
        .onStart(async () => {
          await new Promise<void>((r) => setTimeout(r, 5))
          events.push('start')
        })
        .onStop(async () => {
          await new Promise<void>((r) => setTimeout(r, 5))
          events.push('stop')
        })

      await adapter.start(0)
      await adapter.stop()

      expect(events).toEqual(['start', 'stop'])
    })
  })

  describe('graceful shutdown', () => {
    it('completes in-flight requests before closing', async () => {
      let signalStarted!: () => void
      const requestStarted = new Promise<void>((resolve) => {
        signalStarted = resolve
      })

      adapter = new HttpAdapter(async (_req, res) => {
        signalStarted()
        await new Promise<void>((r) => setTimeout(r, 60))
        res.writeHead(200)
        res.end('done')
      })

      const { url } = await adapter.start(0)

      // Fire request but don't await it yet
      const reqPromise = fetch(`${url}/slow`)

      // Wait until the handler is running
      await requestStarted

      // Initiate shutdown while request is in flight
      const stopPromise = adapter.stop()

      // In-flight request should complete successfully
      const res = await reqPromise
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('done')

      // stop() should resolve after the last request finishes
      await stopPromise
      expect(adapter.isRunning).toBe(false)
    })
  })
})
