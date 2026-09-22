import { createContext, useContext, useEffect } from 'react'
export type WorkTarget = {
  repositoryId: string
  jiraSourceId?: string
  kind: 'issue' | 'pipeline'
  id?: string
  sha?: string
  url?: string
}
export type StudioNavigation = {
  setDetail: (detail: boolean) => void
  focused: boolean
  workTarget?: WorkTarget
  openWork: (target: WorkTarget) => void
  navigate: (view: string, entityId?: string, runtimeId?: string) => void
}
export const NavigationContext = createContext<StudioNavigation | null>(null)
export function useNavigation() {
  const navigation = useContext(NavigationContext)
  if (!navigation) throw new Error('Navigation host is missing')
  return navigation
}

export function useDetailChrome() {
  const { setDetail } = useNavigation()
  useEffect(() => {
    setDetail(true)
    return () => setDetail(false)
  }, [setDetail])
}
