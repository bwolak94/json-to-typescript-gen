import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { RouteWatcher } from '../watcher/index.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SIMPLE_YAML = (path: string) => `
routes:
  - method: GET
    path: ${path}
    responses:
      - status: 200
`

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RouteWatcher', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'qms-watcher-test-'))
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  // ─── Config ─────────────────────────────────────────────────────────────────

  describe('config', () => {
    it('stores defaults when not provided', () => {
      const w = new RouteWatcher({ mocksDir: tmpDir })
      expect(w.debounceMs).toBe(100)
      expect(w.preserveStateOnReload).toBe(false)
      expect(w.cwd).toBe(process.cwd())
    })

    it('stores provided config values', () => {
      const w = new RouteWatcher({
        mocksDir: tmpDir,
        cwd: '/custom',
        debounceMs: 250,
        preserveStateOnReload: true,
      })
      expect(w.mocksDir).toBe(tmpDir)
      expect(w.cwd).toBe('/custom')
      expect(w.debounceMs).toBe(250)
      expect(w.preserveStateOnReload).toBe(true)
    })
  })

  // ─── Initial load ────────────────────────────────────────────────────────────

  describe('start()', () => {
    it('returns empty snapshot when mocksDir is empty', async () => {
      const w = new RouteWatcher({ mocksDir: tmpDir })
      const snap = await w.start()
      await w.stop()

      expect(snap.routes).toEqual([])
      expect(snap.resources).toEqual([])
      expect(snap.warnings).toEqual([])
    })

    it('loads routes from mock files on start', async () => {
      await writeFile(join(tmpDir, 'api.yaml'), SIMPLE_YAML('/hello'))

      const w = new RouteWatcher({ mocksDir: tmpDir })
      const snap = await w.start()
      await w.stop()

      expect(snap.routes).toHaveLength(1)
      expect(snap.routes[0]?.path).toBe('/hello')
    })

    it('snapshot getter returns the initial snapshot', async () => {
      await writeFile(join(tmpDir, 'api.yaml'), SIMPLE_YAML('/initial'))

      const w = new RouteWatcher({ mocksDir: tmpDir })
      await w.start()
      await w.stop()

      expect(w.snapshot.routes[0]?.path).toBe('/initial')
    })

    it('loads multiple files', async () => {
      await writeFile(join(tmpDir, 'a.yaml'), SIMPLE_YAML('/a'))
      await writeFile(join(tmpDir, 'b.yaml'), SIMPLE_YAML('/b'))

      const w = new RouteWatcher({ mocksDir: tmpDir })
      const snap = await w.start()
      await w.stop()

      const paths = snap.routes.map((r) => r.path).sort()
      expect(paths).toEqual(['/a', '/b'])
    })
  })

  // ─── Manual reload ───────────────────────────────────────────────────────────

  describe('reload()', () => {
    it('updates snapshot with new file contents', async () => {
      await writeFile(join(tmpDir, 'api.yaml'), SIMPLE_YAML('/v1'))

      const w = new RouteWatcher({ mocksDir: tmpDir })
      await w.start()

      await writeFile(join(tmpDir, 'api.yaml'), SIMPLE_YAML('/v2'))
      const snap = await w.reload()
      await w.stop()

      expect(snap.routes[0]?.path).toBe('/v2')
      expect(w.snapshot.routes[0]?.path).toBe('/v2')
    })

    it('snapshot reference is atomically replaced', async () => {
      await writeFile(join(tmpDir, 'api.yaml'), SIMPLE_YAML('/old'))

      const w = new RouteWatcher({ mocksDir: tmpDir })
      await w.start()

      const oldRef = w.snapshot

      await writeFile(join(tmpDir, 'api.yaml'), SIMPLE_YAML('/new'))
      await w.reload()
      await w.stop()

      // new reference is different object
      expect(w.snapshot).not.toBe(oldRef)
      // old reference still points to old data (in-flight safety)
      expect(oldRef.routes[0]?.path).toBe('/old')
      expect(w.snapshot.routes[0]?.path).toBe('/new')
    })

    it('picks up newly added files', async () => {
      const w = new RouteWatcher({ mocksDir: tmpDir })
      await w.start()

      expect(w.snapshot.routes).toHaveLength(0)

      await writeFile(join(tmpDir, 'new.yaml'), SIMPLE_YAML('/added'))
      await w.reload()
      await w.stop()

      expect(w.snapshot.routes).toHaveLength(1)
      expect(w.snapshot.routes[0]?.path).toBe('/added')
    })
  })

  // ─── Error resilience ────────────────────────────────────────────────────────

  describe('error resilience', () => {
    it('preserves last valid snapshot when reload() throws', async () => {
      await writeFile(join(tmpDir, 'api.yaml'), SIMPLE_YAML('/valid'))

      const w = new RouteWatcher({ mocksDir: tmpDir })
      await w.start()
      const validRef = w.snapshot

      // Force _doLoad to throw
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(w as any, '_doLoad').mockRejectedValueOnce(new Error('disk error'))

      await expect(w.reload()).rejects.toThrow('disk error')

      // Snapshot must still point to the old valid reference
      expect(w.snapshot).toBe(validRef)
      expect(w.snapshot.routes[0]?.path).toBe('/valid')

      await w.stop()
    })

    it('keeps serving last valid snapshot when FS-triggered reload fails', async () => {
      await writeFile(join(tmpDir, 'api.yaml'), SIMPLE_YAML('/good'))

      const w = new RouteWatcher({ mocksDir: tmpDir, debounceMs: 10 })
      await w.start()

      const validRef = w.snapshot

      // Force the next reload to fail
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(w as any, '_doLoad').mockRejectedValueOnce(new Error('transient error'))

      // Trigger _triggerReload directly (the internal debounce handler)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (w as any)._triggerReload()

      // Snapshot still valid
      expect(w.snapshot).toBe(validRef)

      await w.stop()
    })

    it('demotes per-file parse errors to warnings (server stays up)', async () => {
      await writeFile(join(tmpDir, 'good.yaml'), SIMPLE_YAML('/ok'))
      await writeFile(join(tmpDir, 'bad.yaml'), 'routes: [bad yaml: {{{')

      const w = new RouteWatcher({ mocksDir: tmpDir })
      const snap = await w.start()
      await w.stop()

      // Good routes still present
      expect(snap.routes.some((r) => r.path === '/ok')).toBe(true)
      // Error demoted to warning
      expect(snap.warnings.length).toBeGreaterThan(0)
    })
  })

  // ─── onReload hook ───────────────────────────────────────────────────────────

  describe('onReload()', () => {
    it('hook is called after successful reload()', async () => {
      const w = new RouteWatcher({ mocksDir: tmpDir })
      await w.start()

      const hook = vi.fn()
      w.onReload(hook)

      await w.reload()
      await w.stop()

      expect(hook).toHaveBeenCalledOnce()
    })

    it('hook receives the new snapshot', async () => {
      await writeFile(join(tmpDir, 'api.yaml'), SIMPLE_YAML('/hooked'))

      const w = new RouteWatcher({ mocksDir: tmpDir })
      await w.start()

      let received: unknown
      w.onReload((snap) => {
        received = snap
      })

      await w.reload()
      await w.stop()

      expect(received).toMatchObject({
        routes: expect.arrayContaining([expect.objectContaining({ path: '/hooked' })]),
        resources: expect.any(Array),
        warnings: expect.any(Array),
      })
    })

    it('multiple hooks are all called in registration order', async () => {
      const w = new RouteWatcher({ mocksDir: tmpDir })
      await w.start()

      const order: number[] = []
      w.onReload(() => { order.push(1) })
      w.onReload(() => { order.push(2) })
      w.onReload(() => { order.push(3) })

      await w.reload()
      await w.stop()

      expect(order).toEqual([1, 2, 3])
    })

    it('hook is NOT called when reload() throws', async () => {
      const w = new RouteWatcher({ mocksDir: tmpDir })
      await w.start()

      const hook = vi.fn()
      w.onReload(hook)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.spyOn(w as any, '_doLoad').mockRejectedValueOnce(new Error('boom'))

      await expect(w.reload()).rejects.toThrow('boom')
      expect(hook).not.toHaveBeenCalled()

      await w.stop()
    })

    it('onReload returns this for chaining', async () => {
      const w = new RouteWatcher({ mocksDir: tmpDir })
      const result = w.onReload(() => undefined)
      expect(result).toBe(w)
      await w.stop()
    })
  })

  // ─── Debounce ────────────────────────────────────────────────────────────────

  describe('debounce', () => {
    it('collapses multiple rapid schedule calls into one reload', async () => {
      const w = new RouteWatcher({ mocksDir: tmpDir, debounceMs: 100 })
      await w.start()

      const reloadSpy = vi.spyOn(w, 'reload')

      vi.useFakeTimers()
      try {
        // Trigger schedule 5 times quickly
        for (let i = 0; i < 5; i++) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(w as any)._scheduleReload()
        }

        // Advance past debounce — only 1 reload should fire
        await vi.runAllTimersAsync()
      } finally {
        vi.useRealTimers()
      }

      // reload is called once (via _triggerReload → reload)
      expect(reloadSpy).toHaveBeenCalledTimes(1)

      await w.stop()
    })

    it('does not fire before debounce window elapses', async () => {
      const w = new RouteWatcher({ mocksDir: tmpDir, debounceMs: 200 })
      await w.start()

      const reloadSpy = vi.spyOn(w, 'reload')

      vi.useFakeTimers()
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(w as any)._scheduleReload()

        // Advance only 100ms — should NOT have fired yet
        await vi.advanceTimersByTimeAsync(100)
        expect(reloadSpy).not.toHaveBeenCalled()

        // Advance the remaining 100ms — now it fires
        await vi.advanceTimersByTimeAsync(100)
        expect(reloadSpy).toHaveBeenCalledTimes(1)
      } finally {
        vi.useRealTimers()
      }

      await w.stop()
    })
  })

  // ─── FS integration ──────────────────────────────────────────────────────────

  describe('FS watching (integration)', () => {
    it('file change triggers reload via chokidar', async () => {
      await writeFile(join(tmpDir, 'api.yaml'), SIMPLE_YAML('/before'))

      const w = new RouteWatcher({ mocksDir: tmpDir, debounceMs: 50 })
      await w.start()

      expect(w.snapshot.routes[0]?.path).toBe('/before')

      const hook = vi.fn()
      w.onReload(hook)

      // Modify the file
      await writeFile(join(tmpDir, 'api.yaml'), SIMPLE_YAML('/after'))

      // Wait for chokidar + debounce
      await vi.waitFor(
        () => expect(hook).toHaveBeenCalled(),
        { timeout: 3000 },
      )

      expect(w.snapshot.routes[0]?.path).toBe('/after')

      await w.stop()
    }, 5000)

    it('adding a new file triggers reload', async () => {
      const w = new RouteWatcher({ mocksDir: tmpDir, debounceMs: 50 })
      await w.start()

      expect(w.snapshot.routes).toHaveLength(0)

      const hook = vi.fn()
      w.onReload(hook)

      await writeFile(join(tmpDir, 'new.yaml'), SIMPLE_YAML('/added'))

      await vi.waitFor(
        () => expect(hook).toHaveBeenCalled(),
        { timeout: 3000 },
      )

      expect(w.snapshot.routes[0]?.path).toBe('/added')

      await w.stop()
    }, 5000)

    it('deleting a file triggers reload and removes its routes', async () => {
      await writeFile(join(tmpDir, 'gone.yaml'), SIMPLE_YAML('/going'))

      const w = new RouteWatcher({ mocksDir: tmpDir, debounceMs: 50 })
      await w.start()

      expect(w.snapshot.routes).toHaveLength(1)

      const hook = vi.fn()
      w.onReload(hook)

      await rm(join(tmpDir, 'gone.yaml'))

      await vi.waitFor(
        () => expect(hook).toHaveBeenCalled(),
        { timeout: 3000 },
      )

      expect(w.snapshot.routes).toHaveLength(0)

      await w.stop()
    }, 5000)
  })
})
