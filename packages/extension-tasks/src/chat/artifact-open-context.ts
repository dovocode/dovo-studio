import { createContext } from 'react'
import type { ArtifactReference } from '@dovo/protocol'

export const ArtifactOpenContext = createContext<
  ((reference: ArtifactReference) => void) | undefined
>(undefined)
