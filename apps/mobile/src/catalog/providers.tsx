import type { ReactNode } from 'react'
import { RegistryProvider } from '@effect/atom-react'
import { ApplicationStateProvider } from '@dovo/studio-core/state'

/** Runtime state providers shared by the native and web mobile catalogs. */
export function MobileCatalogProviders({ children }: { children: ReactNode }) {
  return (
    <RegistryProvider>
      <ApplicationStateProvider>{children}</ApplicationStateProvider>
    </RegistryProvider>
  )
}
