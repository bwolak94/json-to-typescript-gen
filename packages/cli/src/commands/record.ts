import { createMockServer } from '@quick-mock-server/core'

// ─── Options ─────────────────────────────────────────────────────────────────

export interface RecordOptions {
  target: string
  port?: number
  dir?: string
  mode?: 'record' | 'replay-or-record'
}

// ─── Command ─────────────────────────────────────────────────────────────────

export async function recordCommand(options: RecordOptions): Promise<void> {
  const { target, port = 0, dir, mode = 'record' } = options

  const server = createMockServer({
    port,
    proxy: {
      target,
      mode,
      record: {
        ...(dir !== undefined ? { dir } : {}),
      },
    },
  })

  const { url } = await server.start()

  process.stdout.write(`\n  qms record\n`)
  process.stdout.write(`  ─────────────────────────────────────\n`)
  process.stdout.write(`  Listening  ${url}\n`)
  process.stdout.write(`  Target     ${target}\n`)
  process.stdout.write(`  Mode       ${mode}\n`)
  if (dir) process.stdout.write(`  Fixtures   ${dir}\n`)
  process.stdout.write(`\n`)

  const shutdown = async () => {
    await server.stop()
    process.stdout.write('  Stopped.\n')
    process.exit(0)
  }

  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
}
