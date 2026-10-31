import { OwnedProcessShutdownError } from '../../agents/execution/stop-owned-child.js'
import {
  worktreeRecords,
  availableWorktree,
  requireCompleteWorktree,
} from '../git/worktree-records.js'
import { createHash } from 'node:crypto'
import { processEnvironment } from '../../process.js'
import { LinkedCheckouts } from './linked-checkouts.js'
import { PendingCheckouts } from './pending-checkouts.js'
import type { ScratchWorkspaces } from '../repositories/scratch-workspaces.js'
import { repositoryPath } from '../repositories/paths.js'
import { taskBranchName, taskWorktreePath } from './task-branch.js'
import { defaultWorktreeBase, canChangeTaskCheckout } from '@dovo/protocol'
import { listBranches } from '../git/branches.js'
import { fetchPullHead } from '../pulls/pull-head.js'
import { createPullBranchWorktree, pullSourceBranch } from '../pulls/pull-branch.js'
import { mkdir, stat, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WorkspaceStore } from '../../storage/workspace.js'
import type { BranchBase, GitService } from '../git/git.js'
import { HttpError } from '../../errors.js'
export { taskWorktreeKeys, isTaskWorktree } from './task-worktree-keys.js'
import { taskWorktreeKeys, isTaskWorktree, worktreesRoot } from './task-worktree-keys.js'
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
    private worktrees: () => string = worktreesRoot,
  ) {
    this.linked = new LinkedCheckouts(store, git, worktrees)
  }
  /** Delegated runs keep primary-project defaults but may execute in a linked project. */
  executionRepository(id: string) {
    let task = this.store.taskSummary(id)
    const visited = new Set<string>()
    while (task.delegation) {
      if (visited.has(task.id)) throw new HttpError(400, 'Invalid child agent ancestry')
      visited.add(task.id)
      const parent = this.store.taskSummary(task.delegation.parentTaskId)
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
  /** Optional review metadata must never create a checkout or rerun its setup command. */
  async reviewDirectory(
    id: string,
    checkoutId?: string,
    visited = new Set<string>(),
  ): Promise<string | undefined> {
    if (visited.has(id)) return undefined
    visited.add(id)
    const task = this.store.taskSummary(id)
    if (!checkoutId && task.importedCodexSession) {
      const cwd = task.importedCodexSession.cwd
      return (
        await stat(cwd).catch((error: unknown) => {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
          throw error
        })
      )?.isDirectory()
        ? cwd
        : undefined
    }
    if (task.delegation && !checkoutId)
      return this.reviewDirectory(task.delegation.parentTaskId, task.delegation.checkoutId, visited)
    const link = checkoutId
      ? task.linkedCheckouts?.find((link) => link.id === checkoutId)
      : undefined
    if (checkoutId && !link) return undefined
    const repo = this.store
      .get()
      .repositories.find((repo) => repo.id === (link?.repositoryId ?? task.repositoryId))
    if (!repo || repo.kind) return undefined
    if ((link?.execution ?? task.execution) !== 'worktree') return repo.path
    if (link || task.existingWorktreePath) {
      const selected = link
        ? (task.linkedCheckoutSetup?.find((setup) => setup.id === link.id)?.directory ??
          link.existingWorktreePath)
        : task.existingWorktreePath
      if (!selected) return undefined
      const records = worktreeRecords(
        await this.git.command(repo.path, ['worktree', 'list', '--porcelain', '-z']),
      )
      return records.some(
        (record) => record.path === selected && availableWorktree(record, repo.path),
      )
        ? selected
        : undefined
    }
    const cached = this.prepared.get(id)
    if (
      cached?.repositoryId === task.repositoryId &&
      cached.repositoryPath === repo.path &&
      cached.execution === task.execution &&
      cached.existingWorktreePath === task.existingWorktreePath
    )
      return cached.path
    const common = (
      await this.git.command(repo.path, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ).trim()
    const keys = taskWorktreeKeys(common, id, this.worktrees())
    const records = worktreeRecords(
      await this.git.command(repo.path, ['worktree', 'list', '--porcelain', '-z']),
    )
    for (const record of records) {
      if (
        availableWorktree(record, repo.path) &&
        record.path &&
        isTaskWorktree(record.path, keys, record.branch)
      )
        return record.path
    }
    return undefined
  }
  /** Base for branch diffs and reviews of the checkout `directory` or `reviewDirectory` selects.
   * GitService applies a recorded base only while its branch is checked out. */
  branchBase(id: string, checkoutId?: string, visited = new Set<string>()): BranchBase | undefined {
    if (visited.has(id)) return undefined
    visited.add(id)
    const task = this.store.taskSummary(id)
    if (!checkoutId && task.importedCodexSession) return undefined
    if (task.delegation && !checkoutId)
      return this.branchBase(task.delegation.parentTaskId, task.delegation.checkoutId, visited)
    if (checkoutId) {
      const link = task.linkedCheckouts?.find((item) => item.id === checkoutId)
      return link?.execution === 'worktree' && !link.existingWorktreePath && link.baseBranch
        ? { ref: link.baseBranch }
        : undefined
    }
    if (task.existingWorktreePath) return undefined
    if (task.worktreeBase) return task.worktreeBase
    const branch = task.checkoutBranch ? { branch: task.checkoutBranch } : {}
    if (task.pullRequest) return { ...branch, commit: task.pullRequest.baseSha }
    // Worktrees created before bases were recorded kept only an explicitly chosen base name.
    return task.execution === 'worktree' && task.worktreeBaseBranch && task.checkoutBranch
      ? { ...branch, ref: task.worktreeBaseBranch }
      : undefined
  }
  /** Chat previews read an existing checkout and never run setup or create a worktree. */
  async fileDirectory(
    id: string,
    checkoutId?: string,
    visited = new Set<string>(),
  ): Promise<string> {
    if (visited.has(id)) throw new HttpError(400, 'Invalid child agent ancestry')
    visited.add(id)
    const task = this.store.taskSummary(id)
    if (!checkoutId && task.importedCodexSession) {
      const directory = await this.reviewDirectory(id)
      if (!directory) throw new HttpError(404, 'The imported Codex checkout is missing')
      return directory
    }
    if (task.delegation && !checkoutId)
      return this.fileDirectory(task.delegation.parentTaskId, task.delegation.checkoutId, visited)
    const link = checkoutId
      ? task.linkedCheckouts?.find((item) => item.id === checkoutId)
      : undefined
    if (checkoutId && !link) throw new HttpError(404, 'Linked checkout not found')
    const repo = this.store
      .get()
      .repositories.find((item) => item.id === (link?.repositoryId ?? task.repositoryId))
    if (!repo) throw new HttpError(404, 'Repository not found')
    if (repo.kind === 'scratch')
      return join(repo.path, createHash('sha256').update(task.id).digest('hex'))
    if (repo.kind) return repo.path
    const directory = await this.reviewDirectory(id, checkoutId)
    if (!directory) throw new HttpError(404, 'This task checkout is no longer available')
    return directory
  }
  /** Draft threads can browse project history before their worktree exists. Never prepares it. */
  async commitDirectory(id: string, checkoutId?: string): Promise<string> {
    const task = this.store.taskSummary(id)
    if (!checkoutId && !task.delegation && canChangeTaskCheckout(task)) {
      const repo = this.store.get().repositories.find((repo) => repo.id === task.repositoryId)
      if (repo && !repo.kind) return repo.path
    }
    return this.fileDirectory(id, checkoutId)
  }
  directory(id: string, signal?: AbortSignal): Promise<string> {
    return this.pending.run(id, (sharedSignal) => this.preparedDirectory(id, sharedSignal), signal)
  }
  private async preparedDirectory(id: string, signal?: AbortSignal) {
    const task = this.store.taskSummary(id)
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
      !task.worktreeInitialSnapshot &&
      !task.forkedFrom?.snapshot &&
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
    const task = this.store.taskSummary(id)
    if (task.importedCodexSession) return this.fileDirectory(id)
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
      const records = worktreeRecords(
        await this.git.command(root, ['worktree', 'list', '--porcelain', '-z']),
      )
      const listed = records.find(
        (record) => record.path === task.existingWorktreePath && availableWorktree(record, root),
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
    const keys = taskWorktreeKeys(common, id, this.worktrees())
    const { key, suffix, worktrees } = keys
    const records = worktreeRecords(
      await this.git.command(root, ['worktree', 'list', '--porcelain', '-z']),
    )
    const matching = records.filter(
      (record) => record.path && isTaskWorktree(record.path, keys, record.branch),
    )
    for (const record of matching) requireCompleteWorktree(record)
    const existing = matching.find((record) => availableWorktree(record, root))?.path
    const setup = !!task.setupCommand?.trim()
    if (existing) {
      // Finish upstream setup if a previous checkout attempt stopped after creating the folder.
      if (task.pullRequest?.checkoutMode === 'pr-branch' && !task.checkoutBranch) {
        const branch = await createPullBranchWorktree(
          this.git,
          root,
          task.pullRequest,
          existing,
          key,
          false,
          signal,
        )
        this.store.updateTask(id, (current) => ({ ...current, checkoutBranch: branch }))
      }
      const steps = setup && !task.worktreeSetupComplete ? ['setup', 'agent'] : []
      return this.prepare(id, existing, steps, undefined, signal)
    }
    if (task.pullRequest?.checkoutMode === 'pr-branch') {
      const branch = pullSourceBranch(task.pullRequest)
      const identity = await this.git.repositoryIdentity(root, true).catch(() => undefined)
      const directory = join(worktrees, taskWorktreePath(identity, root, `${branch}-${suffix}`))
      const restoring = task.checkoutBranch === branch
      const steps = [
        restoring ? 'restore' : 'pull',
        'worktree',
        ...(task.submodules && task.submodules !== 'none' ? ['submodules'] : []),
        ...(setup ? ['setup'] : []),
        'agent',
      ]
      this.progress(id, steps, steps[0], branch)
      await mkdir(dirname(directory), { recursive: true })
      signal?.throwIfAborted()
      this.resetPreparation(id)
      await createPullBranchWorktree(
        this.git,
        root,
        task.pullRequest,
        directory,
        key,
        restoring,
        signal,
      )
      this.store.updateTask(id, (current) => ({
        ...current,
        checkoutBranch: branch,
        worktreeSetupComplete: false,
        worktreeSubmodulesComplete: false,
      }))
      return this.prepare(id, directory, steps, branch, signal)
    }
    // A removed worktree keeps its branch (Settings → Worktrees, or the archive cleanup). Reattach
    // that branch so committed work carries on, even if the title or prefix changed since.
    const branches = (
      await this.git.command(root, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    ).split('\n')
    let kept =
      task.checkoutBranch?.endsWith(`-${suffix}`) && branches.includes(task.checkoutBranch)
        ? task.checkoutBranch
        : branches.find((name) => name.endsWith(`-${suffix}`))
    const prefix = this.branchPrefix()
    let branch = kept ?? taskBranchName(task.title, suffix, prefix)
    const occupied = kept && records.find((record) => record.branch === `refs/heads/${kept}`)
    if (occupied) {
      if (occupied.path !== root || task.worktreeBaseBranch !== kept)
        throw new HttpError(
          409,
          'The task branch is checked out in another folder. Release that branch before restoring its worktree; existing files were preserved.',
        )
      // A handoff back out of the project folder starts a new branch at that folder's tip.
      // Keep every prior task branch and leave the main checkout where the user placed it.
      kept = undefined
      const names = new Set(branches)
      let index = 1
      do {
        branch = taskBranchName(task.title, `worktree-${index++}-${suffix}`, prefix)
      } while (names.has(branch))
    }
    const identity = await this.git.repositoryIdentity(root, true).catch(() => undefined)
    const directory = join(worktrees, taskWorktreePath(identity, root, branch, prefix))
    // Never reset an existing branch or remove a checkout. A collision/missing checkout needs repair.
    signal?.throwIfAborted()
    await mkdir(dirname(directory), { recursive: true })
    if (kept) {
      const steps = ['restore', ...(setup ? ['setup'] : []), 'agent']
      this.progress(id, steps, 'restore', kept)
      this.resetPreparation(id)
      await this.git.addWorktree(root, directory, [directory, kept], signal)
      // A fresh checkout lacks installed dependencies; run the setup command again.
      this.store.updateTask(id, (current) => ({
        ...current,
        worktreeSetupComplete: false,
        worktreeSubmodulesComplete: false,
      }))
      return this.prepare(id, directory, steps, kept, signal)
    }
    if (task.worktreeIncludeChanges && task.worktreeBaseBranch)
      throw new HttpError(
        400,
        'Copying uncommitted changes starts from the current checkout. Clear the selected base branch first.',
      )
    const fetching =
      !task.pullRequest &&
      !task.worktreeBaseBranch &&
      !task.worktreeIncludeChanges &&
      !!task.worktreeFromOrigin
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
    if (refs && fetching)
      refs = await this.fetchOrigin(root, signal).then(() => listBranches({ git: this.git }, root))
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
    const unborn = refs?.revision.startsWith('unborn:')
    if (
      !task.pullRequest &&
      !task.forkedFrom?.head &&
      !(unborn && !task.worktreeBaseBranch) &&
      (!base || !refs?.branches.some((branch) => branch.ref === base))
    )
      throw new HttpError(400, 'Choose an existing base branch for the worktree')
    let head = task.pullRequest
      ? await fetchPullHead(this.git, root, task.pullRequest, key, signal)
      : (task.forkedFrom?.head ??
        (unborn && !task.worktreeBaseBranch ? await this.git.initialWorktreeCommit(root) : base) ??
        'HEAD')
    if (task.worktreeInitialSnapshot) head = task.worktreeInitialSnapshot.head
    else if (task.worktreeIncludeChanges && !task.pullRequest && !task.forkedFrom) {
      const sourceHead = unborn
        ? undefined
        : (await this.git.command(root, ['rev-parse', '--verify', 'HEAD'])).trim()
      if (sourceHead) head = sourceHead
      const tree = await this.git.snapshot(root, `refs/dovo/worktrees/${id}/initial`)
      const afterHead = await this.git
        .command(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])
        .then(
          (value) => value.trim(),
          () => undefined,
        )
      if (sourceHead !== afterHead)
        throw new HttpError(409, 'The source branch changed while copying files. Try again.')
      await this.git.command(root, ['update-ref', `refs/dovo/worktrees/${id}/base`, head])
      this.store.updateTask(id, (current) => ({
        ...current,
        worktreeInitialSnapshot: { tree, head },
      }))
    }
    // Resolve once, so the recorded base is exactly where the branch starts even if the
    // project folder switches branches or the base moves meanwhile.
    head = (await this.git.command(root, ['rev-parse', '--verify', `${head}^{commit}`])).trim()
    if (!task.pullRequest) {
      // Copied changes start from the folder's current commit, not from the selected base.
      // A fork at a source commit compares with that commit, never the folder's own branch.
      const checkedOut = refs && !unborn ? `refs/heads/${refs.current}` : undefined
      const sourceRef = task.forkedFrom?.head
        ? undefined
        : task.worktreeIncludeChanges && !task.forkedFrom
          ? refs?.branches.find((item) => item.ref === checkedOut)?.ref
          : base
      const recorded = task.worktreeBase
      // A handoff restarting from the task's own previous branch keeps that branch's base;
      // without one, the default branch remains a better base than the task's own work.
      const own = !!task.checkoutBranch && sourceRef === `refs/heads/${task.checkoutBranch}`
      const worktreeBase =
        recorded && (recorded.branch === branch || own)
          ? { ...recorded, branch }
          : own
            ? { branch }
            : { branch, ...(sourceRef ? { ref: sourceRef } : {}), commit: head }
      this.store.updateTask(id, (current) => ({ ...current, worktreeBase }))
    }
    this.progress(id, steps, 'worktree', branch)
    signal?.throwIfAborted()
    this.resetPreparation(id)
    // Starting at origin's base is not an instruction to push task commits back to that base.
    await this.git.addWorktree(
      root,
      directory,
      ['--no-track', '-b', branch, directory, head],
      signal,
    )
    this.store.updateTask(id, (current) => ({ ...current, checkoutBranch: branch }))
    return this.prepare(id, directory, steps, branch, signal)
  }
  private resetPreparation(id: string) {
    // Persist before creation: a crash or cancellation must not reuse completion flags from an old folder.
    this.store.updateTask(id, (current) => ({
      ...current,
      worktreeSetupComplete: false,
      worktreeSubmodulesComplete: false,
    }))
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
  private async fetchOrigin(root: string, signal?: AbortSignal) {
    const remotes = (await this.git.command(root, ['remote']))
      .split('\n')
      .map((name) => name.trim())
    if (!remotes.includes('origin')) return
    await this.git
      .checkoutCommand(root, ['fetch', '--quiet', '--no-tags', 'origin'], signal, undefined, 30000)
      .catch((error: unknown) => {
        if (error instanceof OwnedProcessShutdownError || signal?.aborted) throw error
      })
    signal?.throwIfAborted()
    // Learn origin's default branch once, for clones that never recorded origin/HEAD.
    const known = await this.git
      .command(root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
      .then(() => true)
      .catch(() => false)
    if (!known)
      await this.git
        .checkoutCommand(root, ['remote', 'set-head', 'origin', '--auto'], signal, undefined, 30000)
        .catch((error: unknown) => {
          if (error instanceof OwnedProcessShutdownError || signal?.aborted) throw error
        })
  }
  private async prepare(
    id: string,
    directory: string,
    steps: string[] = [],
    branch?: string,
    signal?: AbortSignal,
  ) {
    const task = this.store.taskSummary(id)
    const needsPreparation =
      !!task.forkedFrom?.snapshot ||
      !!task.worktreeInitialSnapshot ||
      (!!task.setupCommand?.trim() && !task.worktreeSetupComplete) ||
      (!!task.submodules && task.submodules !== 'none' && !task.worktreeSubmodulesComplete)
    const prepare = () => this.finishPreparation(id, directory, steps, branch, signal)
    return needsPreparation
      ? this.git.withWorktreePreparation(directory, prepare, signal)
      : prepare()
  }
  private async finishPreparation(
    id: string,
    directory: string,
    steps: string[],
    branch: string | undefined,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted()
    const cwd = (await this.git.inspect(directory)).path
    const task = this.store.taskSummary(id)
    if (task.forkedFrom?.snapshot) {
      await this.git.restoreSnapshot(
        cwd,
        task.forkedFrom.snapshot,
        `refs/dovo/forks/${id}/base`,
        undefined,
        signal,
      )
      signal?.throwIfAborted()
      this.store.updateTask(id, (current) =>
        current.forkedFrom
          ? { ...current, forkedFrom: { ...current.forkedFrom, snapshot: undefined } }
          : current,
      )
    }
    if (task.worktreeInitialSnapshot) {
      await this.git.restoreSnapshot(
        cwd,
        task.worktreeInitialSnapshot.tree,
        `refs/dovo/worktrees/${id}/before-copy`,
        undefined,
        signal,
      )
      signal?.throwIfAborted()
      this.store.updateTask(id, (current) => ({ ...current, worktreeInitialSnapshot: undefined }))
    }
    if (task.submodules && task.submodules !== 'none' && !task.worktreeSubmodulesComplete) {
      this.progress(id, steps, 'submodules', branch)
      signal?.throwIfAborted()
      // URL registration writes the shared repository config. Keep the later clone and
      // checkout work outside that lock so independent worktrees can prepare in parallel.
      await this.git.withSharedConfig(
        cwd,
        () => this.git.checkoutCommand(cwd, ['submodule', 'init'], signal),
        signal,
      )
      signal?.throwIfAborted()
      await this.git.checkoutCommand(
        cwd,
        [
          'submodule',
          'update',
          '--init',
          ...(task.submodules === 'recursive' ? ['--recursive'] : []),
        ],
        signal,
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
        if (error instanceof OwnedProcessShutdownError || signal?.aborted) throw error
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
