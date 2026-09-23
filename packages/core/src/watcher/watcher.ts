import { resolve } from 'node:path'
import { once } from 'node:events'
import { watch } from 'chokidar'
import type { FSWatcher } from 'chokidar'
import { loadMockDirectory } from '../config/loader.js'
import { mergeRoutes } from '../config/merger.js'
import type { LoadedRoute } from '../config/loader.js'
import type { ResourceConfig } from '../config/schema.js'

// ─── Public types ─────────────────────────────────────────────────────────────

export type ReloadHook = (snapshot: WatcherSnapshot) => void | Promise<void>

export interface WatcherSnapshot {
  routes: LoadedRoute[]
  resources: ResourceConfig[]
  warnings: string[]
}

export interface WatcherConfig {
  /** Directory containing mock files to watch */
  mocksDir: string
  /** Working directory for resolving paths. Defaults to process.cwd(). */
  cwd?: string
  /** Debounce delay in ms. Default: 100 */
  debounceMs?: number
  /**
   * When true, in-memory state (CRUD collections) is preserved across reloads.
   * Handled by the state module once it is wired up; stored here for config propagation.
   */
  preserveStateOnReload?: boolean
}

// ─── RouteWatcher ─────────────────────────────────────────────────────────────

/**
 * Watches `mocksDir` for file changes and reloads routes atomically.
 *
 * - 100 ms debounce collapses rapid successive changes into one reload.
 * - The `snapshot` property is replaced as a whole object reference on each
 *   successful reload (atomic in JavaScript's single-threaded event loop).
 *   In-flight requests that already captured the old reference continue
 *   uninterrupted; new requests see the fresh snapshot.
 * - On catastrophic reload failure the last valid snapshot is preserved and
 *   an error is logged — the server is never crashed.
 */
export class RouteWatcher {
  private fswatcher: FSWatcher | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private _snapshot: WatcherSnapshot = { routes: [], resources: [], warnings: [] }
  private readonly reloadHooks: ReloadHook[] = []

  readonly mocksDir: string
  readonly cwd: string
  readonly debounceMs: number
  readonly preserveStateOnReload: boolean

  constructor(config: WatcherConfig) {
    this.mocksDir = config.mocksDir
    this.cwd = config.cwd ?? process.cwd()
    this.debounceMs = config.debounceMs ?? 100
    this.preserveStateOnReload = config.preserveStateOnReload ?? false
  }

  /** Register a hook called after every successful reload. */
  onReload(hook: ReloadHook): this {
    this.reloadHooks.push(hook)
    return this
  }

  /**
   * The current route snapshot.
   * Replaced atomically on each successful reload.
   */
  get snapshot(): WatcherSnapshot {
    return this._snapshot
  }

  /**
   * Performs the initial load, then starts watching for file changes.
   * Resolves with the initial snapshot.
   */
  async start(): Promise<WatcherSnapshot> {
    const initial = await this._doLoad()
    this._snapshot = initial

    const absDir = resolve(this.cwd, this.mocksDir)

    this.fswatcher = watch(absDir, {
      ignoreInitial: true,
      ignored: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
    })

    const schedule = () => this._scheduleReload()
    this.fswatcher.on('add', schedule)
    this.fswatcher.on('change', schedule)
    this.fswatcher.on('unlink', schedule)

    // Wait for the initial scan to complete so that subsequent file events
    // are not missed (chokidar only tracks what it has scanned).
    await once(this.fswatcher, 'ready')

    return initial
  }

  /** Stop watching and cancel any pending debounced reload. */
  async stop(): Promise<void> {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.fswatcher !== null) {
      await this.fswatcher.close()
      this.fswatcher = null
    }
  }

  /**
   * Manually trigger a reload.
   * Atomically updates `snapshot` and calls all `onReload` hooks.
   * Throws on catastrophic failure (e.g. directory inaccessible).
   * Per-file errors are demoted to warnings in the snapshot.
   */
  async reload(): Promise<WatcherSnapshot> {
    const snapshot = await this._doLoad()
    // Atomic reference swap — any concurrent handler already holding a
    // reference to the old snapshot will finish on that version.
    this._snapshot = snapshot
    for (const hook of this.reloadHooks) {
      await hook(snapshot)
    }
    return snapshot
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  private _scheduleReload(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this._triggerReload()
    }, this.debounceMs)
  }

  /**
   * Called by the debounced FS event handler.
   * Errors are caught here so the server never crashes.
   */
  private async _triggerReload(): Promise<void> {
    try {
      await this.reload()
    } catch (err) {
      console.error('[qms] Hot reload failed, keeping last valid routes:', err)
    }
  }

  private async _doLoad(): Promise<WatcherSnapshot> {
    const { files, errors } = await loadMockDirectory(
      this.mocksDir,
      this.cwd,
      'manual',
    )

    const { routes, resources, warnings } = mergeRoutes(files)

    return {
      routes,
      resources,
      warnings: [
        ...errors.map((e) => `[qms] ${e.message}`),
        ...warnings,
      ],
    }
  }
}
