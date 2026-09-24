import { Collection, type AnyRecord } from './collection.js'

/**
 * Central registry of named `Collection` instances.
 *
 * Used as `ctx.state` inside mock handlers and CRUD route handlers.
 */
export class StateStore {
  private readonly collections = new Map<string, Collection>()

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

  /** Reset all collections to empty (keeps registrations). */
  reset(): void {
    for (const col of this.collections.values()) {
      col.reset()
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
