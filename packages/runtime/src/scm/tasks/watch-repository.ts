import { HttpError } from '../../errors.js'
import type { WatchSource } from './watch-source.js'
import type { TaskMetadata } from '@dovo/protocol'

/** Streaming writes do not change watch ownership. Revision checks invalidate rolled-back reads. */
export class WatchLifecycleCache {
  private cached?: { key: string; revision: number; watching: Set<string> }
  invalidate() {
    this.cached = undefined
  }
  reconcile(
    tasks: readonly TaskMetadata[],
    revision: number,
    updating: boolean,
    read: () => Set<string>,
  ) {
    const key = JSON.stringify(
      tasks.map((task) => [
        task.id,
        task.repositoryId,
        !!task.archived,
        task.archivedAt,
        task.delegation?.completion,
        task.linkedCheckouts?.map((link) => [link.repositoryId, link.access]),
      ]),
    )
    const watching =
      this.cached?.key === key && this.cached.revision === revision ? this.cached.watching : read()
    this.cached = { key, revision: revision + (updating ? 1 : 0), watching }
    return watching
  }
}

/** Watches may wake an agent to act, so reference-only linked projects are excluded. */
export function watchRepositoryError(
  task: TaskMetadata,
  repositoryId: string,
  primaryRepositoryId = repositoryId,
  source?: WatchSource,
) {
  if (task.delegation && !task.delegation.completion)
    return 'Legacy turn-owned children cannot own durable watches; launch a durable child instead'
  if (task.delegation?.completion === 'disposed') return 'The child thread was stopped'
  if (task.repositoryId !== primaryRepositoryId) return 'The thread’s project changed'
  const owner = source ? (source.accountRepositoryId ?? task.repositoryId) : repositoryId
  if (
    owner !== task.repositoryId &&
    !task.linkedCheckouts?.some((link) => link.repositoryId === owner && link.access === 'edit')
  )
    return 'The watched project is no longer an editable linked project'
  return undefined
}

/** General threads inherit their sole editable linked Git project's account. */
export function watchAccountRepositoryId(task: TaskMetadata, gitProjects: ReadonlySet<string>) {
  if (gitProjects.has(task.repositoryId)) return task.repositoryId
  const linked = [
    ...new Set(
      task.linkedCheckouts
        ?.filter((link) => link.access === 'edit' && gitProjects.has(link.repositoryId))
        .map((link) => link.repositoryId),
    ),
  ]
  if (linked.length > 1)
    throw new HttpError(
      409,
      'Several linked projects can supply a forge account. Specify repositoryId.',
    )
  return linked[0] ?? task.repositoryId
}
