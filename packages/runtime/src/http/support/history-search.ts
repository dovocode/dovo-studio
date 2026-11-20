import type { TaskSearchScope } from '@dovo/protocol'
import type { Services } from '../../services.js'

/** A computer searches only its own execution workspace. */
export function searchRuntimeHistory(
  s: Services,
  query: string,
  id?: string,
  before?: string,
  scope?: TaskSearchScope,
) {
  return s.store.searchHistory(query, id, before, scope)
}
