import type { Services } from '../../services.js'

/** A computer searches only its own execution workspace. */
export function searchRuntimeHistory(s: Services, query: string, id?: string, before?: string) {
  return s.store.searchHistory(query, id, before)
}
