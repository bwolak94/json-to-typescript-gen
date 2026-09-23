import { writeFile, mkdir, access } from 'node:fs/promises'
import { join } from 'node:path'
import { printSuccess, printError, printInfo } from '../output.js'

// ─── Scaffold templates ───────────────────────────────────────────────────────

const CONFIG_TEMPLATE = `import { defineConfig } from 'quick-mock-server'

export default defineConfig({
  port: 3999,
  mocksDir: './mocks',
  // cors: true,
  // scenarios: { default: 'happy-path' },
})
`

const EXAMPLE_MOCK = `# Example mock file — edit or delete as needed
routes:
  - method: GET
    path: /hello
    responses:
      - status: 200
        body:
          message: Hello from qms!

  - method: GET
    path: /users
    responses:
      - status: 200
        body:
          - id: 1
            name: Alice
          - id: 2
            name: Bob

  - method: GET
    path: /users/:id
    responses:
      - status: 200
        body:
          id: 1
          name: Alice
      - when:
          params.id: "999"
        status: 404
        body:
          error: User not found
`

// ─── Command ─────────────────────────────────────────────────────────────────

export async function initCommand(): Promise<void> {
  const cwd = process.cwd()
  const configPath = join(cwd, 'qms.config.ts')
  const mocksDir = join(cwd, 'mocks')
  const examplePath = join(mocksDir, 'example.yaml')

  let hasErrors = false

  // ── qms.config.ts ────────────────────────────────────────────────────────
  const configExists = await fileExists(configPath)
  if (configExists) {
    printInfo('qms.config.ts already exists — skipping')
  } else {
    try {
      await writeFile(configPath, CONFIG_TEMPLATE, 'utf8')
      printSuccess('Created qms.config.ts')
    } catch (err) {
      printError(`Failed to create qms.config.ts: ${String(err)}`)
      hasErrors = true
    }
  }

  // ── mocks/ directory ─────────────────────────────────────────────────────
  try {
    await mkdir(mocksDir, { recursive: true })
  } catch (err) {
    printError(`Failed to create mocks/ directory: ${String(err)}`)
    hasErrors = true
  }

  // ── mocks/example.yaml ───────────────────────────────────────────────────
  const exampleExists = await fileExists(examplePath)
  if (exampleExists) {
    printInfo('mocks/example.yaml already exists — skipping')
  } else {
    try {
      await writeFile(examplePath, EXAMPLE_MOCK, 'utf8')
      printSuccess('Created mocks/example.yaml')
    } catch (err) {
      printError(`Failed to create mocks/example.yaml: ${String(err)}`)
      hasErrors = true
    }
  }

  if (!hasErrors) {
    console.log()
    printInfo('Run ' + '`qms start`' + ' to start the server')
  }

  if (hasErrors) process.exit(1)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}
