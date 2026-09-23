import { loadConfig, ConfigError } from '@quick-mock-server/core'
import { printSuccess, printError, printInfo } from '../output.js'

export interface ValidateOptions {
  config?: string
}

export async function validateCommand(options: ValidateOptions): Promise<void> {
  const cwd = process.cwd()

  try {
    const result = await loadConfig({ cwd, ...(options.config ? { configFile: options.config } : {}) })

    for (const warning of result.warnings) {
      printInfo(warning)
    }

    const routeCount = result.routes.length
    const resourceCount = result.resources.length
    printSuccess(
      `Config valid — ${routeCount} route(s), ${resourceCount} resource(s)` +
        (result.warnings.length > 0 ? ` (${result.warnings.length} warning(s))` : ''),
    )

    process.exit(0)
  } catch (err) {
    if (err instanceof ConfigError) {
      printError(err.message)
    } else {
      printError(`Unexpected error: ${String(err)}`)
    }
    process.exit(1)
  }
}
