/**
 * ScenarioManager — holds the globally active scenario name and resolves the
 * effective scenario for a given request.
 *
 * Activation priority (highest first):
 *   1. `X-Mock-Scenario` request header  → per-request, no global state change
 *   2. Global active scenario (set via Admin API / CLI `--scenario`)
 *   3. Default scenario from config (`scenarios.default`)
 */
export class ScenarioManager {
  private current: string

  constructor(defaultScenario = '') {
    this.current = defaultScenario
  }

  /** Currently active global scenario name. */
  get active(): string {
    return this.current
  }

  /** Set the globally active scenario. Instant — no restart needed. */
  set(name: string): void {
    this.current = name
  }

  /** Reset to a default (empty string when omitted). */
  reset(defaultScenario = ''): void {
    this.current = defaultScenario
  }

  /**
   * Resolve the effective scenario for a specific request.
   *
   * When the request carries an `X-Mock-Scenario` header it is used as a
   * one-shot override without touching the global state.
   */
  resolve(headerOverride: string | undefined): string {
    return headerOverride ?? this.current
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Extract the value of the `X-Mock-Scenario` header from a raw headers map.
 * Returns `undefined` when absent.
 */
export function extractScenarioHeader(
  headers: Record<string, string | string[]>,
): string | undefined {
  const lower = 'x-mock-scenario'
  for (const [key, val] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return Array.isArray(val) ? val[0] : val
    }
  }
  return undefined
}

/**
 * Determine whether `activeScenario` satisfies a route-level scenario allowlist.
 *
 * Rules:
 * - If `routeScenarios` is empty / undefined the route participates in ALL scenarios.
 * - Otherwise the active scenario must appear in the list.
 */
export function routeMatchesScenario(
  routeScenarios: string[] | undefined,
  activeScenario: string,
): boolean {
  if (!routeScenarios || routeScenarios.length === 0) return true
  return routeScenarios.includes(activeScenario)
}
