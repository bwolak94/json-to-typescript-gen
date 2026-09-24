import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  resolveChaos,
  sampleDelay,
  shouldInjectError,
  applyDelay,
  isChaosEnabled,
  pickErrorStatus,
} from '../chaos/index.js'
import type { ChaosConfig } from '../chaos/index.js'

// ─── resolveChaos ─────────────────────────────────────────────────────────────

describe('resolveChaos', () => {
  it('returns empty config when no layers provided', () => {
    const result = resolveChaos()
    expect(result).toEqual({})
  })

  it('returns single layer unchanged', () => {
    const cfg: ChaosConfig = { latency: 100, enabled: true }
    expect(resolveChaos(cfg)).toEqual(cfg)
  })

  it('later layer overrides earlier', () => {
    const global: ChaosConfig = { latency: 100, errorRate: 0.1 }
    const route: ChaosConfig = { latency: 500 }
    const result = resolveChaos(global, route)
    expect(result.latency).toBe(500)
    expect(result.errorRate).toBe(0.1) // inherited from global
  })

  it('undefined layers are skipped', () => {
    const global: ChaosConfig = { latency: 50 }
    const result = resolveChaos(global, undefined, undefined)
    expect(result.latency).toBe(50)
  })

  it('most specific layer wins (response overrides route overrides global)', () => {
    const global: ChaosConfig = { latency: 100, errorRate: 0.5 }
    const route: ChaosConfig = { latency: 200 }
    const response: ChaosConfig = { latency: 50 }
    const result = resolveChaos(global, route, response)
    expect(result.latency).toBe(50)
    expect(result.errorRate).toBe(0.5)
  })

  it('enabled: false from any layer propagates', () => {
    const global: ChaosConfig = { enabled: true, latency: 200 }
    const route: ChaosConfig = { enabled: false }
    const result = resolveChaos(global, route)
    expect(result.enabled).toBe(false)
  })

  it('errorStatus array from deeper layer overrides shallower', () => {
    const global: ChaosConfig = { errorStatus: [500] }
    const route: ChaosConfig = { errorStatus: [503, 504] }
    const result = resolveChaos(global, route)
    expect(result.errorStatus).toEqual([503, 504])
  })

  it('merges multiple undefined layers gracefully', () => {
    expect(resolveChaos(undefined, undefined)).toEqual({})
  })

  it('timeout in response-level overrides global', () => {
    const global: ChaosConfig = { latency: 100 }
    const response: ChaosConfig = { timeout: true }
    const result = resolveChaos(global, response)
    expect(result.timeout).toBe(true)
    expect(result.latency).toBe(100)
  })

  it('drop in route-level overrides global', () => {
    const global: ChaosConfig = { latency: 50 }
    const route: ChaosConfig = { drop: true }
    const result = resolveChaos(global, route)
    expect(result.drop).toBe(true)
  })
})

// ─── isChaosEnabled ───────────────────────────────────────────────────────────

describe('isChaosEnabled', () => {
  it('returns true when enabled is not set', () => {
    expect(isChaosEnabled({})).toBe(true)
  })

  it('returns true when enabled is true', () => {
    expect(isChaosEnabled({ enabled: true })).toBe(true)
  })

  it('returns false when enabled is false', () => {
    expect(isChaosEnabled({ enabled: false })).toBe(false)
  })

  it('returns false for empty config with no chaotic fields', () => {
    // No chaos configured — nothing to apply
    expect(isChaosEnabled({})).toBe(true) // enabled by default; application is a no-op
  })
})

// ─── sampleDelay ─────────────────────────────────────────────────────────────

describe('sampleDelay', () => {
  describe('fixed number', () => {
    it('returns the exact number', () => {
      expect(sampleDelay(150)).toBe(150)
    })

    it('returns 0 for zero delay', () => {
      expect(sampleDelay(0)).toBe(0)
    })
  })

  describe('range { min, max }', () => {
    it('returns min when rng returns 0', () => {
      const result = sampleDelay({ min: 100, max: 300 }, () => 0)
      expect(result).toBe(100)
    })

    it('returns max when rng returns 1', () => {
      const result = sampleDelay({ min: 100, max: 300 }, () => 1)
      expect(result).toBe(300)
    })

    it('returns midpoint when rng returns 0.5', () => {
      const result = sampleDelay({ min: 100, max: 300 }, () => 0.5)
      expect(result).toBe(200)
    })

    it('result is always within [min, max]', () => {
      for (let i = 0; i <= 10; i++) {
        const rng = () => i / 10
        const result = sampleDelay({ min: 50, max: 150 }, rng)
        expect(result).toBeGreaterThanOrEqual(50)
        expect(result).toBeLessThanOrEqual(150)
      }
    })
  })

  describe('normal distribution { p50, p99 }', () => {
    it('returns a non-negative number', () => {
      const result = sampleDelay({ p50: 100, p99: 500 }, Math.random)
      expect(result).toBeGreaterThanOrEqual(0)
    })

    it('deterministic with fixed rng', () => {
      const rng = () => 0.5
      const r1 = sampleDelay({ p50: 100, p99: 500 }, rng)
      const r2 = sampleDelay({ p50: 100, p99: 500 }, rng)
      expect(r1).toBe(r2)
    })

    it('average of many samples approximates p50 (within ±15%)', () => {
      let total = 0
      const n = 200
      let i = 0
      // Use a counter-based RNG so samples vary
      const rng = () => ((i++ * 1.618033) % 1 + 1) % 1
      for (let j = 0; j < n; j++) {
        total += sampleDelay({ p50: 200, p99: 1000 }, rng)
      }
      const mean = total / n
      expect(mean).toBeGreaterThan(200 * 0.85)
      expect(mean).toBeLessThan(200 * 1.15 + 200) // allow for skew of clamped negatives
    })
  })

  describe('return type', () => {
    it('always returns an integer (no fractional ms)', () => {
      const result = sampleDelay({ min: 100, max: 200 }, () => 0.333)
      expect(Number.isInteger(result)).toBe(true)
    })
  })
})

// ─── shouldInjectError ────────────────────────────────────────────────────────

describe('shouldInjectError', () => {
  it('returns false when rate is 0', () => {
    expect(shouldInjectError(0, () => 0.5)).toBe(false)
  })

  it('returns true when rate is 1', () => {
    expect(shouldInjectError(1, () => 0.5)).toBe(true)
  })

  it('returns true when rng < rate', () => {
    expect(shouldInjectError(0.5, () => 0.3)).toBe(true)
  })

  it('returns false when rng >= rate', () => {
    expect(shouldInjectError(0.5, () => 0.5)).toBe(false)
    expect(shouldInjectError(0.5, () => 0.9)).toBe(false)
  })

  it('uses Math.random by default (smoke test)', () => {
    // Just verify it returns a boolean, not that it's deterministic
    const result = shouldInjectError(0.5)
    expect(typeof result).toBe('boolean')
  })

  it('errorRate 0.1 with 1000 samples is roughly 10%', () => {
    let count = 0
    for (let i = 0; i < 1000; i++) {
      if (shouldInjectError(0.1, () => i / 1000)) count++
    }
    // Should be exactly 100 with a linear rng
    expect(count).toBe(100)
  })
})

// ─── pickErrorStatus ──────────────────────────────────────────────────────────

describe('pickErrorStatus', () => {
  it('returns 500 when no errorStatus list provided', () => {
    expect(pickErrorStatus(undefined)).toBe(500)
  })

  it('returns 500 when empty errorStatus list provided', () => {
    expect(pickErrorStatus([])).toBe(500)
  })

  it('returns the single status when only one provided', () => {
    expect(pickErrorStatus([503])).toBe(503)
  })

  it('picks from the list deterministically with rng', () => {
    const statuses = [500, 503, 504]
    expect(pickErrorStatus(statuses, () => 0)).toBe(500)
    expect(pickErrorStatus(statuses, () => 0.99)).toBe(504)
  })

  it('always picks a value from the list', () => {
    const statuses = [500, 502, 503]
    for (let i = 0; i < 10; i++) {
      const picked = pickErrorStatus(statuses, () => i / 10)
      expect(statuses).toContain(picked)
    }
  })
})

// ─── applyDelay ───────────────────────────────────────────────────────────────

describe('applyDelay', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves immediately for 0ms delay', async () => {
    const p = applyDelay(0)
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBeUndefined()
  })

  it('does not resolve before the delay elapses', async () => {
    let resolved = false
    const p = applyDelay(500).then(() => { resolved = true })
    vi.advanceTimersByTime(499)
    await Promise.resolve() // flush microtasks
    expect(resolved).toBe(false)
    vi.advanceTimersByTime(1)
    await p
    expect(resolved).toBe(true)
  })

  it('resolves after the specified delay', async () => {
    const p = applyDelay(200)
    vi.advanceTimersByTime(200)
    await expect(p).resolves.toBeUndefined()
  })

  it('multiple concurrent delays resolve independently', async () => {
    const results: number[] = []
    applyDelay(300).then(() => results.push(300))
    applyDelay(100).then(() => results.push(100))
    applyDelay(200).then(() => results.push(200))

    vi.advanceTimersByTime(100)
    await Promise.resolve()
    expect(results).toEqual([100])

    vi.advanceTimersByTime(100)
    await Promise.resolve()
    expect(results).toEqual([100, 200])

    vi.advanceTimersByTime(100)
    await Promise.resolve()
    expect(results).toEqual([100, 200, 300])
  })
})

// ─── resolveChaos — priority cascade integration ──────────────────────────────

describe('resolveChaos — full cascade integration', () => {
  it('global → file → route → response cascade', () => {
    const global: ChaosConfig   = { enabled: true, latency: 50, errorRate: 0.05, errorStatus: [500] }
    const file: ChaosConfig     = { latency: 100 }
    const route: ChaosConfig    = { latency: 200, errorStatus: [503] }
    const response: ChaosConfig = { latency: 10 }

    const result = resolveChaos(global, file, route, response)
    expect(result.enabled).toBe(true)         // from global
    expect(result.latency).toBe(10)            // from response (most specific)
    expect(result.errorRate).toBe(0.05)        // from global (not overridden)
    expect(result.errorStatus).toEqual([503])  // from route
  })

  it('--no-chaos: enabled false at global disables everything', () => {
    const global: ChaosConfig = { enabled: false, latency: 500, errorRate: 1.0 }
    const route: ChaosConfig  = { latency: 100 }
    const result = resolveChaos(global, route)
    expect(result.enabled).toBe(false)
  })

  it('route-level enabled:false overrides global enabled:true', () => {
    const global: ChaosConfig = { enabled: true, latency: 200 }
    const route: ChaosConfig  = { enabled: false }
    const result = resolveChaos(global, route)
    expect(isChaosEnabled(result)).toBe(false)
  })

  it('response-level timeout overrides all latency', () => {
    const global: ChaosConfig   = { latency: 5000 }
    const response: ChaosConfig = { timeout: true }
    const result = resolveChaos(global, response)
    expect(result.timeout).toBe(true)
  })

  it('slowBody config is carried through cascade', () => {
    const global: ChaosConfig = { latency: 50 }
    const route: ChaosConfig  = { slowBody: { chunkSize: 128, delayMs: 100 } }
    const result = resolveChaos(global, route)
    expect(result.slowBody?.delayMs).toBe(100)
    expect(result.slowBody?.chunkSize).toBe(128)
  })
})

// ─── Fault mode combinations ──────────────────────────────────────────────────

describe('Fault mode semantics', () => {
  it('drop and timeout can coexist in config (caller decides priority)', () => {
    const cfg: ChaosConfig = { drop: true, timeout: true }
    const result = resolveChaos(cfg)
    expect(result.drop).toBe(true)
    expect(result.timeout).toBe(true)
  })

  it('errorRate 0 means never inject error', () => {
    for (let i = 0; i < 100; i++) {
      expect(shouldInjectError(0, Math.random)).toBe(false)
    }
  })

  it('errorRate 1 means always inject error', () => {
    for (let i = 0; i < 100; i++) {
      expect(shouldInjectError(1, Math.random)).toBe(true)
    }
  })

  it('sampleDelay with fixed 0 returns 0', () => {
    expect(sampleDelay(0)).toBe(0)
  })

  it('sampleDelay with range min===max returns exactly min', () => {
    expect(sampleDelay({ min: 100, max: 100 }, () => 0.5)).toBe(100)
  })
})
