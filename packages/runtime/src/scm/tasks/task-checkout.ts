import { processEnvironment } from '../../process.js'
import { LinkedCheckouts } from './linked-checkouts.js'
import { PendingCheckouts } from './pending-checkouts.js'
import type { ScratchWorkspaces } from '../repositories/scratch-workspaces.js'
import { repositoryPath } from '../repositories/paths.js'
import { taskBranchName, taskWorktreePath } from './task-branch.js'
import { defaultWorktreeBase, canChangeTaskCheckout } from '@dovo/protocol'
import { listBranches } from '../git/branches.js'
import { fetchPullHead } from '../pulls/pull-head.js'
import { mkdir, stat, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WorkspaceStore } from '../../storage/workspace.js'
import type { GitService } from '../git/git.js'
import { HttpError } from '../../errors.js'
export { worktreesRoot, taskWorktreeKeys, isTaskWorktree } from './task-worktree-keys.js'
import { taskWorktreeKeys, isTaskWorktree } from './task-worktree-keys.js'
export class TaskCheckout {
  readonly linked: LinkedCheckouts
  private pending = new PendingCheckouts<string>()
  private prepared = new Map<
    string,
    {
      path: string
      repositoryId: string
      repositoryPath: string
      execution?: string
      existingWorktreePath?: string
    }
  >()
  constructor(
    private store: WorkspaceStore,
    private git: GitService,
    /** Settings → Coding → Task defaults → Branch prefix for new task branches. */
    private branchPrefix: () => string = () => 'dovo/',
    private scratch?: ScratchWorkspaces,
  ) {
    this.linked = new LinkedCheckouts(store, git)
  }
  /** Delegated runs keep primary-project defaults but may execute in a linked project. */
  executionRepository(id: string) {
    let task = this.store.task(id)
    const visited = new Set<string>()
    while (task.delegation) {
      if (visited.has(task.id)) throw new HttpError(400, 'Invalid child agent ancestry')
      visited.add(task.id)
      const parent = this.store.task(task.delegation.parentTaskId)
      if (task.delegation.checkoutId) {
        const link = parent.linkedCheckouts?.find((item) => item.id === task.delegation?.checkoutId)
        if (!link) throw new HttpError(404, 'Linked checkout not found')
        const repository = this.store
          .get()
          .repositories.find((item) => item.id === link.repositoryId)
        if (!repository) throw new HttpError(404, 'Repository not found')
        return repository
      }
      task = parent
    }
    const repository = this.store.get().repositories.find((item) => item.id === task.repositoryId)
    if (!repository) throw new HttpError(404, 'Repository not found')
    return repository
  }
  async selectedDirectory(id: string, checkoutId?: string, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    if (!checkoutId) return this.directory(id, signal)
    const linked = (await this.linked.resolve(id, signal)).find((item) => item.id === checkoutId)
    if (!linked) throw new HttpError(404, 'Linked checkout not found')
    return linked.directory
  }
  directory(id: string, signal?: AbortSignal): Promise<string> {
    return this.pending.run(id, (sharedSignal) => this.preparedDirectory(id, sharedSignal), signal)
  }
  private async preparedDirectory(id: string, signal?: AbortSignal) {
    const task = this.store.task(id)
    if (task.delegation)
      return this.selectedDirectory(
        task.delegation.parentTaskId,
        task.delegation.checkoutId,
        signal,
      )
    const repo = this.store.get().repositories.find((repo) => repo.id === task.repositoryId)
    if (!repo) throw new HttpError(404, 'Repository not found')
    const cached = this.prepared.get(id)
    if (
      cached?.repositoryId === task.repositoryId &&
      cached.repositoryPath === repo.path &&
      cached.execution === task.execution &&
      cached.existingWorktreePath === task.existingWorktreePath &&
      (!task.setupCommand?.trim() || task.worktreeSetupComplete) &&
      (!task.submodules || task.submodules === 'none' || task.worktreeSubmodulesComplete) &&
      (repo.kind !== 'scratch' || (await realpath(cached.path).catch(() => '')) === cached.path) &&
      (await stat(cached.path)
        .then((entry) => entry.isDirectory())
        .catch((error: unknown) => {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
          throw error
        }))
    )
      return cached.path
    this.prepared.delete(id)
    const path = await this.resolve(id, signal)
    signal?.throwIfAborted()
    this.prepared.set(id, {
      path,
      repositoryId: task.repositoryId,
      repositoryPath: repo.path,
      execution: task.execution,
      existingWorktreePath: task.existingWorktreePath,
    })
    return path
  }
  private async resolve(id: string, signal?: AbortSignal) {
    signal?.throwIfAborted()
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
    signal?.throwIfAborted()
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
      return this.prepare(id, existing, steps, undefined, signal)
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
    signal?.throwIfAborted()
    await mkdir(dirname(directory), { recursive: true })
    if (kept) {
      const steps = ['restore', ...(setup ? ['setup'] : []), 'agent']
      this.progress(id, steps, 'restore', kept)
      // Drop stale registrations first; git refuses to re-add a branch a prunable entry holds.
      await this.git.command(root, ['worktree', 'prune'])
      signal?.throwIfAborted()
      await this.git.command(root, ['worktree', 'add', directory, kept])
      // A fresh checkout lacks installed dependencies; run the setup command again.
      this.store.updateTask(id, (current) => ({
        ...current,
        worktreeSetupComplete: false,
        worktreeSubmodulesComplete: false,
      }))
      return this.prepare(id, directory, steps, kept, signal)
    }
    const fetching = !task.pullRequest && !task.worktreeBaseBranch && !!task.worktreeFromOrigin
    const steps = [
      ...(task.pullRequest ? ['pull'] : fetching ? ['fetch'] : []),
      'worktree',
      ...(task.submodules && task.submodules !== 'none' ? ['submodules'] : []),
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
    signal?.throwIfAborted()
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
    return this.prepare(id, directory, steps, branch, signal)
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
  private async prepare(
    id: string,
    directory: string,
    steps: string[] = [],
    branch?: string,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted()
    const cwd = (await this.git.inspect(directory)).path
    const task = this.store.task(id)
    if (task.submodules && task.submodules !== 'none' && !task.worktreeSubmodulesComplete) {
      this.progress(id, steps, 'submodules', branch)
      signal?.throwIfAborted()
      await this.git.command(
        cwd,
        [
          'submodule',
          'update',
          '--init',
          ...(task.submodules === 'recursive' ? ['--recursive'] : []),
        ],
        processEnvironment({ GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' }),
      )
      signal?.throwIfAborted()
      this.store.updateTask(id, (current) => ({ ...current, worktreeSubmodulesComplete: true }))
    }
    if (task.setupCommand?.trim() && !task.worktreeSetupComplete) {
      this.progress(id, steps, 'setup', branch)
      try {
        signal?.throwIfAborted()
        await this.git.setupWorktree(cwd, task.setupCommand, signal)
        signal?.throwIfAborted()
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
