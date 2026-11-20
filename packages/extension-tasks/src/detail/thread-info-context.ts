import { createContext, useContext } from 'react'

/** Keep the composer's settings mounted while their Thread Info panel is closed. */
export const ThreadInfoContext = createContext<{
  container: HTMLDivElement | null
  open: boolean
  panelId: string
} | null>(null)

export const useThreadInfoContext = () => useContext(ThreadInfoContext)
