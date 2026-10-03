import { createHash } from 'node:crypto'
import { join, basename, sep } from 'node:path'
import { homedir } from 'node:os'
export const worktreesRoot = () => join(homedir(), '.dovo', 'worktrees')

/** Where a task's worktree lives. Tasks created before readable names keep their original
 * hashed checkout (`legacy`); newer ones end in a short suffix unique to the repository and
 * task, so a checkout is found again after the task's title (and readable name) changes. */
export function taskWorktreeKeys(common: string, id: string) {
  const worktrees = worktreesRoot()
  const key = createHash('sha256').update(id).digest('hex').slice(0, 24)
  const repositoryKey = createHash('sha256').update(common).digest('hex').slice(0, 24)
  const suffix = createHash('sha256').update(`${common}\0${id}`).digest('hex').slice(0, 8)
  return { key, repositoryKey, suffix, legacy: join(worktrees, repositoryKey, key), worktrees }
}
/** Whether a listed worktree path belongs to the task with these keys. */
export function isTaskWorktree(path: string, keys: ReturnType<typeof taskWorktreeKeys>) {
  return (
    path === keys.legacy ||
    (path.startsWith(keys.worktrees + sep) && basename(path).endsWith(`-${keys.suffix}`))
  )
}
