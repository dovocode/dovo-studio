import { fetchPullHead } from './pull-head.js'
import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'
import type { WorkspaceStore } from '../storage/workspace.js'
import type { GitService } from './git.js'
import { HttpError } from '../errors.js'
export class TaskCheckout {
  private pending = new Map<string, Promise<string>>()
  constructor(
    private store: WorkspaceStore,
    private git: GitService,
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
    const common = (
      await this.git.command(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
    ).trim()
    const key = createHash('sha256').update(id).digest('hex').slice(0, 24)
    const repositoryKey = createHash('sha256').update(common).digest('hex').slice(0, 24)
    const directory = join(homedir(), '.dovo', 'worktrees', repositoryKey, key)
    const records = (await this.git.command(root, ['worktree', 'list', '--porcelain', '-z'])).split(
      '\0',
    )
    if (records.includes(`worktree ${directory}`)) return (await this.git.inspect(directory)).path
    // Never reset an existing branch or remove a checkout. A collision/missing checkout needs repair.
    await mkdir(dirname(directory), { recursive: true })
    const head = task.pullRequest
      ? await fetchPullHead(this.git, root, task.pullRequest, key)
      : 'HEAD'
    await this.git.command(root, ['worktree', 'add', '-b', `dovo/task-${key}`, directory, head])
    return (await this.git.inspect(directory)).path
  }
}
