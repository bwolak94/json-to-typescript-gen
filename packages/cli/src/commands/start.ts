import { resolve } from 'node:path'
import pino from 'pino'
import {
  loadConfig,
  compileRoutes,
  createMockServer,
  StateStore,
  RouteWatcher,
  ConfigError,
} from '@quick-mock-server/core'
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
  // When --config points to a file in another directory, resolve paths relative
  // to that file's directory so that mocksDir etc. work as the user expects.
  const cwd = options.config
    ? resolve(options.config, '..')
    : process.cwd()

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
  const scenario = options.scenario ?? config.scenarios.default ?? ''

  // ── Create server with compiled routes ───────────────────────────────────
  const store = new StateStore(scenario)
  const mocksDir = resolve(process.cwd(), config.mocksDir)
  const initialRoutes = await compileRoutes(result.routes, result.resources, store, config.seed, mocksDir)

  const server = createMockServer({
    port,
    host: config.host,
    defaultScenario: scenario,
    initialRoutes,
    seed: config.seed,
    admin: config.admin,
    ...(config.proxy ? { proxy: config.proxy } : {}),
  })

  // ── Start ─────────────────────────────────────────────────────────────────
  const { url } = await server.start()

  printBanner('0.0.1')
  printStartupInfo({
    url,
    port,
    scenario,
    routeCount: result.routes.length + result.resources.length,
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
      const reloadedStore = server.state
      void compileRoutes(snapshot.routes, snapshot.resources, reloadedStore, config.seed, mocksDir).then((recompiled) => {
        server.setRoutes(recompiled)
        printReload(snapshot.routes.length + snapshot.resources.length)
        for (const w of snapshot.warnings) {
          process.stderr.write(`  ⚠  ${w}\n`)
        }
      })
    })

    await watcher.start()
  }

  // ── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = async () => {
    if (watcher) await watcher.stop()
    await server.stop()
    printStopped()
    process.exit(0)
  }

  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())

  if (options.chaos === false) {
    process.stderr.write('  · --no-chaos flag noted (chaos middleware inactive by default)\n')
  }
}
