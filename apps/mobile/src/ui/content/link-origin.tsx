import { createContext, useContext, type ReactNode } from 'react'
import { useRuntime } from '../../runtime/connection/provider'

export type LinkOrigin = { runtimeId?: string; repositoryId?: string; jiraSourceId?: string }
const Origin = createContext<LinkOrigin>({})

export function LinkOriginProvider({
  origin,
  children,
}: {
  origin: LinkOrigin
  children: ReactNode
}) {
  return <Origin value={origin}>{children}</Origin>
}

/** Read origin where the link is rendered, before any asynchronous sheet dismissal. */
export function useLinkOrigin(
  taskId?: string,
  repositoryId?: string,
  jiraSourceId?: string,
): LinkOrigin {
  const origin = useContext(Origin)
  const { activeId, snapshot } = useRuntime()
  const task = snapshot?.workspace.tasks.find((task) => task.id === taskId)
  return {
    runtimeId: origin.runtimeId ?? activeId ?? undefined,
    repositoryId: repositoryId ?? task?.repositoryId ?? origin.repositoryId,
    jiraSourceId: jiraSourceId ?? origin.jiraSourceId,
  }
}
