import type { ReactNode } from 'react'
import { useWorkspace } from './context'
import { WorkspaceScope } from './scope'

/** Integration views use the same explicit-owner context as settings, without selecting a server. */
export function WorkspaceRuntimeScope({
  runtimeId,
  children,
}: {
  runtimeId: string
  children: ReactNode
}) {
  const { runtimes } = useWorkspace()
  const profile = runtimes.find((entry) => entry.profile.id === runtimeId)?.profile
  return profile ? (
    <WorkspaceScope profile={profile}>{children}</WorkspaceScope>
  ) : (
    <p role="status" className="p-5 text-sm text-muted-foreground">
      This computer is no longer saved.
    </p>
  )
}
