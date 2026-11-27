import {
  worktreeRecords,
  availableWorktree,
  requireCompleteWorktree,
} from '../git/worktree-records.js'
import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import { lstat, mkdir, readFile, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  decode,
  taskFamilyWorking,
  nativeAgentWorking,
  linkedCheckoutsSchema,
  containerSandboxEnabled,
  type LinkedCheckout,
  type LinkedCheckpoint,
  type TaskMetadata,
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

export type LinkedCheckpointTarget = Pick<
  LinkedCheckpoint,
  'checkoutId' | 'repositoryId' | 'repositoryName' | 'directory' | 'branch' | 'nestedWorktree'
>

export type ResolvedCheckout = LinkedCheckout & {
  directory: string
  name: string
  git: boolean
  branch?: string
}

type DiscoveredWorktree = {
  repositoryId: string
  path: string
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
    if (checkpoint.nestedWorktree) {
      const record = await this.registeredNestedWorktree(root, checkpoint.directory)
      const branch = record?.branch?.replace(/^refs\/heads\//, '')
      if (record && branch === checkpoint.branch) return checkpoint.directory
      throw new HttpError(409, 'The saved child worktree is unavailable or has changed branches')
    }
    const records = worktreeRecords(
      await this.git.command(root, ['worktree', 'list', '--porcelain', '-z']),
    )
    const branch = checkpoint.branch && `refs/heads/${checkpoint.branch}`
    const matching = records.filter(
      (record) =>
        (record.path === checkpoint.directory && (!branch || record.branch === branch)) ||
        (branch && record.branch === branch),
    )
    for (const record of matching) requireCompleteWorktree(record)
    const directory =
      matching.find(
        (record) => record.path === checkpoint.directory && !record.prunable && !record.creating,
      )?.path ?? matching.find((record) => availableWorktree(record, root))?.path
    if (directory) return directory
    if (!checkpoint.branch)
      throw new HttpError(409, 'Restore the saved linked checkout before undoing its changes')
    const identity = await this.git.repositoryIdentity(root, true)
    const target = join(this.worktrees(), taskWorktreePath(identity, root, checkpoint.branch))
    await mkdir(dirname(target), { recursive: true })
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
    const task = this.store.taskSummary(id)
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
    const effective = task.pendingLinkedCheckouts ?? task.linkedCheckouts ?? []
    if (isDeepStrictEqual(effective, links)) return { ok: true }
    if (!isDeepStrictEqual(effective, before))
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
      pendingLinkedCheckouts: undefined,
      sessionId: undefined,
      sessionAgentId: undefined,
    }))
    return { ok: true }
  }

  resolve(id: string, signal?: AbortSignal): Promise<ResolvedCheckout[]> {
    signal?.throwIfAborted()
    const task = this.store.taskSummary(id)
    if (task.delegation) return this.resolve(task.delegation.parentTaskId, signal)
    return this.pending.run(id, (sharedSignal) => this.resolveAll(id, sharedSignal), signal)
  }

  /** Locate the registered child worktree at its project-relative path, without resolving it as a link. */
  async discoverNestedWorktrees(task: TaskMetadata, cwd?: string, signal?: AbortSignal) {
    if (
      !cwd ||
      task.execution !== 'worktree' ||
      task.delegation ||
      task.importedCodexSession ||
      task.importedPiSession ||
      containerSandboxEnabled(task.containerSandbox)
    )
      return []
    const repositories = this.store.get().repositories
    const primary = repositories.find((item) => item.id === task.repositoryId)
    if (!primary || primary.kind) return []
    const root = await realpath(cwd).catch(() => undefined)
    if (!root || root === resolve(primary.path)) return []
    const linked = new Set(task.linkedCheckouts?.map((item) => item.repositoryId))
    const discovered: DiscoveredWorktree[] = []
    for (const repository of repositories) {
      signal?.throwIfAborted()
      if (repository.kind || linked.has(repository.id)) continue
      const child = relative(primary.path, repository.path)
      if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child)) continue
      const candidate = join(root, child)
      const worktree = await this.registeredNestedWorktree(repository.path, candidate, signal)
      if (worktree)
        discovered.push({
          repositoryId: repository.id,
          path: candidate,
          branch: worktree.branch?.replace(/^refs\/heads\//, ''),
        })
    }
    return discovered
  }

  private async registeredNestedWorktree(source: string, path: string, signal?: AbortSignal) {
    try {
      if ((await realpath(path)) !== path) return
      const marker = join(path, '.git')
      const stat = await lstat(marker)
      if (!stat.isFile() || stat.size > 16_384) return
      const pointer = (await readFile(marker, 'utf8')).replace(/\r?\n$/, '')
      if (!pointer.startsWith('gitdir: ')) return
      const registered = await this.git.readCommand(
        source,
        ['worktree', 'list', '--porcelain', '-z'],
        { signal },
      )
      const record = worktreeRecords(registered).find(
        (item) => item.path && resolve(item.path) === path && availableWorktree(item, source),
      )
      if (!record) return
      const common = await this.git.readCommand(
        source,
        ['rev-parse', '--path-format=absolute', '--git-common-dir'],
        { signal },
      )
      const gitDirectory = await realpath(resolve(path, pointer.slice(8)))
      if (
        dirname(gitDirectory) !== (await realpath(join(common.replace(/\r?\n$/, ''), 'worktrees')))
      )
        return
      const registeredMarker = (await readFile(join(gitDirectory, 'gitdir'), 'utf8')).replace(
        /\r?\n$/,
        '',
      )
      if ((await realpath(resolve(gitDirectory, registeredMarker))) === marker) return record
    } catch {
      signal?.throwIfAborted()
    }
  }

  async nestedCheckpointTargets(
    cwd: string,
    discovered: readonly DiscoveredWorktree[],
    signal: AbortSignal,
  ): Promise<LinkedCheckpointTarget[]> {
    if (!discovered.length) return []
    const paths = discovered.map((worktree) => relative(cwd, worktree.path).split(sep).join('/'))
    // The parent and child snapshots must own disjoint sets of files.
    const [ignored, tracked] = await Promise.all([
      this.git.readCommand(cwd, ['check-ignore', '-z', '--stdin'], {
        input: `${paths.join('\0')}\0`,
        signal,
      }),
      this.git.readCommand(cwd, ['--literal-pathspecs', 'ls-files', '-z', '--', ...paths], {
        signal,
      }),
    ]).catch(() => ['', ''])
    signal.throwIfAborted()
    const ignoredPaths = new Set(ignored.split('\0'))
    const trackedPaths = tracked.split('\0')
    const repositories = this.store.get().repositories
    return discovered.flatMap(({ repositoryId, path, branch }, index) => {
      const child = paths[index]
      if (
        !ignoredPaths.has(child) ||
        trackedPaths.some((entry) => entry === child || entry.startsWith(`${child}/`))
      )
        return []
      return [
        {
          checkoutId: `nested.${createHash('sha256').update(repositoryId).digest('hex')}`,
          repositoryId,
          repositoryName: repositories.find((repository) => repository.id === repositoryId)?.name,
          directory: path,
          branch,
          nestedWorktree: true,
        },
      ]
    })
  }

  private async resolveAll(id: string, signal?: AbortSignal) {
    const task = this.store.taskSummary(id)
    const links = this.validate(task.linkedCheckouts ?? [])
    const resolved: ResolvedCheckout[] = []
    for (const link of links) {
      signal?.throwIfAborted()
      const repo = this.store.get().repositories.find((item) => item.id === link.repositoryId)
      if (!repo) throw new HttpError(404, 'Linked project no longer exists')
      const checkout = repo.kind ? undefined : await this.git.inspect(repo.path)
      const root = checkout?.path ?? (await repositoryPath(repo.path))
      signal?.throwIfAborted()
      if (link.execution === 'main') {
        resolved.push({
          ...link,
          directory: root,
          name: repo.name,
          git: !repo.kind,
          branch: checkout?.branch,
        })
        continue
      }
      const records = worktreeRecords(
        await this.git.command(root, ['worktree', 'list', '--porcelain', '-z']),
      )
      let directory = link.existingWorktreePath
      let branch = link.branch
      if (directory) {
        if (
          directory === root ||
          !records.some((record) => record.path === directory && availableWorktree(record, root))
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
        const matching = records.filter(
          (record) => record.path && isTaskWorktree(record.path, keys, record.branch),
        )
        for (const record of matching) requireCompleteWorktree(record)
        directory = matching.find((record) => availableWorktree(record, root))?.path
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
          const identity = await this.git.repositoryIdentity(root, true)
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
            signal?.throwIfAborted()
            await this.git.addWorktree(root, directory, [directory, kept], signal)
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
            await this.git.addWorktree(root, directory, ['-b', branch, directory, base], signal)
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
        const prepare = async () => {
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
        if (setup?.trim()) await this.git.withWorktreePreparation(directory, prepare, signal)
        else await prepare()
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
