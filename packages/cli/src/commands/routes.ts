import { loadConfig, ConfigError } from '@quick-mock-server/core'
import { printRouteTable, printError, printBanner } from '../output.js'

export interface RoutesOptions {
  config?: string
}

export async function routesCommand(options: RoutesOptions): Promise<void> {
  const cwd = process.cwd()

  try {
    const result = await loadConfig({ cwd, ...(options.config ? { configFile: options.config } : {}) })

    printBanner('0.0.1')
    console.log(`  Loaded ${result.routes.length} route(s) from ${result.config.mocksDir}`)
    console.log()
    printRouteTable(result.routes, cwd)

    for (const w of result.warnings) {
      process.stderr.write(`  ⚠  ${w}\n`)
    }
  } catch (err) {
    if (err instanceof ConfigError) {
      printError(err.message)
    } else {
      printError(`Unexpected error: ${String(err)}`)
    }
    process.exit(1)
  }
}
