type Storage = {
  getItem: (key: string) => Promise<string | null>
  setItem: (key: string, value: string) => Promise<void>
  removeItem: (key: string) => Promise<void>
}

/** A reopened thread must wait for saves owned by its previous screen. */
export function createDraftStorage(storage: Storage) {
  const pending = new Map<string, Promise<void>>()
  const listeners = new Map<string, Set<(value: string) => void>>()
  const enqueue = <Result>(key: string, work: () => Promise<Result>) => {
    const operation = (pending.get(key) ?? Promise.resolve()).then(work)
    // Return the original failure to its caller, but allow later operations to recover.
    const settled = operation.then(
      () => undefined,
      () => undefined,
    )
    pending.set(key, settled)
    void settled.then(() => {
      if (pending.get(key) === settled) pending.delete(key)
    })
    return operation
  }
  return {
    subscribe(key: string, listener: (value: string) => void) {
      const subscribers = listeners.get(key) ?? new Set<(value: string) => void>()
      subscribers.add(listener)
      listeners.set(key, subscribers)
      return () => {
        subscribers.delete(listener)
        if (!subscribers.size) listeners.delete(key)
      }
    },
    read: (key: string, legacyKey?: string) =>
      enqueue(key, async () => {
        const value = await storage.getItem(key)
        if (value !== null || !legacyKey) return value
        const legacy = await storage.getItem(legacyKey)
        if (legacy !== null) {
          await storage.setItem(key, legacy)
          await storage.removeItem(legacyKey)
        }
        return legacy
      }),
    write: (key: string, value: string) => {
      // A previous screen's successful send must also clear a reopened composer's draft.
      listeners.get(key)?.forEach((listener) => listener(value))
      return enqueue(key, () => storage.setItem(key, value))
    },
  }
}
