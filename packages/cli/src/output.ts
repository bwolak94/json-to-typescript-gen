import pc from 'picocolors'
import type { LoadedRoute } from '@quick-mock-server/core'

// ─── Banner ───────────────────────────────────────────────────────────────────

export function printBanner(version: string): void {
  console.log()
  console.log(`  ${pc.bold(pc.cyan('qms'))} ${pc.dim(`v${version}`)}  ${pc.dim('quick-mock-server')}`)
  console.log()
}

// ─── Startup info ─────────────────────────────────────────────────────────────

export function printStartupInfo(opts: {
  url: string
  port: number
  scenario: string | undefined
  routeCount: number
  watch: boolean
  warnings: string[]
}): void {
  console.log(`  ${pc.green('✔')} Listening on ${pc.bold(pc.underline(opts.url))}`)
  if (opts.scenario) {
    console.log(`  ${pc.dim('Scenario')}  ${pc.yellow(opts.scenario)}`)
  } else {
    console.log(`  ${pc.dim('Scenario')}  ${pc.dim('(none)')}`)
  }
  console.log(`  ${pc.dim('Routes')}    ${opts.routeCount}`)
  if (opts.watch) {
    console.log(`  ${pc.dim('Watch')}     ${pc.cyan('enabled')}`)
  }
  console.log()

  for (const w of opts.warnings) {
    console.warn(`  ${pc.yellow('⚠')}  ${pc.yellow(w)}`)
  }
  if (opts.warnings.length > 0) console.log()
}

export function printReload(routeCount: number): void {
  console.log(`  ${pc.cyan('↺')} Hot reload — ${routeCount} route(s) loaded`)
}

export function printStopped(): void {
  console.log()
  console.log(`  ${pc.dim('qms stopped')}`)
}

// ─── Route table ─────────────────────────────────────────────────────────────

export function printRouteTable(routes: LoadedRoute[], cwd = process.cwd()): void {
  if (routes.length === 0) {
    console.log(`  ${pc.dim('No routes loaded.')}`)
    console.log()
    return
  }

  const rows = routes.map((r) => {
    const methods = Array.isArray(r.method) ? r.method.join(',') : r.method
    const rel = r._source.file.startsWith(cwd)
      ? r._source.file.slice(cwd.length).replace(/^\//, '')
      : r._source.file
    return [methods, r.path, rel, r._origin]
  })

  const headers = ['Method', 'Path', 'Source', 'Origin']
  printTable(headers, rows)
}

// ─── Generic table ────────────────────────────────────────────────────────────

export function printTable(headers: string[], rows: string[][]): void {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)),
  )

  const separator = colWidths.map((w) => '─'.repeat(w)).join('  ')

  const pad = (s: string, w: number) => s + ' '.repeat(Math.max(0, w - s.length))

  console.log('  ' + headers.map((h, i) => pc.bold(pad(h, colWidths[i] ?? h.length))).join('  '))
  console.log('  ' + separator)
  for (const row of rows) {
    const [method, ...rest] = row
    const coloredMethod = method ? pc.cyan(pad(method, colWidths[0] ?? method.length)) : ''
    const restCells = rest.map((cell, i) => pad(cell, colWidths[i + 1] ?? cell.length))
    console.log('  ' + [coloredMethod, ...restCells].join('  '))
  }
  console.log()
}

// ─── Error output ─────────────────────────────────────────────────────────────

export function printError(message: string): void {
  console.error(`  ${pc.red('✖')} ${pc.red(message)}`)
}

export function printSuccess(message: string): void {
  console.log(`  ${pc.green('✔')} ${message}`)
}

export function printInfo(message: string): void {
  console.log(`  ${pc.dim('·')} ${message}`)
}
