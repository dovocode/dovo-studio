import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { dirname, join, resolve, basename } from 'node:path'
import { type ProjectTransferManifest, type projectTransferProjectSchema } from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError } from '../../errors.js'
import { repositoryPath } from './paths.js'
import { projectTransferRemote, restoreTransfer, transferGit } from './project-transfer-files.js'
import { taskWorktreePath } from '../tasks/task-branch.js'

export type TransferOwnership = {
  path: string
  project?: string
  repositoryPath: string
  branch?: string
}
export async function transferDestinations(
  s: Services,
  project: typeof projectTransferProjectSchema.Type,
) {
  const repositories = []
  for (const repo of s.store.get().repositories) {
    if (repo.kind) continue
    try {
      const identity = await s.git.repositoryIdentity(repo.path, true)
      const matches = project.identity
        ? identity === project.identity
        : !identity &&
          (await transferGit(s, repo.path, ['rev-list', '--max-parents=0', 'HEAD']))
            .trim()
            .split('\n')
            .includes(project.rootCommit)
      if (matches) repositories.push({ id: repo.id, name: repo.name, path: repo.path })
    } catch {
      // An unavailable project cannot receive a linked checkout; other projects remain usable.
    }
  }
  return { repositories, worktreesRoot: s.preferences.worktreesRoot() }
}
export async function validateWorktreeDestination(
  s: Services,
  worktree: NonNullable<ProjectTransferManifest['worktree']>,
) {
  const plan = await transferDestinations(s, worktree)
  const selected = worktree.destination
  if ('repositoryId' in selected) {
    const repository = plan.repositories.find((repo) => repo.id === selected.repositoryId)
    if (!repository)
      throw new HttpError(
        409,
        'The destination project changed. Refresh copy options and choose the project again.',
      )
    return repository
  }
  if (plan.repositories.length)
    throw new HttpError(
      409,
      'This project is already on the destination. Refresh copy options and choose it.',
    )
  const parent = await repositoryPath(selected.parentDirectory)
  if (await s.git.isRepository(parent))
    throw new HttpError(409, 'Choose a project folder outside a Git repository')
  return { parent }
}
export async function cleanupTransferredWorktree(
  s: Services,
  owned: TransferOwnership,
  id: string,
) {
  // Paths were reserved with mkdtemp by this receiver and persisted before Git used them.
  const registered =
    owned.repositoryPath &&
    (await s.git.isRepository(owned.repositoryPath)) &&
    (await transferGit(s, owned.repositoryPath, ['worktree', 'list', '--porcelain', '-z']))
      .split('\0')
      .some(
        (line) => line.startsWith('worktree ') && resolve(line.slice(9)) === resolve(owned.path),
      )
  if (registered)
    await transferGit(s, owned.repositoryPath, ['worktree', 'remove', '--force', '--', owned.path])
  else await rm(owned.path, { recursive: true, force: true })
  if (owned.repositoryPath && (await s.git.isRepository(owned.repositoryPath))) {
    const refs = (
      await transferGit(s, owned.repositoryPath, [
        'for-each-ref',
        '--format=%(refname)',
        'refs/heads/',
      ])
    )
      .trim()
      .split('\n')
    const root = owned.repositoryPath
    const branch = owned.branch
    if (branch && refs.includes(`refs/heads/${branch}`))
      await s.git.withSharedConfig(root, () => transferGit(s, root, ['branch', '-D', '--', branch]))
    for (const ref of ['head', 'base'])
      await transferGit(s, owned.repositoryPath, [
        'update-ref',
        '-d',
        `refs/dovo/copies/${id}/${ref}`,
      ])
  }
  if (owned.project) await rm(owned.project, { recursive: true, force: true })
}
export async function installWorktreeTransfer(
  s: Services,
  manifest: ProjectTransferManifest,
  folder: string,
  signal: AbortSignal,
  saveOwnership: (owned: TransferOwnership) => void,
) {
  const worktree = manifest.worktree,
    git = manifest.git
  if (!worktree || !git) throw new HttpError(400, 'Missing worktree Git history')
  const destination = await validateWorktreeDestination(s, worktree)
  const slug = manifest.name.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 60) || 'project'
  const root = s.preferences.worktreesRoot()
  await mkdir(root, { recursive: true })
  const parent = await realpath(root)
  if (await s.git.isRepository(parent))
    throw new HttpError(409, 'The worktree directory must be outside a Git repository')
  const relative = taskWorktreePath(
    worktree.identity,
    manifest.name,
    `${git.branch ?? 'detached'}-copy-${manifest.id.slice(0, 8)}`,
  )
  const prefix = join(parent, relative)
  await mkdir(dirname(prefix), { recursive: true })
  const directory = await realpath(dirname(prefix))
  const path = await mkdtemp(join(directory, `${basename(prefix)}-`))
  let project: string | undefined
  let repositoryPath = 'path' in destination ? destination.path : ''
  let owned: TransferOwnership = { path, repositoryPath }
  saveOwnership(owned)
  if ('parent' in destination) {
    project = await mkdtemp(join(destination.parent, `${slug}-`))
    repositoryPath = project
    owned = { path, repositoryPath, project }
    saveOwnership(owned)
  }
  const bundle = manifest.entries.findIndex((entry) => entry.kind === 'bundle')
  if (bundle < 0) throw new HttpError(400, 'Missing Git history')
  const command = (args: string[]) => transferGit(s, repositoryPath, args, signal)
  const namespace = `refs/dovo/copies/${manifest.id}`
  if (project) await command(['init'])
  // Import into a private namespace: never move the destination's branches or tags.
  await command([
    'fetch',
    '--no-tags',
    '--no-write-fetch-head',
    '--no-recurse-submodules',
    '--',
    join(folder, String(bundle)),
    `${git.head}:${namespace}/head`,
    `${worktree.baseHead}:${namespace}/base`,
  ])
  if (project) {
    if (worktree.baseBranch) {
      await command(['check-ref-format', '--branch', worktree.baseBranch])
      await command(['symbolic-ref', 'HEAD', `refs/heads/${worktree.baseBranch}`])
    } else await command(['update-ref', '--no-deref', 'HEAD', worktree.baseHead])
    await command(['reset', '--hard', worktree.baseHead])
    const remote = git.remote
    if (remote && projectTransferRemote(remote))
      await s.git.withSharedConfig(repositoryPath, () =>
        command(['remote', 'add', 'origin', remote]),
      )
  }
  const branches = (await command(['for-each-ref', '--format=%(refname)', 'refs/heads/']))
    .trim()
    .split('\n')
  let branch = git.branch
  if (branch) {
    await command(['check-ref-format', '--branch', branch])
    if (branches.includes(`refs/heads/${branch}`))
      branch = `dovo/copy-${manifest.id}-${path.slice(-6)}`
  }
  await s.git.withSharedConfig(repositoryPath, () =>
    command([
      'worktree',
      'add',
      '--no-checkout',
      ...(branch ? ['-b', branch] : ['--detach']),
      '--',
      path,
      git.head,
    ]),
  )
  if (branch) {
    owned = { ...owned, branch }
    saveOwnership(owned)
  }
  await transferGit(s, path, ['reset', '--mixed', git.head], signal)
  await restoreTransfer(s, manifest, folder, path, signal)
  await command(['update-ref', '-d', `${namespace}/head`])
  await command(['update-ref', '-d', `${namespace}/base`])
  signal.throwIfAborted()
  const checkout = await s.git.inspect(repositoryPath)
  const copiedCheckout = await s.git.inspect(path)
  const common = (await command(['rev-parse', '--path-format=absolute', '--git-common-dir'])).trim()
  return {
    path: copiedCheckout.path,
    branch: copiedCheckout.branch,
    common,
    repository: 'id' in destination ? destination : { name: manifest.name, ...checkout },
  }
}
