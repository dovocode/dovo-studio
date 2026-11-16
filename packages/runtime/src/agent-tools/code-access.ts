import { samePermissionPolicy, resolveTaskAgent } from '@dovo/protocol'
import type { WorkspaceStore } from '../storage/workspace.js'
import type { RunPolicy } from '../auth/run-credentials.js'
import { HttpError } from '../errors.js'

export function checkCodeAccess(store: WorkspaceStore, grant: RunPolicy) {
  const agent = resolveTaskAgent(store.taskSummary(grant.taskId), store.get().agents)
  if (!agent || !samePermissionPolicy(grant.permissions, agent))
    throw new HttpError(403, 'Agent access changed. Start a new turn.')
  if (!grant.codeDirectories)
    throw new HttpError(409, 'Code tools are unavailable until the provider turn is ready')
  return grant.codeDirectories
}
