import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { StateStore } from './store.js'
import type { AnyRecord } from './collection.js'

/**
 * Persist all collection data in a StateStore to a JSON file.
 *
 * The directory is created automatically if it doesn't exist.
 */
export async function persistStore(store: StateStore, filePath: string): Promise<void> {
  const snapshot = store.snapshot()
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(snapshot, null, 2), 'utf8')
}

/**
 * Load previously persisted store data and restore it into the given StateStore.
 *
 * If the file doesn't exist this is a no-op (returns `false`).
 * Returns `true` when data was successfully restored.
 */
export async function loadPersistedStore(
  store: StateStore,
  filePath: string,
): Promise<boolean> {
  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return false
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return false
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return false
  }

  const snap = parsed as Record<string, AnyRecord[]>
  store.restore(snap)
  return true
}
