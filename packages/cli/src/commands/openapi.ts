import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, join, basename, extname } from 'node:path'
import { stringify } from 'yaml'
import { importOpenApi, generateJsonSchema } from '@quick-mock-server/core'
import type { RawRoute } from '@quick-mock-server/core'

// ─── Import options ───────────────────────────────────────────────────────────

export interface OpenapiImportOptions {
  spec: string
  out?: string
  seed?: number
}

// ─── Import command ───────────────────────────────────────────────────────────

/**
 * Load an OpenAPI spec and eject each route to an individual YAML file
 * in `--out <dir>` (default: `mocks/`).
 */
export async function openapiImportCommand(options: OpenapiImportOptions): Promise<void> {
  const { spec: specPath, out = 'mocks', seed } = options
  const absSpec = resolve(process.cwd(), specPath)
  const absOut = resolve(process.cwd(), out)

  process.stdout.write(`\n  Importing OpenAPI spec: ${absSpec}\n`)

  let routes: RawRoute[]
  try {
    routes = await importOpenApi(absSpec, seed !== undefined ? { seed } : {})
  } catch (err) {
    process.stderr.write(`  Error: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  }

  await mkdir(absOut, { recursive: true })

  const written: string[] = []
  for (const route of routes) {
    const method = Array.isArray(route.method) ? route.method[0] : route.method
    const slug = route.path.replace(/^\//, '').replace(/\//g, '-').replace(/:/g, '') || 'root'
    const filename = `${(method ?? 'GET').toLowerCase()}-${slug}.yaml`
    const filePath = join(absOut, filename)

    await writeFile(filePath, stringify({ ...route }), 'utf-8')
    written.push(filename)
  }

  process.stdout.write(`  ✓ Wrote ${written.length} route(s) to ${absOut}/\n\n`)
  for (const f of written) {
    process.stdout.write(`    ${f}\n`)
  }
  process.stdout.write('\n')
}

// ─── Schema generation command ────────────────────────────────────────────────

export interface OpenapiSchemaOptions {
  out?: string
}

/**
 * Generate a `schema.json` file from the QMS mock file Zod schema.
 * Used to enable VS Code YAML autocompletion.
 */
export async function openapiSchemaCommand(options: OpenapiSchemaOptions = {}): Promise<void> {
  const outPath = resolve(process.cwd(), options.out ?? 'schema.json')
  const schema = generateJsonSchema()

  // Extract directory, avoid relying on extname for files without extension
  const outDir = outPath.slice(0, outPath.lastIndexOf('/'))
  if (outDir) await mkdir(outDir, { recursive: true })

  await writeFile(outPath, JSON.stringify(schema, null, 2), 'utf-8')
  process.stdout.write(`  ✓ JSON Schema written to ${outPath}\n`)
}
