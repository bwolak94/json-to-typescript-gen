import { createHmac } from 'node:crypto'
import { randomUUID } from 'node:crypto'
import { Faker, en } from '@faker-js/faker'

// ─── Public types ─────────────────────────────────────────────────────────────

export interface TemplateContext {
  params: Record<string, string>
  query: Record<string, string | string[]>
  headers: Record<string, string | string[]>
  body: unknown
  state: unknown
}

export interface RenderOptions {
  /** Global faker seed (from qms config). Default: 42 */
  globalSeed: number
  /** Route ID used to derive per-request seed */
  routeId: string
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Render a response body value, replacing every `{{ expr }}` expression.
 *
 * - Objects and arrays are recursively rendered.
 * - When the **entire** string value is a single `{{ expr }}`, the result
 *   is returned with its native type (number / boolean / object / array),
 *   not coerced to string.
 * - A single seeded Faker instance is shared across the whole render call
 *   for reproducible output.
 */
export function renderBody(
  body: unknown,
  ctx: TemplateContext,
  opts: RenderOptions,
): unknown {
  const faker = createSeededFaker(opts.globalSeed, opts.routeId, ctx.params)
  return renderValue(body, ctx, faker)
}

// ─── Seeding ──────────────────────────────────────────────────────────────────

export function createSeededFaker(
  globalSeed: number,
  routeId: string,
  params: Record<string, string>,
): Faker {
  const paramStr = Object.entries(params)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',')
  const seed = djb2(`${globalSeed}:${routeId}:${paramStr}`)
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

// ─── Recursive renderer ───────────────────────────────────────────────────────

function renderValue(value: unknown, ctx: TemplateContext, faker: Faker): unknown {
  if (typeof value === 'string') return renderString(value, ctx, faker)
  if (Array.isArray(value)) return value.map((v) => renderValue(v, ctx, faker))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = renderValue(v, ctx, faker)
    }
    return out
  }
  return value
}

/**
 * Render a single template string.
 * If the whole string is `{{ expr }}`, the native evaluated type is returned.
 * Otherwise every `{{ expr }}` is replaced inline and the result is a string.
 */
function renderString(template: string, ctx: TemplateContext, faker: Faker): unknown {
  // Whole-value template → preserve native type
  // Use tempered greedy token to prevent matching past the first `}}`
  const whole = /^\{\{\s*((?:(?!\}\})[\s\S])*?)\s*\}\}$/.exec(template)
  if (whole) {
    return evaluate(whole[1]!.trim(), ctx, faker)
  }

  // Partial template → inline substitution (always string result)
  return template.replace(/\{\{\s*([\s\S]*?)\s*\}\}/g, (_, expr: string) => {
    const result = evaluate(expr.trim(), ctx, faker)
    return result == null ? '' : String(result)
  })
}

// ─── Expression evaluator (no eval / new Function) ────────────────────────────

function evaluate(expr: string, ctx: TemplateContext, faker: Faker): unknown {
  const tokens = expr.split(/\s+/).filter(Boolean)
  const cmd = tokens[0] ?? ''

  // ── Path lookups ────────────────────────────────────────────────────────────
  if (/^(params|query|headers|body|state)\./.test(cmd) && tokens.length === 1) {
    const val = resolvePath(cmd, ctx)
    // Missing path collapses to empty string (undefined is not a useful template value)
    return val !== undefined ? val : ''
  }

  // ── Faker ───────────────────────────────────────────────────────────────────
  if (cmd.startsWith('faker.')) {
    return callFaker(cmd, tokens.slice(1), faker)
  }

  // ── Built-in helpers ────────────────────────────────────────────────────────
  switch (cmd) {
    case 'now':
      return Date.now()

    case 'uuid':
      return randomUUID()

    case 'random': {
      const min = Number(tokens[1] ?? 0)
      const max = Number(tokens[2] ?? 1)
      return faker.number.int({ min, max })
    }

    case 'jwt':
      return buildJwt(tokens.slice(1), faker)

    case 'repeat': {
      const n = Math.max(0, Math.floor(Number(tokens[1] ?? 1)))
      return Array.from({ length: n }, () => ({}))
    }

    case 'pick': {
      // {{ pick val1 val2 val3 … }}  OR  {{ pick path.to.array }}
      if (tokens.length >= 2) {
        const first = tokens[1]!
        // If single arg looks like a path, resolve it
        if (tokens.length === 2 && /^(params|query|headers|body|state)\./.test(first)) {
          const arr = resolvePath(first, ctx)
          if (Array.isArray(arr) && arr.length > 0) {
            return arr[faker.number.int({ min: 0, max: arr.length - 1 })]
          }
          return undefined
        }
        // Otherwise pick from inline list
        const choices = tokens.slice(1)
        return choices[faker.number.int({ min: 0, max: choices.length - 1 })]
      }
      return undefined
    }

    case 'upper': {
      // {{ upper someExpr }}
      const inner = tokens.slice(1).join(' ')
      const val = inner ? evaluate(inner, ctx, faker) : undefined
      return typeof val === 'string' ? val.toUpperCase() : val
    }

    case 'default': {
      // {{ default pathOrExpr fallbackValue }}
      // First token after 'default' is the primary expression; last token is fallback
      if (tokens.length < 3) return tokens[1] ?? undefined
      const primaryExpr = tokens.slice(1, -1).join(' ')
      const fallback = tokens[tokens.length - 1]
      const primary = evaluate(primaryExpr, ctx, faker)
      return primary != null && primary !== '' ? primary : fallback
    }

    default:
      // Unknown → return expr as literal string
      return expr
  }
}

// ─── Path resolver ────────────────────────────────────────────────────────────

function resolvePath(path: string, ctx: TemplateContext): unknown {
  const [root, ...parts] = path.split('.')
  let current: unknown
  switch (root) {
    case 'params':  current = ctx.params;  break
    case 'query':   current = ctx.query;   break
    case 'headers': current = ctx.headers; break
    case 'body':    current = ctx.body;    break
    case 'state':   current = ctx.state;   break
    default: return undefined
  }
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

// ─── Faker caller ─────────────────────────────────────────────────────────────

function callFaker(path: string, extraArgs: string[], faker: Faker): unknown {
  // path: "faker.person.firstName"
  const dotParts = path.split('.')
  if (dotParts.length < 3) return undefined
  const [, moduleName, methodName] = dotParts
  if (!moduleName || !methodName) return undefined

  const fakerAny = faker as unknown as Record<string, unknown>
  const mod = fakerAny[moduleName]
  if (!mod || typeof mod !== 'object') return undefined

  const fn = (mod as Record<string, unknown>)[methodName]
  if (typeof fn !== 'function') return undefined

  try {
    if (
      extraArgs.length === 2 &&
      !isNaN(Number(extraArgs[0])) &&
      !isNaN(Number(extraArgs[1]))
    ) {
      return (fn as (o: { min: number; max: number }) => unknown).call(mod, {
        min: Number(extraArgs[0]),
        max: Number(extraArgs[1]),
      })
    }
    if (extraArgs.length === 1) {
      return (fn as (a: string) => unknown).call(mod, extraArgs[0]!)
    }
    return (fn as () => unknown).call(mod)
  } catch {
    return undefined
  }
}

// ─── JWT builder ─────────────────────────────────────────────────────────────

const JWT_SECRET = 'qms-template-secret'

function buildJwt(args: string[], faker: Faker): string {
  const kv: Record<string, string> = {}
  for (const arg of args) {
    const eq = arg.indexOf('=')
    if (eq !== -1) kv[arg.slice(0, eq)] = arg.slice(eq + 1)
  }

  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'HS256', typ: 'JWT' }
  const payload = {
    sub: kv['sub'] ?? faker.string.uuid(),
    iat: now,
    exp: now + Number(kv['exp'] ?? 3600),
    ...(kv['iss'] ? { iss: kv['iss'] } : {}),
  }

  const b64h = Buffer.from(JSON.stringify(header)).toString('base64url')
  const b64p = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', JWT_SECRET)
    .update(`${b64h}.${b64p}`)
    .digest('base64url')

  return `${b64h}.${b64p}.${sig}`
}
