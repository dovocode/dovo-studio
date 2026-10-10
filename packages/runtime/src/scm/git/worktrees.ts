import { Effect } from 'effect'
import { readdir, rmdir } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { Services } from '../../services.js'
import { HttpError, runtimeOperation, runtimeProgram } from '../../errors.js'
import { isTaskWorktree, taskWorktreeKeys } from '../tasks/task-checkout.js'
import { withinWorktrees } from '../tasks/task-worktree-keys.js'
import { worktreeListSchema, type Task } from '@dovo/protocol'

type Worktree = (typeof worktreeListSchema.Type.worktrees)[number]

function ownsWorktree(
  task: Task,
  repositoryId: string,
  common: string,
  root: string,
  path: string,
  branch: string,
) {
  const keys = [
    ...(task.repositoryId === repositoryId ? [taskWorktreeKeys(common, task.id, root)] : []),
    ...(task.linkedCheckouts ?? [])
      .filter(
        (link) =>
          link.repositoryId === repositoryId &&
          link.execution === 'worktree' &&
          !link.existingWorktreePath,
      )
      .map((link) => taskWorktreeKeys(common, `${task.id}:linked:${link.id}`, root)),
    ...(task.turns ?? [])
      .flatMap((turn) => turn.checkpoint?.linked ?? [])
      .filter((link) => link.repositoryId === repositoryId)
      .map((link) => taskWorktreeKeys(common, `${task.id}:linked:${link.checkoutId}`, root)),
  ]
  return keys.some(
    (key) =>
      isTaskWorktree(path, key, branch) &&
      (path === key.legacy ||
        basename(path).endsWith(`-${key.suffix}`) ||
        (basename(dirname(path)) === key.repositoryKey && basename(path) === key.key)),
  )
}
function referencesWorktree(
  task: Task,
  repositoryId: string,
  common: string,
  root: string,
  path: string,
  branch: string,
) {
  return (
    ownsWorktree(task, repositoryId, common, root, path, branch) ||
    task.existingWorktreePath === path ||
    !!task.linkedCheckouts?.some((link) => link.existingWorktreePath === path) ||
    !!task.turns?.some((turn) =>
      turn.checkpoint?.linked?.some(
        (link) => link.repositoryId === repositoryId && link.directory === path,
      ),
    )
  )
}

/** All registered worktrees for one project, including worktrees made outside Dovo. */
export function worktreeChoicesEffect(s: Pick<Services, 'git' | 'store'>, repositoryId: string) {
  return runtimeProgram(
    runtimeOperation(async () => {
      const repository = s.store.get().repositories.find((item) => item.id === repositoryId)
      if (!repository) throw new HttpError(404, 'Project not found')
      if (repository.kind) throw new HttpError(400, 'This project does not use Git worktrees')
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
              .command(path, [
                'status',
                '--porcelain',
                '--untracked-files=all',
                '--ignore-submodules=none',
              ])
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
export function listWorktreesEffect(s: Pick<Services, 'git' | 'store' | 'preferences'>) {
  return runtimeProgram(
    Effect.gen(function* () {
      const root = s.preferences.worktreesRoot()
      const workspace = s.store.get()
      const worktrees: Worktree[] = []
      const seen = new Set<string>()
      for (const repository of workspace.repositories) {
        if (repository.kind) continue
        // A missing or broken project checkout shouldn't hide the others' worktrees.
        const listed = yield* Effect.result(
          runtimeOperation(async () => {
            const { path: top } = await s.git.inspect(repository.path)
            const common = (
              await s.git.command(top, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
            ).trim()
            const records = (await s.git.command(top, ['worktree', 'list', '--porcelain', '-z']))
              .split('\0\0')
              .map((block) => block.split('\0'))
            return { common, records, top }
          }),
        )
        if (listed._tag === 'Failure') continue
        const { common, records, top } = listed.success
        for (const record of records) {
          const path = record.find((line) => line.startsWith('worktree '))?.slice(9)
          if (!path || seen.has(path)) continue
          const branch = record.find((line) => line.startsWith('branch '))?.slice(7) ?? ''
          const currentTasks = s.store.get().tasks
          const keyedOwners = currentTasks.filter((task) =>
            ownsWorktree(task, repository.id, common, root, path, branch),
          )
          const known = s.store.managedWorktrees(common).includes(path)
          // Only recorded creation or a verified task identity establishes Dovo ownership.
          if (path === top || (!known && !keyedOwners.length)) continue
          s.store.rememberWorktree(common, path)
          const owners = currentTasks.filter((task) =>
            referencesWorktree(task, repository.id, common, root, path, branch),
          )
          seen.add(path)
          const owner = owners.find((task) => !task.archivedAt) ?? owners[0]
          const state = owner ? (owner.archivedAt ? 'archived' : 'active') : 'missing'
          const prunable = record.some((line) => line.startsWith('prunable'))
          // A prunable entry has no directory left to inspect; nothing there can be lost.
          const dirty = prunable
            ? undefined
            : yield* Effect.result(
                runtimeOperation(() =>
                  s.git.command(path, [
                    'status',
                    '--porcelain',
                    '--untracked-files=all',
                    '--ignore-submodules=none',
                  ]),
                ),
              )
          worktrees.push({
            path,
            branch: branch.replace(/^refs\/heads\//, ''),
            repositoryId: repository.id,
            repositoryName: repository.name,
            taskId: owner?.id,
            taskTitle: owner?.title,
            threadIds: owners.map((task) => task.id),
            state,
            // Unreadable status counts as changed: never offer to delete what we can't inspect.
            dirty: !!dirty && (dirty._tag === 'Failure' || !!dirty.success.trim()),
            prunable,
            retainedLocation: !withinWorktrees(path, root),
          })
        }
      }
      return { root, rootSource: s.preferences.worktreesLocation().source, worktrees }
    }),
  )
}

/** Removes a worktree whose task is archived or deleted. Uncommitted changes and active tasks
 * are refused; the branch is always kept so no commits are lost. */
export function removeWorktreeEffect(
  s: Pick<Services, 'git' | 'store' | 'preferences'>,
  path: string,
  orphanOnly = false,
) {
  return runtimeProgram(
    Effect.gen(function* () {
      const { worktrees, root } = yield* listWorktreesEffect(s)
      const entry = worktrees.find((item) => item.path === path)
      if (!entry)
        throw new HttpError(404, 'That worktree is no longer listed. Refresh and try again.')
      if (orphanOnly && entry.threadIds.length)
        throw new HttpError(409, 'This worktree is still linked to another thread')
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
        const common = (
          await s.git.command(top, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
        ).trim()
        const branch = `refs/heads/${entry.branch}`
        // Git inspection yields; references must be checked against the latest workspace.
        const owners = s.store
          .get()
          .tasks.filter((task) =>
            referencesWorktree(task, repository.id, common, root, path, branch),
          )
        if (orphanOnly && owners.length)
          throw new HttpError(409, 'This worktree is still linked to another thread')
        if (owners.some((task) => !task.archivedAt))
          throw new HttpError(
            409,
            'This worktree belongs to an active task. Archive the task first.',
          )
        // No --force: git itself refuses anything that became dirty or locked meanwhile.
        // A prunable entry's directory is already gone; only its registration remains.
        await s.git.command(top, ['worktree', 'remove', path])
        s.store.forgetWorktree(common, path)
        // Tidy the now-empty <owner> folder, but never the worktrees root itself.
        const parent = dirname(path)
        if (withinWorktrees(parent, root)) {
          const contents = await readdir(parent).catch((error: unknown) => {
            if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
              return undefined
            throw error
          })
          if (contents && !contents.length)
            await rmdir(parent).catch((error: unknown) => {
              // Another checkout may reuse the parent while Git removal is finishing.
              if (
                error instanceof Error &&
                'code' in error &&
                ['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(String(error.code))
              )
                return
              throw error
            })
        }
      })
      return { ok: true }
    }),
  )
}
