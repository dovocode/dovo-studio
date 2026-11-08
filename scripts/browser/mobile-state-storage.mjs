import { jsonStateStorage } from '@dovo/durable-connections'

// Browser adapter for the two native durable files. Keep real serialization and state logic.
const storage = (key) =>
  jsonStateStorage({
    read: () => localStorage.getItem(key),
    write: (value) => localStorage.setItem(key, value),
    update: async (change) => {
      const next = change(localStorage.getItem(key))
      localStorage.setItem(key, next)
      return next
    },
  })
export const mobileSharedStateStorage = storage('dovo.shared-settings.fixture')
export const mobileThreadStateStorage = storage('dovo.shared-threads.fixture')
