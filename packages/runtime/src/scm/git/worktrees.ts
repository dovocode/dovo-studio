import { Effect } from 'effect'
import { readdir, realpath, rmdir } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { Services } from '../../services.js'
import { HttpError, runtimeOperation, runtimeProgram } from '../../errors.js'
import { isTaskWorktree, taskWorktreeKeys } from '../tasks/task-checkout.js'
import { withinWorktrees } from '../tasks/task-worktree-keys.js'
import { worktreeListSchema, type TaskSummary, type TerminalInfo } from '@dovo/protocol'

type Worktree = (typeof worktreeListSchema.Type.worktrees)[number]
/** Only what the guard reads; settled or snoozed shells are still live processes. */
type LiveShells = {
  terminals: { list(): readonly Pick<TerminalInfo, 'title' | 'exited' | 'directory'>[] }
}
type WorktreeServices = Pick<Services, 'git' | 'store' | 'preferences'> & LiveShells

const canonical = (path: string) => realpath(path).catch(() => resolve(path))
/** Titles of running shells whose working directory is this checkout or inside it. */
async function liveShellTitles(s: LiveShells, path: string) {
  const target = await canonical(path)
  const titles: string[] = []
  for (const shell of s.terminals.list()) {
    if (shell.exited || !shell.directory) continue
    const offset = relative(target, await canonical(shell.directory))
    if (offset === '' || (!isAbsolute(offset) && offset !== '..' && !offset.startsWith(`..${sep}`)))
      titles.push(shell.title)
  }
  return titles
}
const shellLabel = (titles: string[]) =>
  titles.length > 1 ? `${titles[0]} and ${titles.length - 1} more` : titles[0]
const shellInUse = (titles: string[]) =>
  new HttpError(
    409,
    `This worktree is open in ${shellLabel(titles)}. Close the terminal first; settling or snoozing keeps it running.`,
  )

function ownsWorktree(
  task: TaskSummary,
  repositoryId: string,
  common: string,
  root: string,
  path: string,
  branch: string,
) {
  const keys = [
    ...(task.repositoryId === repositoryId ? [taskWorktreeKeys(common, task.id, root)] : []),
    ...[...(task.linkedCheckouts ?? []), ...(task.pendingLinkedCheckouts ?? [])]
      .filter(
        (link) =>
          link.repositoryId === repositoryId &&
          link.execution === 'worktree' &&
          !link.existingWorktreePath,
      )
      .map((link) => taskWorktreeKeys(common, `${task.id}:linked:${link.id}`, root)),
    ...(task.history.linkedCheckpoints ?? [])
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
  task: TaskSummary,
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
    !!task.pendingLinkedCheckouts?.some((link) => link.existingWorktreePath === path) ||
    !!task.history.linkedCheckpoints?.some(
      (link) => link.repositoryId === repositoryId && link.directory === path,
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
export function listWorktreesEffect(s: WorktreeServices) {
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
          // A live standalone shell holds the checkout without becoming a task owner.
          const shells = yield* runtimeOperation(() => liveShellTitles(s, path))
          const state =
            shells.length || (owner && !owner.archivedAt)
              ? 'active'
              : owner
                ? 'archived'
                : 'missing'
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
            taskTitle: owner?.title ?? (shells.length ? shellLabel(shells) : undefined),
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

/** Removes a worktree whose task is archived or deleted. Uncommitted changes, active tasks and
 * live terminal shells are refused; the branch is always kept so no commits are lost. */
export function removeWorktreeEffect(s: WorktreeServices, path: string, orphanOnly = false) {
  return runtimeProgram(
    Effect.gen(function* () {
      const { worktrees, root } = yield* listWorktreesEffect(s)
      const entry = worktrees.find((item) => item.path === path)
      if (!entry)
        throw new HttpError(404, 'That worktree is no longer listed. Refresh and try again.')
      if (orphanOnly && entry.threadIds.length)
        throw new HttpError(409, 'This worktree is still linked to another thread')
      const shells = yield* runtimeOperation(() => liveShellTitles(s, path))
      if (shells.length) throw shellInUse(shells)
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
        // A shell may have opened here while Git was inspecting; check right before removal.
        const opened = await liveShellTitles(s, path)
        if (opened.length) throw shellInUse(opened)
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
