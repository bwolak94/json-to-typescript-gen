import { readFile } from 'node:fs/promises'
import { resolve, extname } from 'node:path'
import { pathToFileURL } from 'node:url'
import yaml from 'yaml'
import fg from 'fast-glob'
import { MockFileSchema, QmsConfigSchema } from './schema.js'
import { ConfigError, formatParseError, formatZodError } from './errors.js'
import type { MockFileInput, QmsConfig, RawRoute, ResourceConfig } from './schema.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export type RouteOrigin = 'manual' | 'openapi'

export interface LoadedRoute extends RawRoute {
  /** Source file and approximate line number */
  _source: { file: string; line?: number }
  /** Whether this route came from a hand-written file or OpenAPI import */
  _origin: RouteOrigin
}

export interface LoadedFile {
  routes: LoadedRoute[]
  resources: ResourceConfig[]
  file: string
}

// ─── YAML loading ─────────────────────────────────────────────────────────────

function parseYaml(content: string, file: string): unknown {
  const doc = yaml.parseDocument(content)

  if (doc.errors.length > 0) {
    const first = doc.errors[0]
    const pos = first?.pos ? `(offset ${first.pos[0]})` : ''
    throw new ConfigError(
      `YAML parse error ${pos}: ${first?.message ?? 'unknown error'}`,
      file,
    )
  }

  return doc.toJS() as unknown
}

// ─── TS/JS loading via jiti ───────────────────────────────────────────────────

async function loadTsModule(filePath: string): Promise<unknown> {
  // createJiti is async import to avoid top-level await and to support
  // dynamic loading. We import lazily so non-TS files don't pay the cost.
  //
  // Pass a fresh moduleCache ({}) on every call so that hot-reload always
  // re-executes TypeScript handler files instead of returning stale cached
  // modules. The overhead is negligible since loads are infrequent.
  const { createJiti } = await import('jiti')
  const parentUrl = pathToFileURL(filePath).href
  const jiti = createJiti(parentUrl, { moduleCache: false })
  const mod = (await jiti.import(filePath)) as { default?: unknown }
  return mod.default ?? mod
}

// ─── Single mock-file loading ─────────────────────────────────────────────────

/**
 * Load and validate a single mock file (YAML / JSON / TS / JS).
 * Returns the validated MockFileInput or throws ConfigError.
 */
export async function loadMockFile(filePath: string): Promise<MockFileInput> {
  const abs = resolve(filePath)
  const ext = extname(abs).toLowerCase()
  let raw: unknown

  try {
    if (ext === '.yaml' || ext === '.yml') {
      const content = await readFile(abs, 'utf8')
      raw = parseYaml(content, abs)
    } else if (ext === '.json') {
      const content = await readFile(abs, 'utf8')
      raw = JSON.parse(content) as unknown
    } else if (ext === '.ts' || ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      raw = await loadTsModule(abs)
    } else {
      throw new ConfigError(`Unsupported file extension "${ext}"`, abs)
    }
  } catch (err) {
    if (err instanceof ConfigError) throw err
    throw new ConfigError(formatParseError(err, abs), abs)
  }

  // If the module export is an array (from defineRoutes), wrap it
  if (Array.isArray(raw)) {
    raw = { routes: raw }
  }

  const result = MockFileSchema.safeParse(raw)
  if (!result.success) {
    throw new ConfigError(formatZodError(result.error, abs), abs, result.error.issues)
  }

  return result.data
}

// ─── Glob mock files ──────────────────────────────────────────────────────────

/**
 * Find all mock files in `mocksDir`.
 * Excludes node_modules and hidden directories.
 */
export async function findMockFiles(mocksDir: string, cwd = process.cwd()): Promise<string[]> {
  const abs = resolve(cwd, mocksDir)
  const files = await fg(
    ['**/*.{yaml,yml,json,ts,js}'],
    {
      cwd: abs,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
      onlyFiles: true,
    },
  )
  return files.sort() // deterministic order
}

// ─── Config file loading ──────────────────────────────────────────────────────

const CONFIG_CANDIDATES = [
  'qms.config.ts',
  'qms.config.js',
  'qms.config.mjs',
  'qms.config.yaml',
  'qms.config.yml',
  'qms.config.json',
]

/**
 * Find and load the main qms config file.
 * Returns parsed+validated QmsConfig or null if no config file found.
 */
export async function loadConfigFile(
  configFilePath?: string,
  cwd = process.cwd(),
): Promise<{ config: QmsConfig; file: string } | null> {
  let configPath: string | null = null

  if (configFilePath) {
    configPath = resolve(cwd, configFilePath)
  } else {
    for (const candidate of CONFIG_CANDIDATES) {
      const p = resolve(cwd, candidate)
      try {
        await readFile(p) // existence check
        configPath = p
        break
      } catch {
        // not found, try next
      }
    }
  }

  if (!configPath) return null

  const ext = extname(configPath).toLowerCase()
  let raw: unknown

  try {
    if (ext === '.yaml' || ext === '.yml') {
      const content = await readFile(configPath, 'utf8')
      raw = parseYaml(content, configPath)
    } else if (ext === '.json') {
      const content = await readFile(configPath, 'utf8')
      raw = JSON.parse(content) as unknown
    } else {
      // TS/JS — load via jiti
      raw = await loadTsModule(configPath)
    }
  } catch (err) {
    if (err instanceof ConfigError) throw err
    throw new ConfigError(formatParseError(err, configPath), configPath)
  }

  const result = QmsConfigSchema.safeParse(raw)
  if (!result.success) {
    throw new ConfigError(
      formatZodError(result.error, configPath),
      configPath,
      result.error.issues,
    )
  }

  return { config: result.data, file: configPath }
}

// ─── Load all mock files from a directory ────────────────────────────────────

/**
 * Load all mock files from `mocksDir` and return structured results.
 */
export async function loadMockDirectory(
  mocksDir: string,
  cwd = process.cwd(),
  origin: RouteOrigin = 'manual',
): Promise<{ files: LoadedFile[]; errors: ConfigError[] }> {
  const filePaths = await findMockFiles(mocksDir, cwd)
  const files: LoadedFile[] = []
  const errors: ConfigError[] = []

  for (const filePath of filePaths) {
    try {
      const parsed = await loadMockFile(filePath)

      const routes: LoadedRoute[] = parsed.routes.map((r) => ({
        ...r,
        _source: { file: filePath },
        _origin: origin,
      }))

      files.push({ routes, resources: parsed.resources, file: filePath })
    } catch (err) {
      if (err instanceof ConfigError) {
        errors.push(err)
      } else {
        errors.push(new ConfigError(String(err), filePath))
      }
    }
  }

  return { files, errors }
}
