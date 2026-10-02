import type { TaskHarness, ModelCatalog } from '@dovo/protocol'

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>
const storageKey = 'dovo:model-labels:v1'
/** Persist presentation metadata only, never runtime credentials or discovery arguments. */
export function createModelLabels(storage?: Storage) {
  const labels = new Map<string, string>()
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
  const key = (address: string | undefined, harness: TaskHarness, model: string) =>
    JSON.stringify([
      address ?? '',
      harness.provider,
      harness.endpoint ?? '',
      harness.acpInstallationId ?? '',
      model,
    ])
  return {
    get: (address: string | undefined, harness: TaskHarness) =>
      labels.get(key(address, harness, harness.model)),
    save(address: string | undefined, harness: TaskHarness, catalog: ModelCatalog) {
      for (const model of catalog.models) labels.set(key(address, harness, model.id), model.name)
      while (labels.size > 1000) {
        const oldest = labels.keys().next().value
        if (oldest !== undefined) labels.delete(oldest)
      }
      try {
        storage?.setItem(storageKey, JSON.stringify([...labels]))
      } catch {
        // Keep labels available in memory when browser storage is unavailable.
      }
    },
  }
}
