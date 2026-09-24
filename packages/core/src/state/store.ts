import { Collection, type AnyRecord } from './collection.js'
import { ScenarioManager } from './scenarios.js'

/**
 * Central registry of named `Collection` instances plus the active scenario.
 *
 * Used as `ctx.state` inside mock handlers and CRUD route handlers.
 */
export class StateStore {
  private readonly collections = new Map<string, Collection>()

  /** Manages the globally active scenario name. */
  readonly scenarios: ScenarioManager

  constructor(defaultScenario = '') {
    this.scenarios = new ScenarioManager(defaultScenario)
  }

  /** Get (or lazily create) a collection by name. */
  collection(name: string): Collection {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Collection('id'))
    }
    return this.collections.get(name)!
  }

  /** Register a pre-built collection (e.g. after seeding). */
  register(name: string, col: Collection): void {
    this.collections.set(name, col)
  }

  /**
   * Reset all collections to empty and optionally reset the active scenario.
   *
   * @param defaultScenario  When provided, resets the active scenario to this
   *   value (pass `''` to clear). When omitted, the scenario is left unchanged.
   */
  reset(defaultScenario?: string): void {
    for (const col of this.collections.values()) {
      col.reset()
    }
    if (defaultScenario !== undefined) {
      this.scenarios.reset(defaultScenario)
    }
  }

  /** Snapshot all collection data as a plain object. */
  snapshot(): Record<string, AnyRecord[]> {
    const result: Record<string, AnyRecord[]> = {}
    for (const [name, col] of this.collections) {
      result[name] = col.toArray()
    }
    return result
  }

  /** Restore collections from a previously taken snapshot. */
  restore(snap: Record<string, AnyRecord[]>): void {
    for (const [name, items] of Object.entries(snap)) {
      this.collection(name).reset(items)
    }
  }

  /** Names of all registered collections. */
  collectionNames(): string[] {
    return [...this.collections.keys()]
  }
}
