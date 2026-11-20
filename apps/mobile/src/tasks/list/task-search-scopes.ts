import type { TaskSearchScope } from '@dovo/protocol'

/**
 * Search scope per computer for the thread list filters. Each computer applies it before its
 * message-hit limit. With a project filter, only computers that hold that project are listed,
 * so `useTaskSearch` does not read the others.
 */
export function taskSearchScopes(
  computerIds: readonly string[],
  filter: {
    archived: boolean
    /** Project group key. `scratch` is No Project. Empty means every project. */
    project: string
    /** The selected group's projects on every computer. */
    projects: readonly { runtimeId: string; repository: { id: string } }[]
  },
) {
  const scopes: Record<string, TaskSearchScope> = {}
  for (const id of computerIds) {
    if (!filter.project) {
      scopes[id] = { archived: filter.archived }
      continue
    }
    const repositoryIds = [
      ...filter.projects
        .filter(({ runtimeId }) => runtimeId === id)
        .map(({ repository }) => repository.id),
      // Threads without a project ID belong to No Project too.
      ...(filter.project === 'scratch' ? [''] : []),
    ]
    if (repositoryIds.length) scopes[id] = { archived: filter.archived, repositoryIds }
  }
  return scopes
}
