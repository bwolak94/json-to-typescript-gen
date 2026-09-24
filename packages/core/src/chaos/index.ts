import type { DelaySpec } from '../types.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SlowBodyConfig {
  /** Bytes per chunk (default: 1024). */
  chunkSize?: number
  /** Milliseconds between chunks. */
  delayMs: number
}

export interface ChaosConfig {
  /** Master switch. Defaults to true when not set. */
  enabled?: boolean
  /** Inject latency before the response. */
  latency?: DelaySpec
  /** Probability [0, 1] to return an error status instead of the matched response. */
  errorRate?: number
  /** Error statuses to choose from when `errorRate` triggers. Default: [500]. */
  errorStatus?: number[]
  /** Never send a response — let the client time out. */
  timeout?: boolean
  /** Immediately destroy the socket. */
  drop?: boolean
  /** Stream the response body in chunks with a delay between each. */
  slowBody?: SlowBodyConfig
}

// ─── resolveChaos ─────────────────────────────────────────────────────────────

/**
 * Merge chaos config layers using a last-write-wins cascade.
 * Pass layers from least specific to most specific:
 *   `resolveChaos(global, fileLvl, routeLvl, responseLvl)`
 *
 * Undefined layers are skipped.
 */
export function resolveChaos(...layers: (ChaosConfig | undefined)[]): ChaosConfig {
  const result: ChaosConfig = {}
  for (const layer of layers) {
    if (layer == null) continue
    if (layer.enabled !== undefined) result.enabled = layer.enabled
    if (layer.latency !== undefined) result.latency = layer.latency
    if (layer.errorRate !== undefined) result.errorRate = layer.errorRate
    if (layer.errorStatus !== undefined) result.errorStatus = layer.errorStatus
    if (layer.timeout !== undefined) result.timeout = layer.timeout
    if (layer.drop !== undefined) result.drop = layer.drop
    if (layer.slowBody !== undefined) result.slowBody = layer.slowBody
  }
  return result
}

// ─── isChaosEnabled ───────────────────────────────────────────────────────────

/**
 * Returns `true` unless `config.enabled` is explicitly `false`.
 */
export function isChaosEnabled(config: ChaosConfig): boolean {
  return config.enabled !== false
}

// ─── sampleDelay ─────────────────────────────────────────────────────────────

/**
 * Sample a concrete millisecond delay from a `DelaySpec`.
 *
 * @param spec  Fixed ms, range `{min, max}`, or normal-ish `{p50, p99}`.
 * @param rng   Random number generator in [0, 1). Defaults to `Math.random`.
 *              Pass a deterministic function in tests.
 * @returns     Non-negative integer milliseconds.
 */
export function sampleDelay(spec: DelaySpec, rng: () => number = Math.random): number {
  if (typeof spec === 'number') {
    return Math.max(0, Math.round(spec))
  }

  if ('min' in spec && 'max' in spec) {
    const { min, max } = spec
    return Math.round(min + rng() * (max - min))
  }

  // Normal-ish distribution from p50/p99 using Box-Muller transform.
  // p99 ≈ p50 + 2.326 * σ  →  σ = (p99 - p50) / 2.326
  const { p50, p99 } = spec
  const sigma = (p99 - p50) / 2.326
  const ms = sampleNormal(p50, sigma, rng)
  return Math.max(0, Math.round(ms))
}

/** Box-Muller transform to approximate a normal distribution sample. */
function sampleNormal(mean: number, sigma: number, rng: () => number): number {
  // Use spare value from previous call when available (basic Box-Muller)
  const u1 = Math.max(Number.EPSILON, rng())
  const u2 = rng()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return mean + z * sigma
}

// ─── shouldInjectError ────────────────────────────────────────────────────────

/**
 * Returns `true` with probability `rate` (0 = never, 1 = always).
 *
 * @param rate  Probability in [0, 1].
 * @param rng   RNG in [0, 1). Defaults to `Math.random`.
 */
export function shouldInjectError(rate: number, rng: () => number = Math.random): boolean {
  if (rate <= 0) return false
  if (rate >= 1) return true
  return rng() < rate
}

// ─── pickErrorStatus ─────────────────────────────────────────────────────────

/**
 * Pick a random error status code from `statuses`.
 * Falls back to `500` when the list is empty or undefined.
 *
 * @param statuses  List of HTTP status codes.
 * @param rng       RNG in [0, 1). Defaults to `Math.random`.
 */
export function pickErrorStatus(
  statuses: number[] | undefined,
  rng: () => number = Math.random,
): number {
  if (!statuses || statuses.length === 0) return 500
  const idx = Math.floor(rng() * statuses.length)
  return statuses[idx]!
}

// ─── applyDelay ───────────────────────────────────────────────────────────────

/**
 * Return a promise that resolves after `ms` milliseconds.
 * Uses `setTimeout` so it works with `vi.useFakeTimers()` in tests.
 */
export function applyDelay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}
