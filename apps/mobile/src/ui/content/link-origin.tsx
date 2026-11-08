import { createContext, useContext, useCallback, type ReactNode } from 'react'
import { useRuntimeSelector, sameRuntimeFields } from '../../runtime/connection/provider'

import type { LinkOrigin } from '@dovo/studio-core/links'
export type { LinkOrigin } from '@dovo/studio-core/links'
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
  const { activeId, taskRepositoryId } = useRuntimeSelector(
    useCallback(
      (value) => ({
        activeId: value.activeId,
        taskRepositoryId: value.snapshot?.workspace.tasks.find((task) => task.id === taskId)
          ?.repositoryId,
      }),
      [taskId],
    ),
    sameRuntimeFields,
  )
  return {
    runtimeId: origin.runtimeId ?? activeId ?? undefined,
    repositoryId: repositoryId ?? taskRepositoryId ?? origin.repositoryId,
    jiraSourceId: jiraSourceId ?? origin.jiraSourceId,
  }
}
