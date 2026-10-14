import { useSyncExternalStore } from 'react'

const subscribe = (notify: () => void) => {
  document.addEventListener('visibilitychange', notify)
  return () => document.removeEventListener('visibilitychange', notify)
}
const visible = () => document.visibilityState !== 'hidden'
/** Catalog discovery belongs to visible consumers; reading saved names does not probe providers. */
export function useCatalogVisible() {
  return useSyncExternalStore(subscribe, visible, () => false)
}
