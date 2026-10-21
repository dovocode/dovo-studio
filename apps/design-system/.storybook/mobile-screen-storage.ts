/** Per-preview memory only: catalog examples cannot read or overwrite a real pairing/preferences. */
const values = new Map<string, string>()
export default {
  getItem: async (key: string) => values.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    values.set(key, value)
  },
  removeItem: async (key: string) => {
    values.delete(key)
  },
  clear: async () => {
    values.clear()
  },
  getAllKeys: async () => [...values.keys()],
  multiGet: async (keys: string[]) => keys.map((key) => [key, values.get(key) ?? null]),
  multiSet: async (entries: [string, string][]) => {
    for (const [key, value] of entries) values.set(key, value)
  },
  multiRemove: async (keys: string[]) => {
    for (const key of keys) values.delete(key)
  },
}
