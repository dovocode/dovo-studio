import { createContext, useContext, type ReactNode } from 'react'
import type { StudioHostApi } from './frontend'
const HostContext = createContext<StudioHostApi | null>(null)
export function StudioHostProvider({ api, children }: { api: StudioHostApi; children: ReactNode }) {
  return <HostContext.Provider value={api}>{children}</HostContext.Provider>
}
export function useStudioHost() {
  const api = useContext(HostContext)
  if (!api) throw new Error('StudioHostProvider is required')
  return api
}
