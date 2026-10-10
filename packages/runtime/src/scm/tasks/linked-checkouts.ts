import { isDeepStrictEqual } from 'node:util'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  decode,
  taskFamilyWorking,
  nativeAgentWorking,
  linkedCheckoutsSchema,
  type LinkedCheckout,
  type LinkedCheckpoint,
} from '@dovo/protocol'
import type { WorkspaceStore } from '../../storage/workspace.js'
import type { GitService } from '../git/git.js'
import { HttpError } from '../../errors.js'
import { isTaskWorktree, taskWorktreeKeys, worktreesRoot } from './task-worktree-keys.js'
import { taskBranchName, taskWorktreePath } from './task-branch.js'
import { repositoryPath } from '../repositories/paths.js'
import { listBranches } from '../git/branches.js'
import { defaultWorktreeBase, canChangeTaskCheckout } from '@dovo/protocol'
import { PendingCheckouts } from './pending-checkouts.js'

export type ResolvedCheckout = LinkedCheckout & {
  directory: string
  name: string
  git: boolean
  branch?: string
}

/** Resolves only projects registered on this runtime. No user-supplied arbitrary directories. */
export class LinkedCheckouts {
  private pending = new PendingCheckouts<ResolvedCheckout[]>()
  constructor(
    private store: WorkspaceStore,
    private git: GitService,
    private worktrees: () => string = worktreesRoot,
  ) {}

  /** Saved trees belong to the repository, not to the lifetime of a linked directory. */
  async checkpointDirectory(checkpoint: LinkedCheckpoint, restore = false) {
    const repo = this.store.get().repositories.find((item) => item.id === checkpoint.repositoryId)
    if (!repo || repo.kind) throw new HttpError(404, 'The saved checkpoint project is unavailable')
    const root = (await this.git.inspect(repo.path)).path
    if (!restore) return root
    const records = (await this.git.command(root, ['worktree', 'list', '--porcelain', '-z']))
      .split('\0\0')
      .map((block) => block.split('\0'))
      .filter((record) => !record.some((line) => line.startsWith('prunable')))
    const branch = checkpoint.branch && `branch refs/heads/${checkpoint.branch}`
    const listed =
      records.find(
        (record) =>
          record.includes(`worktree ${checkpoint.directory}`) &&
          (!branch || record.includes(branch)),
      ) ?? (branch ? records.find((record) => record.includes(branch)) : undefined)
    const directory = listed?.find((line) => line.startsWith('worktree '))?.slice(9)
    if (directory) return directory
    if (!checkpoint.branch)
      throw new HttpError(409, 'Restore the saved linked checkout before undoing its changes')
    const identity = await this.git.repositoryIdentity(root)
    const target = join(this.worktrees(), taskWorktreePath(identity, root, checkpoint.branch))
    await mkdir(dirname(target), { recursive: true })
    await this.git.command(root, ['worktree', 'prune'])
    // Reattach only the saved branch; never reset another checkout or invent a replacement branch.
    await this.git.addWorktree(root, target, [target, checkpoint.branch])
    return target
  }

  validate(value: unknown) {
    const links = decode(linkedCheckoutsSchema, value)
    if (new Set(links.map((link) => link.id)).size !== links.length)
      throw new HttpError(400, 'Linked checkout IDs must be unique')
    for (const link of links) {
      const repo = this.store.get().repositories.find((item) => item.id === link.repositoryId)
      if (!repo || repo.kind === 'scratch')
        throw new HttpError(400, 'Choose a project on this computer')
      if (repo.kind && link.execution === 'worktree')
        throw new HttpError(400, 'This project does not support worktrees')
      if (
        link.execution === 'main' &&
        (link.existingWorktreePath || link.branch || link.baseBranch)
      )
        throw new HttpError(400, 'Branch and worktree settings require a worktree checkout')
      if (link.existingWorktreePath && (link.branch || link.baseBranch))
        throw new HttpError(400, 'An existing worktree already has its own branch')
    }
    return links
  }

  save(id: string, before: unknown, value: unknown) {
    const task = this.store.task(id)
    if (task.delegation)
      throw new HttpError(400, 'Child agents inherit their parent’s linked projects')
    if (
      task.status === 'running' ||
      task.queue?.length ||
      task.archivedAt ||
      task.subagents?.some(nativeAgentWorking) ||
      this.store
        .get()
        .tasks.some(
          (child) =>
            child.delegation?.parentTaskId === id &&
            taskFamilyWorking(this.store.get().tasks, child.id),
        )
    )
      throw new HttpError(409, 'Finish or stop pending work before changing linked projects')
    const links = this.validate(value)
    if (isDeepStrictEqual(task.linkedCheckouts ?? [], links)) return { ok: true }
    if (!isDeepStrictEqual(task.linkedCheckouts ?? [], before))
      throw new HttpError(409, 'Linked projects changed. Reload before saving.')
    for (const link of links) {
      const previous = task.linkedCheckouts?.find((item) => item.id === link.id)
      if (
        previous &&
        task.linkedCheckoutSetup?.some((item) => item.id === link.id) &&
        !isDeepStrictEqual({ ...previous, access: undefined }, { ...link, access: undefined })
      )
        throw new HttpError(
          409,
          'This linked worktree already exists. Remove the link and add a new checkout to change its branch or base.',
        )
    }
    this.store.updateTask(id, (current) => ({
      ...current,
      linkedCheckouts: links,
      sessionId: undefined,
      sessionAgentId: undefined,
    }))
    return { ok: true }
  }

  resolve(id: string, signal?: AbortSignal): Promise<ResolvedCheckout[]> {
    signal?.throwIfAborted()
    const task = this.store.task(id)
    if (task.delegation) return this.resolve(task.delegation.parentTaskId, signal)
    return this.pending.run(id, (sharedSignal) => this.resolveAll(id, sharedSignal), signal)
  }

  private async resolveAll(id: string, signal?: AbortSignal) {
    const task = this.store.task(id)
    const links = this.validate(task.linkedCheckouts ?? [])
    const resolved: ResolvedCheckout[] = []
    for (const link of links) {
      signal?.throwIfAborted()
      const repo = this.store.get().repositories.find((item) => item.id === link.repositoryId)
      if (!repo) throw new HttpError(404, 'Linked project no longer exists')
      const root = repo.kind
        ? await repositoryPath(repo.path)
        : (await this.git.inspect(repo.path)).path
      signal?.throwIfAborted()
      if (link.execution === 'main') {
        resolved.push({ ...link, directory: root, name: repo.name, git: !repo.kind })
        continue
      }
      const records = (await this.git.command(root, ['worktree', 'list', '--porcelain', '-z']))
        .split('\0\0')
        .map((block) => block.split('\0'))
        .filter((record) => !record.some((line) => line.startsWith('prunable')))
      let directory = link.existingWorktreePath
      let branch = link.branch
      if (directory) {
        if (
          directory === root ||
          !records.some((record) => record.includes(`worktree ${directory}`))
        )
          throw new HttpError(
            409,
            'A linked worktree is no longer available. Choose another checkout.',
          )
      } else {
        if (canChangeTaskCheckout(task))
          throw new HttpError(409, 'Send the first prompt before creating linked worktrees')
        const common = (
          await this.git.command(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
        ).trim()
        const keys = taskWorktreeKeys(common, `${id}:linked:${link.id}`, this.worktrees())
        directory = records.flatMap((record) => {
          const path = record.find((line) => line.startsWith('worktree '))?.slice(9)
          const branch = record.find((line) => line.startsWith('branch '))?.slice(7)
          return path && isTaskWorktree(path, keys, branch) ? [path] : []
        })[0]
        if (!directory) {
          const kept = (
            await this.git.command(root, [
              'for-each-ref',
              '--format=%(refname:short)',
              'refs/heads',
            ])
          )
            .split('\n')
            .find((name) => name.endsWith(`-${keys.suffix}`))
          // A suffix prevents two automation runs from trying to own the same branch.
          branch =
            kept ??
            `${link.branch?.trim() || taskBranchName(task.title, keys.suffix, 'dovo/').replace(`-${keys.suffix}`, '')}-${keys.suffix}`
          await this.git.command(root, ['check-ref-format', '--branch', branch])
          const identity = await this.git.repositoryIdentity(root)
          directory = join(keys.worktrees, taskWorktreePath(identity, root, branch, 'dovo/'))
          await mkdir(dirname(directory), { recursive: true })
          this.store.updateTask(id, (current) => ({
            ...current,
            linkedCheckoutSetup: current.linkedCheckoutSetup?.filter(
              (entry) => entry.id !== link.id,
            ),
          }))
          signal?.throwIfAborted()
          if (kept) {
            await this.git.command(root, ['worktree', 'prune'])
            signal?.throwIfAborted()
            await this.git.addWorktree(root, directory, [directory, kept])
          } else {
            const refs = await listBranches({ git: this.git }, root)
            const selection =
              link.baseBranch ??
              defaultWorktreeBase(refs.branches, refs.current, false, refs.originDefault)
            const base = refs.branches.find(
              (item) => item.ref === selection || item.name === selection,
            )?.ref
            if (!base)
              throw new HttpError(400, 'Choose an existing base branch for the linked worktree')
            signal?.throwIfAborted()
            await this.git.addWorktree(root, directory, ['-b', branch, directory, base])
          }
        }
      }
      if (
        !link.existingWorktreePath &&
        !this.store
          .task(id)
          .linkedCheckoutSetup?.some(
            (entry) => entry.id === link.id && entry.directory === directory,
          )
      ) {
        const setup = this.store.taskDefaults(link.repositoryId).setupCommand
        signal?.throwIfAborted()
        if (setup?.trim()) await this.git.setupWorktree(directory, setup, signal)
        signal?.throwIfAborted()
        this.store.updateTask(id, (current) => ({
          ...current,
          linkedCheckoutSetup: [
            ...(current.linkedCheckoutSetup ?? []).filter((entry) => entry.id !== link.id),
            { id: link.id, directory },
          ],
        }))
      }
      signal?.throwIfAborted()
      const inspected = await this.git.inspect(directory)
      resolved.push({
        ...link,
        directory: inspected.path,
        name: repo.name,
        git: true,
        branch: inspected.branch,
      })
    }
    if (new Set(resolved.map((link) => link.directory)).size !== resolved.length)
      throw new HttpError(400, 'The same checkout cannot be linked twice')
    return resolved
  }
}
