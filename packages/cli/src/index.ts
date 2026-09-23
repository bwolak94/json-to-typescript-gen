import cac from 'cac'
import { startCommand } from './commands/start.js'
import { initCommand } from './commands/init.js'
import { routesCommand } from './commands/routes.js'
import { validateCommand } from './commands/validate.js'

const VERSION = '0.0.1'

const cli = cac('qms')

// ─── Shared start options helper ─────────────────────────────────────────────

function addStartOptions(cmd: ReturnType<typeof cli.command>) {
  return cmd
    .option('--port <port>', 'Port to listen on (overrides config)')
    .option('--watch', 'Enable hot reload on mock file changes')
    .option('--no-chaos', 'Disable chaos middleware (no-op until Task 12)')
    .option('--scenario <name>', 'Set the active scenario')
    .option('--config <path>', 'Path to qms config file')
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseStartOptions(options: Record<string, unknown>) {
  return {
    watch: Boolean(options['watch']),
    ...(options['port'] != null ? { port: Number(options['port']) } : {}),
    ...(options['scenario'] != null ? { scenario: String(options['scenario']) } : {}),
    ...(options['chaos'] !== undefined ? { chaos: options['chaos'] as boolean } : {}),
    ...(options['config'] != null ? { config: String(options['config']) } : {}),
  }
}

function parseConfigOption(options: Record<string, unknown>) {
  return {
    ...(options['config'] != null ? { config: String(options['config']) } : {}),
  }
}

// ─── Default command (qms with no subcommand = start) ────────────────────────

addStartOptions(cli.command('', 'Start the mock server')).action(
  (options: Record<string, unknown>) => {
    void startCommand(parseStartOptions(options))
  },
)

// ─── qms start ───────────────────────────────────────────────────────────────

addStartOptions(cli.command('start', 'Start the mock server')).action(
  (options: Record<string, unknown>) => {
    void startCommand(parseStartOptions(options))
  },
)

// ─── qms init ────────────────────────────────────────────────────────────────

cli
  .command('init', 'Scaffold qms.config.ts and example mock files')
  .action(() => {
    void initCommand()
  })

// ─── qms routes ──────────────────────────────────────────────────────────────

cli
  .command('routes', 'Print a table of all compiled routes')
  .option('--config <path>', 'Path to qms config file')
  .action((options: Record<string, unknown>) => {
    void routesCommand(parseConfigOption(options))
  })

// ─── qms validate ────────────────────────────────────────────────────────────

cli
  .command('validate', 'Validate config and mock files (exits 1 on error)')
  .option('--config <path>', 'Path to qms config file')
  .action((options: Record<string, unknown>) => {
    void validateCommand(parseConfigOption(options))
  })

// ─── Global flags ─────────────────────────────────────────────────────────────

cli.help()
cli.version(VERSION)

cli.parse()
