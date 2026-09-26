import { taskBranchName, taskWorktreePath } from './task-branch.js'
import { defaultWorktreeBase, canChangeTaskCheckout } from '@dovo/protocol'
import { listBranches } from './branches.js'
import { fetchPullHead } from './pull-head.js'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, join, sep } from 'node:path'
import { homedir } from 'node:os'
import type { WorkspaceStore } from '../storage/workspace.js'
import type { GitService } from './git.js'
import { HttpError } from '../errors.js'
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
  constructor(
    private store: WorkspaceStore,
    private git: GitService,
    /** Settings → Coding → Task defaults → Branch prefix for new task branches. */
    private branchPrefix: () => string = () => 'dovo/',
  ) {}
  directory(id: string): Promise<string> {
    const pending = this.pending.get(id)
    if (pending) return pending
    const result = this.resolve(id).finally(() => this.pending.delete(id))
    this.pending.set(id, result)
    return result
  }
  private async resolve(id: string) {
    const task = this.store.task(id)
    const repo = this.store.get().repositories.find((r) => r.id === task.repositoryId)
    if (!repo) throw new HttpError(404, 'Repository not found')
    const { path: root } = await this.git.inspect(repo.path)
    if (task.execution !== 'worktree') return root
    if (canChangeTaskCheckout(task))
      throw new HttpError(409, 'Send the first prompt before creating the worktree')
    const common = (
      await this.git.command(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ).trim()
    const keys = taskWorktreeKeys(common, id)
    const { key, suffix, worktrees } = keys
    const paths = (await this.git.command(root, ['worktree', 'list', '--porcelain', '-z']))
      .split('\0')
      .flatMap((record) => (record.startsWith('worktree ') ? [record.slice(9)] : []))
    const existing = paths.find((path) => isTaskWorktree(path, keys))
    if (existing) return this.prepare(id, existing)
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
      await this.git.command(root, ['worktree', 'add', directory, kept])
      // A fresh checkout lacks installed dependencies; run the setup command again.
      this.store.updateTask(id, (current) => ({ ...current, worktreeSetupComplete: false }))
      return this.prepare(id, directory)
    }
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
    if (!task.pullRequest && (!base || !refs?.branches.some((branch) => branch.ref === base)))
      throw new HttpError(400, 'Choose an existing base branch for the worktree')
    const head = task.pullRequest
      ? await fetchPullHead(this.git, root, task.pullRequest, key)
      : (base ?? 'HEAD')
    await this.git.command(root, ['worktree', 'add', '-b', branch, directory, head])
    return this.prepare(id, directory)
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
  private async prepare(id: string, directory: string) {
    const cwd = (await this.git.inspect(directory)).path
    const task = this.store.task(id)
    if (task.setupCommand?.trim() && !task.worktreeSetupComplete) {
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
