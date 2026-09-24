import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Faker, en } from '@faker-js/faker'
import { Collection, type AnyRecord } from './collection.js'
import type { ResourceConfig } from '../config/index.js'

/**
 * Populate a Collection from a `seed` config entry.
 *
 * Two seed modes are supported:
 *  - `{ count, fixture }` – load items from a JSON file on disk.
 *  - `{ count, schema }` – generate items by evaluating template expressions
 *    with a seeded Faker instance.
 *
 * If no seed config is present this is a no-op.
 */
export async function seedCollection(
  config: ResourceConfig,
  col: Collection,
  globalSeed: number,
  mocksDir: string,
): Promise<void> {
  if (!config.seed) return

  if ('fixture' in config.seed && config.seed.fixture) {
    const filePath = resolve(mocksDir, config.seed.fixture)
    const raw = await readFile(filePath, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    const items = Array.isArray(parsed) ? parsed : [parsed]
    col.reset(items as AnyRecord[])
    return
  }

  if ('schema' in config.seed && config.seed.schema) {
    const seed = config.seed
    const faker = makeSeededFaker(globalSeed, config.name)
    const items: AnyRecord[] = Array.from({ length: seed.count }, (_, i) =>
      generateItem(seed.schema as Record<string, unknown>, faker, i),
    )
    col.reset(items)
  }
}

// ─── Schema-driven generation ────────────────────────────────────────────────

/**
 * Generate a single item by evaluating each value in the schema.
 * Values may be template expressions (`{{ faker.internet.email }}`) or
 * static values (returned as-is).
 */
function generateItem(
  schema: Record<string, unknown>,
  faker: Faker,
  index: number,
): AnyRecord {
  const item: AnyRecord = { _index: index }
  for (const [key, value] of Object.entries(schema)) {
    item[key] = evaluateSchemaValue(value, faker)
  }
  delete item['_index']
  return item
}

function evaluateSchemaValue(value: unknown, faker: Faker): unknown {
  if (typeof value === 'string') {
    // Whole-value template
    const whole = /^\{\{\s*((?:(?!\}\})[\s\S])*?)\s*\}\}$/.exec(value)
    if (whole) {
      return evaluateFakerExpr(whole[1]!.trim(), faker)
    }
    // Inline substitution
    return value.replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (_, expr: string) => {
      const result = evaluateFakerExpr(expr.trim(), faker)
      return result == null ? '' : String(result)
    })
  }
  if (Array.isArray(value)) {
    return value.map((v) => evaluateSchemaValue(v, faker))
  }
  if (value !== null && typeof value === 'object') {
    const out: AnyRecord = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = evaluateSchemaValue(v, faker)
    }
    return out
  }
  return value
}

/**
 * Evaluate a single faker expression such as `faker.internet.email` or
 * static helpers like `uuid`, `now`.
 */
function evaluateFakerExpr(expr: string, faker: Faker): unknown {
  const tokens = expr.split(/\s+/).filter(Boolean)
  const cmd = tokens[0] ?? ''

  if (cmd.startsWith('faker.')) {
    const parts = cmd.split('.')
    if (parts.length < 3) return undefined
    const [, moduleName, methodName] = parts
    if (!moduleName || !methodName) return undefined
    const fakerAny = faker as unknown as Record<string, unknown>
    const mod = fakerAny[moduleName]
    if (!mod || typeof mod !== 'object') return undefined
    const fn = (mod as Record<string, unknown>)[methodName]
    if (typeof fn !== 'function') return undefined
    try {
      return (fn as () => unknown).call(mod)
    } catch {
      return undefined
    }
  }

  if (cmd === 'uuid') {
    return faker.string.uuid()
  }

  if (cmd === 'now') {
    return Date.now()
  }

  if (cmd === 'random') {
    const min = Number(tokens[1] ?? 0)
    const max = Number(tokens[2] ?? 1)
    return faker.number.int({ min, max })
  }

  // Fallback: return expr as literal
  return expr
}

// ─── Faker seeding ────────────────────────────────────────────────────────────

function makeSeededFaker(globalSeed: number, resourceName: string): Faker {
  const seed = djb2(`${globalSeed}:resource:${resourceName}`)
  const f = new Faker({ locale: [en] })
  f.seed(seed)
  return f
}

function djb2(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ (s.charCodeAt(i) | 0)
    h |= 0
  }
  return Math.abs(h)
}
