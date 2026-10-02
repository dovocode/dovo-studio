import type { TaskHarness, ModelCatalog } from '@dovo/protocol'

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>
export type ModelLabelHarness = Pick<
  TaskHarness,
  'provider' | 'endpoint' | 'acpInstallationId' | 'model'
>
const storageKey = 'dovo:model-labels:v1'
/** Persist presentation metadata only, never runtime credentials or discovery arguments. */
export function createModelLabels(storage?: Storage) {
  const labels = new Map<string, string>()
  const listeners = new Set<() => void>()
  try {
    const saved: unknown = JSON.parse(storage?.getItem(storageKey) ?? '[]')
    if (Array.isArray(saved))
      for (const entry of saved)
        if (
          Array.isArray(entry) &&
          entry.length === 2 &&
          entry.every((value) => typeof value === 'string')
        )
          labels.set(entry[0], entry[1])
  } catch {
    // Display metadata is optional; discovery can repopulate it.
  }
  const key = (address: string | undefined, harness: ModelLabelHarness, model: string) =>
    JSON.stringify([
      address ?? '',
      harness.provider,
      harness.endpoint ?? '',
      harness.acpInstallationId ?? '',
      model,
    ])
  return {
    subscribe(this: void, listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    get: (address: string | undefined, harness: ModelLabelHarness) =>
      labels.get(key(address, harness, harness.model)),
    save(address: string | undefined, harness: ModelLabelHarness, catalog: ModelCatalog) {
      let changed = false
      for (const model of catalog.models) {
        const modelKey = key(address, harness, model.id)
        if (labels.get(modelKey) !== model.name) {
          labels.set(modelKey, model.name)
          changed = true
        }
      }
      while (labels.size > 1000) {
        const oldest = labels.keys().next().value
        if (oldest !== undefined) {
          labels.delete(oldest)
          changed = true
        }
      }
      try {
        storage?.setItem(storageKey, JSON.stringify([...labels]))
      } catch {
        // Keep labels available in memory when browser storage is unavailable.
      }
      if (changed) for (const listener of listeners) listener()
    },
  }
}
