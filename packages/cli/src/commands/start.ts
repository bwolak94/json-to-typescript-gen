import { resolve } from 'node:path'
import pino from 'pino'
import {
  loadConfig,
  HttpAdapter,
  handleSignals,
  RouteWatcher,
  ConfigError,
} from '@quick-mock-server/core'
import { buildRouter, createHandler } from '../dispatch.js'
import {
  printBanner,
  printStartupInfo,
  printRouteTable,
  printReload,
  printStopped,
  printError,
} from '../output.js'

// ─── Logger ───────────────────────────────────────────────────────────────────

const logger = pino({
  level: 'info',
  base: null,
  timestamp: pino.stdTimeFunctions.isoTime,
})

// ─── Options ─────────────────────────────────────────────────────────────────

export interface StartOptions {
  port?: number
  watch?: boolean
  scenario?: string
  chaos?: boolean // --no-chaos sets this to false
  config?: string
}

// ─── Command ─────────────────────────────────────────────────────────────────

export async function startCommand(options: StartOptions): Promise<void> {
  const cwd = process.cwd()

  // ── Load config ──────────────────────────────────────────────────────────
  let result: Awaited<ReturnType<typeof loadConfig>>
  try {
    result = await loadConfig({ cwd, ...(options.config ? { configFile: options.config } : {}) })
  } catch (err) {
    const msg = err instanceof ConfigError ? err.message : String(err)
    printError(`Failed to load config: ${msg}`)
    process.exit(1)
  }

  const config = result.config
  const port = options.port ?? config.port
  const scenario = options.scenario ?? config.scenarios.default

  // ── Build initial router ────────────────────────────────────────────────
  const state = { router: buildRouter(result.routes) }

  // ── Create server ────────────────────────────────────────────────────────
  const adapter = new HttpAdapter(
    (req, res) => {
      const start = Date.now()
      const handler = createHandler(state)
      return handler(req, res).then(() => {
        logger.info({
          method: req.method,
          url: req.url,
          status: res.statusCode,
          ms: Date.now() - start,
        })
      })
    },
    { shutdownTimeoutMs: 10_000 },
  )

  // ── Startup ──────────────────────────────────────────────────────────────
  const { url } = await adapter.start(port, config.host)

  printBanner('0.0.1')
  printStartupInfo({
    url,
    port,
    scenario,
    routeCount: result.routes.length,
    watch: options.watch ?? false,
    warnings: result.warnings,
  })
  printRouteTable(result.routes, cwd)

  // ── Watch mode ───────────────────────────────────────────────────────────
  let watcher: RouteWatcher | null = null

  if (options.watch) {
    const mocksDir = resolve(cwd, config.mocksDir)
    watcher = new RouteWatcher({ mocksDir, cwd, debounceMs: 100 })

    watcher.onReload((snapshot) => {
      state.router = buildRouter(snapshot.routes)
      printReload(snapshot.routes.length)
      for (const w of snapshot.warnings) {
        process.stderr.write(`  ⚠  ${w}\n`)
      }
    })

    await watcher.start()
  }

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = async () => {
    if (watcher) await watcher.stop()
    await adapter.stop()
    printStopped()
    process.exit(0)
  }

  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())

  if (options.chaos === false) {
    // --no-chaos flag noted; chaos middleware not yet implemented (Task 12)
    process.stderr.write('  · --no-chaos: chaos middleware not yet implemented\n')
  }
}
