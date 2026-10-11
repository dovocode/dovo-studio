import type { Task } from '@dovo/protocol'

/** Streaming writes do not change watch ownership. Revision checks invalidate rolled-back reads. */
export class WatchLifecycleCache {
  private cached?: { key: string; revision: number; watching: Set<string> }
  invalidate() {
    this.cached = undefined
  }
  reconcile(tasks: readonly Task[], revision: number, updating: boolean, read: () => Set<string>) {
    const key = JSON.stringify(
      tasks.map((task) => [
        task.id,
        task.repositoryId,
        !!task.archived,
        task.archivedAt,
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
  task: Task,
  repositoryId: string,
  primaryRepositoryId = repositoryId,
) {
  if (task.repositoryId !== primaryRepositoryId) return 'The thread’s project changed'
  if (
    repositoryId !== task.repositoryId &&
    !task.linkedCheckouts?.some(
      (link) => link.repositoryId === repositoryId && link.access === 'edit',
    )
  )
    return 'The watched project is no longer an editable linked project'
  return undefined
}
