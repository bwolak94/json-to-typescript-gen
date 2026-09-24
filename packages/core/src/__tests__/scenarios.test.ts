import { describe, it, expect, beforeEach } from 'vitest'
import { ScenarioManager, extractScenarioHeader, routeMatchesScenario } from '../state/scenarios.js'
import { StateStore } from '../state/store.js'
import { matchResponse } from '../matcher/matcher.js'
import type { CompiledResponse, MockRequest } from '../types.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(headers: Record<string, string> = {}): MockRequest {
  return {
    method: 'GET',
    path: '/test',
    params: {},
    query: {},
    headers,
    body: {},
  }
}

function makeResponse(scenario?: string, status = 200): CompiledResponse {
  const res: CompiledResponse = { status, headers: {}, body: null }
  if (scenario !== undefined) res.scenario = scenario
  return res
}

// ─── ScenarioManager ─────────────────────────────────────────────────────────

describe('ScenarioManager', () => {
  describe('constructor', () => {
    it('defaults to empty string when no default provided', () => {
      const mgr = new ScenarioManager()
      expect(mgr.active).toBe('')
    })

    it('uses provided default scenario', () => {
      const mgr = new ScenarioManager('happy')
      expect(mgr.active).toBe('happy')
    })
  })

  describe('set', () => {
    it('updates the active scenario', () => {
      const mgr = new ScenarioManager()
      mgr.set('payment-failed')
      expect(mgr.active).toBe('payment-failed')
    })

    it('allows switching back to empty string', () => {
      const mgr = new ScenarioManager('happy')
      mgr.set('')
      expect(mgr.active).toBe('')
    })

    it('can switch between multiple scenarios', () => {
      const mgr = new ScenarioManager('happy')
      mgr.set('error')
      expect(mgr.active).toBe('error')
      mgr.set('happy')
      expect(mgr.active).toBe('happy')
    })
  })

  describe('reset', () => {
    it('resets to empty string by default', () => {
      const mgr = new ScenarioManager('happy')
      mgr.set('error')
      mgr.reset()
      expect(mgr.active).toBe('')
    })

    it('resets to provided default', () => {
      const mgr = new ScenarioManager()
      mgr.set('error')
      mgr.reset('happy')
      expect(mgr.active).toBe('happy')
    })
  })

  describe('resolve', () => {
    it('returns global scenario when no header override', () => {
      const mgr = new ScenarioManager('happy')
      expect(mgr.resolve(undefined)).toBe('happy')
    })

    it('returns header value when provided', () => {
      const mgr = new ScenarioManager('happy')
      expect(mgr.resolve('error')).toBe('error')
    })

    it('does not change global state when header override used', () => {
      const mgr = new ScenarioManager('happy')
      mgr.resolve('error')
      expect(mgr.active).toBe('happy')
    })
  })
})

// ─── extractScenarioHeader ────────────────────────────────────────────────────

describe('extractScenarioHeader', () => {
  it('returns undefined when header absent', () => {
    expect(extractScenarioHeader({})).toBeUndefined()
  })

  it('extracts exact case header', () => {
    expect(extractScenarioHeader({ 'x-mock-scenario': 'error' })).toBe('error')
  })

  it('extracts header case-insensitively', () => {
    expect(extractScenarioHeader({ 'X-Mock-Scenario': 'locked' })).toBe('locked')
  })

  it('returns first value for array header', () => {
    expect(extractScenarioHeader({ 'x-mock-scenario': ['first', 'second'] })).toBe('first')
  })
})

// ─── routeMatchesScenario ─────────────────────────────────────────────────────

describe('routeMatchesScenario', () => {
  it('returns true when no routeScenarios defined', () => {
    expect(routeMatchesScenario(undefined, 'any-scenario')).toBe(true)
  })

  it('returns true when routeScenarios is empty', () => {
    expect(routeMatchesScenario([], 'any-scenario')).toBe(true)
  })

  it('returns true when active scenario is in the list', () => {
    expect(routeMatchesScenario(['happy', 'error'], 'happy')).toBe(true)
  })

  it('returns false when active scenario is not in the list', () => {
    expect(routeMatchesScenario(['happy', 'error'], 'locked')).toBe(false)
  })

  it('returns false when active scenario is empty and not in list', () => {
    expect(routeMatchesScenario(['happy'], '')).toBe(false)
  })
})

// ─── StateStore scenario integration ─────────────────────────────────────────

describe('StateStore — scenario management', () => {
  let store: StateStore

  beforeEach(() => {
    store = new StateStore()
  })

  it('initializes with empty scenario by default', () => {
    expect(store.scenarios.active).toBe('')
  })

  it('initializes with provided default scenario', () => {
    const s = new StateStore('happy')
    expect(s.scenarios.active).toBe('happy')
  })

  it('scenario can be set via scenarios.set()', () => {
    store.scenarios.set('payment-failed')
    expect(store.scenarios.active).toBe('payment-failed')
  })

  it('reset() without argument does not reset scenario', () => {
    store.scenarios.set('locked')
    store.reset()
    expect(store.scenarios.active).toBe('locked')
  })

  it('reset() with argument resets scenario', () => {
    store.scenarios.set('locked')
    store.reset('happy')
    expect(store.scenarios.active).toBe('happy')
  })

  it('reset() with empty string clears scenario', () => {
    store.scenarios.set('locked')
    store.reset('')
    expect(store.scenarios.active).toBe('')
  })

  it('collections are reset independently of scenario reset', () => {
    store.collection('users').insert({ id: '1' })
    store.scenarios.set('error')
    store.reset()
    expect(store.collection('users').size()).toBe(0)
    expect(store.scenarios.active).toBe('error') // not reset
  })
})

// ─── matchResponse — scenario filtering ──────────────────────────────────────

describe('matchResponse — per-response scenario', () => {
  it('matches response with no scenario constraint in any scenario', () => {
    const responses = [makeResponse(undefined, 200)]
    const result = matchResponse(responses, makeReq(), 'happy')
    expect(result?.status).toBe(200)
  })

  it('skips response whose scenario does not match active scenario', () => {
    const responses = [makeResponse('error', 500), makeResponse(undefined, 200)]
    const result = matchResponse(responses, makeReq(), 'happy')
    expect(result?.status).toBe(200)
  })

  it('matches response whose scenario matches active scenario', () => {
    const responses = [makeResponse('error', 500), makeResponse(undefined, 200)]
    const result = matchResponse(responses, makeReq(), 'error')
    expect(result?.status).toBe(500)
  })

  it('returns undefined when no response matches', () => {
    const responses = [makeResponse('error', 500)]
    const result = matchResponse(responses, makeReq(), 'happy')
    expect(result).toBeUndefined()
  })
})

describe('matchResponse — X-Mock-Scenario header override', () => {
  it('uses header scenario instead of global', () => {
    const responses = [makeResponse('locked', 423), makeResponse(undefined, 200)]
    const req = makeReq({ 'x-mock-scenario': 'locked' })
    const result = matchResponse(responses, req, 'happy')
    expect(result?.status).toBe(423)
  })

  it('does not change global scenario when header is used', () => {
    const store = new StateStore('happy')
    const responses = [makeResponse('locked', 423), makeResponse(undefined, 200)]
    const req = makeReq({ 'x-mock-scenario': 'locked' })
    matchResponse(responses, req, store.scenarios.active)
    // Global state must remain 'happy'
    expect(store.scenarios.active).toBe('happy')
  })

  it('header override is case-insensitive', () => {
    const responses = [makeResponse('locked', 423), makeResponse(undefined, 200)]
    const req = makeReq({ 'X-Mock-Scenario': 'locked' })
    const result = matchResponse(responses, req, 'happy')
    expect(result?.status).toBe(423)
  })
})

describe('matchResponse — route-level scenarios allowlist', () => {
  it('matches when routeScenarios is undefined (participates in all)', () => {
    const responses = [makeResponse(undefined, 200)]
    const result = matchResponse(responses, makeReq(), 'any', undefined)
    expect(result?.status).toBe(200)
  })

  it('matches when routeScenarios is empty (participates in all)', () => {
    const responses = [makeResponse(undefined, 200)]
    const result = matchResponse(responses, makeReq(), 'any', [])
    expect(result?.status).toBe(200)
  })

  it('matches when active scenario is in routeScenarios', () => {
    const responses = [makeResponse(undefined, 200)]
    const result = matchResponse(responses, makeReq(), 'happy', ['happy', 'error'])
    expect(result?.status).toBe(200)
  })

  it('returns undefined when active scenario is NOT in routeScenarios', () => {
    const responses = [makeResponse(undefined, 200)]
    const result = matchResponse(responses, makeReq(), 'locked', ['happy', 'error'])
    expect(result).toBeUndefined()
  })

  it('X-Mock-Scenario header is used for route-level check too', () => {
    const responses = [makeResponse(undefined, 200)]
    const req = makeReq({ 'x-mock-scenario': 'happy' })
    const result = matchResponse(responses, req, 'locked', ['happy', 'error'])
    expect(result?.status).toBe(200)
  })

  it('route-level filter blocks even when response has no scenario constraint', () => {
    const responses = [makeResponse(undefined, 200), makeResponse(undefined, 201)]
    const result = matchResponse(responses, makeReq(), 'other', ['happy'])
    expect(result).toBeUndefined()
  })
})

// ─── Full scenario lifecycle ──────────────────────────────────────────────────

describe('Full scenario lifecycle', () => {
  it('switching scenario changes which response is returned', () => {
    const store = new StateStore('happy')
    const responses = [
      makeResponse('happy', 200),
      makeResponse('error', 500),
    ]

    const r1 = matchResponse(responses, makeReq(), store.scenarios.active)
    expect(r1?.status).toBe(200)

    store.scenarios.set('error')
    const r2 = matchResponse(responses, makeReq(), store.scenarios.active)
    expect(r2?.status).toBe(500)
  })

  it('per-request header does not affect subsequent requests', () => {
    const store = new StateStore('happy')
    const responses = [
      makeResponse('happy', 200),
      makeResponse('locked', 423),
    ]

    // First request uses header override
    const r1 = matchResponse(responses, makeReq({ 'x-mock-scenario': 'locked' }), store.scenarios.active)
    expect(r1?.status).toBe(423)

    // Second request uses global state (unchanged)
    const r2 = matchResponse(responses, makeReq(), store.scenarios.active)
    expect(r2?.status).toBe(200)
  })

  it('Admin API style: instant scenario switch without restart', () => {
    const store = new StateStore()
    store.scenarios.set('checkout-empty')

    const responses = [
      makeResponse('checkout-empty', 200),
      makeResponse('payment-failed', 402),
    ]

    expect(matchResponse(responses, makeReq(), store.scenarios.active)?.status).toBe(200)

    // Simulate Admin API PUT /__admin/scenario
    store.scenarios.set('payment-failed')

    expect(matchResponse(responses, makeReq(), store.scenarios.active)?.status).toBe(402)
  })
})
