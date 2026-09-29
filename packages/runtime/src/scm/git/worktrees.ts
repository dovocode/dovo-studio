import { Effect } from 'effect'
import { readdir, rmdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Services } from '../../services.js'
import { HttpError, runtimeOperation, runtimeProgram } from '../../errors.js'
import { isTaskWorktree, taskWorktreeKeys, worktreesRoot } from '../tasks/task-checkout.js'
import { worktreeListSchema } from '@dovo/protocol'

type Worktree = (typeof worktreeListSchema.Type.worktrees)[number]

/** All registered worktrees for one project, including worktrees made outside Dovo. */
export function worktreeChoicesEffect(s: Pick<Services, 'git' | 'store'>, repositoryId: string) {
  return runtimeProgram(
    runtimeOperation(async () => {
      const repository = s.store.get().repositories.find((item) => item.id === repositoryId)
      if (!repository) throw new HttpError(404, 'Project not found')
      const { path: root } = await s.git.inspect(repository.path)
      const records = (await s.git.command(root, ['worktree', 'list', '--porcelain', '-z']))
        .split('\0\0')
        .map((block) => block.split('\0'))
      const worktrees = await Promise.all(
        records.flatMap((record) => {
          const path = record.find((line) => line.startsWith('worktree '))?.slice(9)
          if (!path || path === root || record.includes('prunable')) return []
          const branch = (
            record.find((line) => line.startsWith('branch '))?.slice(7) ?? ''
          ).replace(/^refs\/heads\//, '')
          return [
            s.git
              .command(path, ['status', '--porcelain'])
              .then((status) => ({ path, branch, dirty: !!status.trim() }))
              .catch(() => undefined),
          ]
        }),
      )
      return { worktrees: worktrees.filter((item) => item !== undefined) }
    }),
  )
}

/** Dovo-created task worktrees across registered projects (Settings → Coding → Worktrees). */
export function listWorktreesEffect(s: Pick<Services, 'git' | 'store'>) {
  return runtimeProgram(
    Effect.gen(function* () {
      const root = worktreesRoot()
      const workspace = s.store.get()
      const worktrees: Worktree[] = []
      const seen = new Set<string>()
      for (const repository of workspace.repositories) {
        // A missing or broken project checkout shouldn't hide the others' worktrees.
        const listed = yield* Effect.either(
          runtimeOperation(async () => {
            const { path: top } = await s.git.inspect(repository.path)
            const common = (
              await s.git.command(top, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
            ).trim()
            const records = (await s.git.command(top, ['worktree', 'list', '--porcelain', '-z']))
              .split('\0\0')
              .map((block) => block.split('\0'))
            return { common, records }
          }),
        )
        if (listed._tag === 'Left') continue
        const { common, records } = listed.right
        const tasks = workspace.tasks
          .filter((task) => task.repositoryId === repository.id)
          .map((task) => ({ task, keys: taskWorktreeKeys(common, task.id) }))
        for (const record of records) {
          const path = record.find((line) => line.startsWith('worktree '))?.slice(9)
          if (!path || !path.startsWith(root) || seen.has(path)) continue
          seen.add(path)
          const branch = record.find((line) => line.startsWith('branch '))?.slice(7) ?? ''
          const owner = tasks.find(({ keys }) => isTaskWorktree(path, keys))?.task
          const inUse = workspace.tasks.some(
            (task) => task.existingWorktreePath === path && !task.archivedAt,
          )
          const state =
            inUse || (owner && !owner.archivedAt) ? 'active' : owner ? 'archived' : 'missing'
          const prunable = record.some((line) => line.startsWith('prunable'))
          // A prunable entry has no directory left to inspect; nothing there can be lost.
          const dirty = prunable
            ? undefined
            : yield* Effect.either(
                runtimeOperation(() => s.git.command(path, ['status', '--porcelain'])),
              )
          worktrees.push({
            path,
            branch: branch.replace(/^refs\/heads\//, ''),
            repositoryId: repository.id,
            repositoryName: repository.name,
            taskId: owner?.id,
            taskTitle: owner?.title,
            state,
            // Unreadable status counts as changed: never offer to delete what we can't inspect.
            dirty: !!dirty && (dirty._tag === 'Left' || !!dirty.right.trim()),
            prunable,
          })
        }
      }
      return { root, worktrees }
    }),
  )
}

/** Removes a worktree whose task is archived or deleted. Uncommitted changes and active tasks
 * are refused; the branch is always kept so no commits are lost. */
export function removeWorktreeEffect(s: Pick<Services, 'git' | 'store'>, path: string) {
  return runtimeProgram(
    Effect.gen(function* () {
      const { worktrees, root } = yield* listWorktreesEffect(s)
      const entry = worktrees.find((item) => item.path === path)
      if (!entry)
        throw new HttpError(404, 'That worktree is no longer listed. Refresh and try again.')
      if (entry.state === 'active')
        throw new HttpError(409, 'This worktree belongs to an active task. Archive the task first.')
      if (entry.dirty)
        throw new HttpError(
          409,
          'This worktree has uncommitted changes. Commit or discard them before removing it.',
        )
      const repository = s.store.get().repositories.find((item) => item.id === entry.repositoryId)
      if (!repository) throw new HttpError(404, 'Repository not found')
      yield* runtimeOperation(async () => {
        const { path: top } = await s.git.inspect(repository.path)
        // No --force: git itself refuses anything that became dirty or locked meanwhile.
        // A prunable entry's directory is already gone; only its registration remains.
        if (entry.prunable) await s.git.command(top, ['worktree', 'prune'])
        else await s.git.command(top, ['worktree', 'remove', path])
        // Tidy the now-empty <owner> folder, but never the worktrees root itself.
        const parent = dirname(path)
        if (parent !== root && parent.startsWith(root) && !(await readdir(parent)).length)
          await rmdir(parent)
      })
      return { ok: true }
    }),
  )
}
