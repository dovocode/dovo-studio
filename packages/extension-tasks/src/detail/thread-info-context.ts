import { createContext, useContext } from 'react'

/** Keep the composer's settings mounted while their Thread Info panel is closed. */
export const ThreadInfoContext = createContext<{
  container: HTMLDivElement | null
  setContainer: (element: HTMLDivElement | null) => void
  open: boolean
} | null>(null)

export const useThreadInfoContext = () => useContext(ThreadInfoContext)
