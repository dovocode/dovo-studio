import type { ScratchWorkspaces } from '../repositories/scratch-workspaces.js'
import { repositoryPath } from '../repositories/paths.js'
import { taskBranchName, taskWorktreePath } from './task-branch.js'
import { defaultWorktreeBase, canChangeTaskCheckout } from '@dovo/protocol'
import { listBranches } from '../git/branches.js'
import { fetchPullHead } from '../pulls/pull-head.js'
import { createHash } from 'node:crypto'
import { mkdir, stat, realpath } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { homedir } from 'node:os'
import type { WorkspaceStore } from '../../storage/workspace.js'
import type { GitService } from '../git/git.js'
import { HttpError } from '../../errors.js'
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
export class TaskCheckout {
  private pending = new Map<string, Promise<string>>()
  private prepared = new Map<
    string,
    { path: string; repositoryId: string; execution?: string; existingWorktreePath?: string }
  >()
  constructor(
    private store: WorkspaceStore,
    private git: GitService,
    /** Settings → Coding → Task defaults → Branch prefix for new task branches. */
    private branchPrefix: () => string = () => 'dovo/',
    private scratch?: ScratchWorkspaces,
  ) {}
  directory(id: string): Promise<string> {
    const pending = this.pending.get(id)
    if (pending) return pending
    const result = this.preparedDirectory(id).finally(() => this.pending.delete(id))
    this.pending.set(id, result)
    return result
  }
  private async preparedDirectory(id: string) {
    const task = this.store.task(id)
    if (task.delegation) return this.directory(task.delegation.parentTaskId)
    const cached = this.prepared.get(id)
    if (
      cached?.repositoryId === task.repositoryId &&
      cached.execution === task.execution &&
      cached.existingWorktreePath === task.existingWorktreePath &&
      (!task.setupCommand?.trim() || task.worktreeSetupComplete) &&
      (this.store.get().repositories.find((repo) => repo.id === task.repositoryId)?.kind !==
        'scratch' ||
        (await realpath(cached.path).catch(() => '')) === cached.path) &&
      (await stat(cached.path)
        .then((entry) => entry.isDirectory())
        .catch((error: unknown) => {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
          throw error
        }))
    )
      return cached.path
    this.prepared.delete(id)
    const path = await this.resolve(id)
    this.prepared.set(id, {
      path,
      repositoryId: task.repositoryId,
      execution: task.execution,
      existingWorktreePath: task.existingWorktreePath,
    })
    return path
  }
  private async resolve(id: string) {
    const task = this.store.task(id)
    const repo = this.store.get().repositories.find((r) => r.id === task.repositoryId)
    if (!repo) throw new HttpError(404, 'Repository not found')
    if (repo.kind) {
      if (task.execution === 'worktree' || task.existingWorktreePath || task.pullRequest)
        throw new HttpError(400, 'This project does not support Git worktrees or pull requests')
      if (repo.kind === 'scratch') {
        if (!this.scratch) throw new HttpError(503, 'Scratch workspaces are unavailable')
        return this.scratch.directory(id)
      }
      return repositoryPath(repo.path)
    }
    const { path: root } = await this.git.inspect(repo.path)
    if (task.execution !== 'worktree') return root
    if (task.existingWorktreePath) {
      const records = (await this.git.command(root, ['worktree', 'list', '--porcelain', '-z']))
        .split('\0\0')
        .map((block) => block.split('\0'))
      const listed = records.find(
        (record) =>
          record.includes(`worktree ${task.existingWorktreePath}`) &&
          task.existingWorktreePath !== root &&
          !record.includes('prunable'),
      )
      if (!listed)
        throw new HttpError(
          409,
          'The selected worktree is no longer available. Restore it or start a new task in another checkout.',
        )
      return (await this.git.inspect(task.existingWorktreePath)).path
    }
    if (canChangeTaskCheckout(task))
      throw new HttpError(409, 'Send the first prompt before creating the worktree')
    const common = (
      await this.git.command(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ).trim()
    const keys = taskWorktreeKeys(common, id)
    const { key, suffix, worktrees } = keys
    // A worktree whose directory was deleted out of band stays listed as prunable; git would
    // refuse to check it out, so recreate it instead of failing every start with ENOENT.
    const paths = (await this.git.command(root, ['worktree', 'list', '--porcelain', '-z']))
      .split('\0\0')
      .map((block) => block.split('\0'))
      .filter((record) => !record.some((line) => line.startsWith('prunable')))
      .flatMap((record) =>
        record.flatMap((line) => (line.startsWith('worktree ') ? [line.slice(9)] : [])),
      )
    const existing = paths.find((path) => isTaskWorktree(path, keys))
    const setup = !!task.setupCommand?.trim()
    if (existing) {
      const steps = setup && !task.worktreeSetupComplete ? ['setup', 'agent'] : []
      return this.prepare(id, existing, steps)
    }
    // A removed worktree keeps its branch (Settings → Worktrees, or the archive cleanup). Reattach
    // that branch so committed work carries on, even if the title or prefix changed since.
    const kept = (
      await this.git.command(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    )
      .split('\n')
      .find((name) => name.endsWith(`-${suffix}`))
    const prefix = this.branchPrefix()
    const branch = kept ?? taskBranchName(task.title, suffix, prefix)
    const identity = await this.git.repositoryIdentity(root).catch(() => undefined)
    const directory = join(worktrees, taskWorktreePath(identity, root, branch, prefix))
    // Never reset an existing branch or remove a checkout. A collision/missing checkout needs repair.
    await mkdir(dirname(directory), { recursive: true })
    if (kept) {
      const steps = ['restore', ...(setup ? ['setup'] : []), 'agent']
      this.progress(id, steps, 'restore', kept)
      // Drop stale registrations first; git refuses to re-add a branch a prunable entry holds.
      await this.git.command(root, ['worktree', 'prune'])
      await this.git.command(root, ['worktree', 'add', directory, kept])
      // A fresh checkout lacks installed dependencies; run the setup command again.
      this.store.updateTask(id, (current) => ({ ...current, worktreeSetupComplete: false }))
      return this.prepare(id, directory, steps, kept)
    }
    const fetching = !task.pullRequest && !task.worktreeBaseBranch && !!task.worktreeFromOrigin
    const steps = [
      ...(task.pullRequest ? ['pull'] : fetching ? ['fetch'] : []),
      'worktree',
      ...(setup && !task.worktreeSetupComplete ? ['setup'] : []),
      'agent',
    ]
    this.progress(id, steps, steps[0], branch)
    let refs = task.pullRequest ? undefined : await listBranches({ git: this.git }, root)
    // "Start from origin": fetch first so the worktree starts from origin's latest commit.
    if (refs && !task.worktreeBaseBranch && task.worktreeFromOrigin)
      refs = await this.fetchOrigin(root).then(() => listBranches({ git: this.git }, root))
    const selection =
      task.worktreeBaseBranch ??
      (refs &&
        defaultWorktreeBase(
          refs.branches,
          refs.current,
          task.worktreeFromOrigin,
          refs.originDefault,
        ))
    const base = refs?.branches.find(
      (branch) => branch.ref === selection || branch.name === selection,
    )?.ref
    if (
      !task.pullRequest &&
      !task.forkedFrom?.head &&
      (!base || !refs?.branches.some((branch) => branch.ref === base))
    )
      throw new HttpError(400, 'Choose an existing base branch for the worktree')
    const head = task.pullRequest
      ? await fetchPullHead(this.git, root, task.pullRequest, key)
      : (task.forkedFrom?.head ?? base ?? 'HEAD')
    this.progress(id, steps, 'worktree', branch)
    await this.git.command(root, ['worktree', 'add', '-b', branch, directory, head])
    // A fork starts from the files of the turn it was forked at, not the branch tip.
    const snapshot = task.forkedFrom?.snapshot
    if (snapshot) {
      await this.git.restoreSnapshot(directory, snapshot, `refs/dovo/forks/${id}/base`)
      this.store.updateTask(id, (current) =>
        current.forkedFrom
          ? { ...current, forkedFrom: { ...current.forkedFrom, snapshot: undefined } }
          : current,
      )
    }
    return this.prepare(id, directory, steps, branch)
  }
  /** Publishes which checkout step a preparing run is on, so clients can show progress.
   * Other callers (diff and terminal reads) resolve the same checkout silently. Progress is
   * informational: failing to record it never fails the checkout. */
  private progress(id: string, steps: string[], current: string, branch?: string) {
    if (!steps.includes(current)) return
    try {
      const task = this.store.get().tasks.find((item) => item.id === id)
      if (task?.status !== 'running' || task.runPhase !== 'preparing') return
      this.store.updateTask(id, (value) => ({
        ...value,
        preparation: {
          steps,
          current,
          ...(branch ? { branch } : {}),
          startedAt: new Date().toISOString(),
        },
      }))
    } catch (error) {
      console.error('Could not publish checkout progress', error)
    }
  }
  /** Offline or credential-less fetches are not fatal: the last fetched origin refs are used. */
  private async fetchOrigin(root: string) {
    const remotes = (await this.git.command(root, ['remote']))
      .split('\n')
      .map((name) => name.trim())
    if (!remotes.includes('origin')) return
    await this.git.command(root, ['fetch', '--quiet', '--no-tags', 'origin']).catch(() => undefined)
    // Learn origin's default branch once, for clones that never recorded origin/HEAD.
    const known = await this.git
      .command(root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
      .then(() => true)
      .catch(() => false)
    if (!known)
      await this.git
        .command(root, ['remote', 'set-head', 'origin', '--auto'])
        .catch(() => undefined)
  }
  private async prepare(id: string, directory: string, steps: string[] = [], branch?: string) {
    const cwd = (await this.git.inspect(directory)).path
    const task = this.store.task(id)
    if (task.setupCommand?.trim() && !task.worktreeSetupComplete) {
      this.progress(id, steps, 'setup', branch)
      try {
        await this.git.setupWorktree(cwd, task.setupCommand)
      } catch (error) {
        throw new HttpError(
          400,
          `Worktree setup failed. Fix the command or checkout, then retry the task. ${error instanceof Error ? error.message : String(error)}`,
        )
      }
      this.store.updateTask(id, (current) => ({ ...current, worktreeSetupComplete: true }))
    }
    return cwd
  }
}
