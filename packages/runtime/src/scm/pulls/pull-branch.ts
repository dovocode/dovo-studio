import type { Task } from '@dovo/protocol'
import type { GitService } from '../git/git.js'
import { HttpError } from '../../errors.js'
import { fetchPullHead } from './pull-head.js'

export function pullSourceBranch(source: NonNullable<Task['pullRequest']>) {
  const branch = source.headBranch?.split(':').at(-1)
  if (!branch || branch.startsWith('-') || branch.includes('@{'))
    throw new HttpError(
      400,
      'The PR source branch is unavailable. Refresh the PR or choose a separate branch.',
    )
  return branch
}

/** Check conflicts before opening a draft, and again before creating its checkout. */
export async function inspectPullBranch(
  git: GitService,
  root: string,
  source: NonNullable<Task['pullRequest']>,
  directory?: string,
  restoring = false,
) {
  const branch = pullSourceBranch(source)
  await git.command(root, ['check-ref-format', '--branch', branch])
  const url = source.headCloneUrl
  if (!url)
    throw new HttpError(409, 'The PR source repository is unavailable. Choose a separate branch.')
  const parsed = new URL(url)
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new HttpError(400, 'Invalid PR source repository URL')
  const ref = `refs/heads/${branch}`
  const local = (
    await git.command(root, [
      'for-each-ref',
      '--format=%(refname)%00%(objectname)%00%(worktreepath)%00%(upstream:remotename)%00%(upstream:remoteref)',
      ref,
    ])
  )
    .trim()
    .split('\n')
    .map((line) => line.split('\0'))
    .find(([name]) => name === ref)
  if (local?.[2] && local[2] !== directory)
    throw new HttpError(
      409,
      `The PR branch ${branch} is already checked out elsewhere. Choose a separate branch or release that checkout.`,
    )
  if (local && !restoring && local[1] !== source.headSha)
    throw new HttpError(
      409,
      `The local branch ${branch} differs from the PR. Choose a separate branch; the local branch was kept.`,
    )
  if (local?.[3] && !restoring) await verifyPullRemote(git, root, local[3], url, ref, local[4])
  return { branch, url, ref, local }
}

async function verifyPullRemote(
  git: GitService,
  root: string,
  remote: string,
  url: string,
  ref: string,
  upstream?: string,
) {
  if (remote === '.')
    throw new HttpError(409, 'The PR branch tracks a local branch. Choose a separate branch.')
  const pushUrl = (await git.command(root, ['remote', 'get-url', '--push', remote])).trim()
  const expectedUrl = (await git.command(root, ['ls-remote', '--get-url', url])).trim()
  if (
    pushUrl.replace(/\.git\/?$/, '') !== expectedUrl.replace(/\.git\/?$/, '') ||
    (upstream && upstream !== ref)
  )
    throw new HttpError(
      409,
      'The local PR branch tracks a different destination. Choose a separate branch; its upstream was kept.',
    )
}

/** Attach the real PR branch without resetting refs or taking over another checkout. */
export async function createPullBranchWorktree(
  git: GitService,
  root: string,
  source: NonNullable<Task['pullRequest']>,
  directory: string,
  key: string,
  restoring: boolean,
) {
  if (restoring) await git.command(root, ['worktree', 'prune'])
  const { branch, url, ref, local } = await inspectPullBranch(
    git,
    root,
    source,
    directory,
    restoring,
  )
  if (restoring && local) {
    if (local[2] !== directory) await git.command(root, ['worktree', 'add', directory, branch])
    return branch
  }
  const head = await fetchPullHead(git, root, source, key)
  const remotes = (await git.command(root, ['remote'])).trim().split('\n').filter(Boolean)
  const remote = local?.[3] || `dovo-pr-${key}`
  if (remote === '.')
    throw new HttpError(409, 'The PR branch tracks a local branch. Choose a separate branch.')
  if (remotes.includes(remote)) {
    await verifyPullRemote(git, root, remote, url, ref, local?.[4])
  } else {
    if (local?.[3])
      throw new HttpError(409, 'The PR branch upstream is unavailable. Choose a separate branch.')
    await git.command(root, ['remote', 'add', remote, url])
  }
  if (local?.[2] !== directory)
    await git.command(
      root,
      local
        ? ['worktree', 'add', directory, branch]
        : ['worktree', 'add', '--no-track', '-b', branch, directory, head],
    )
  await git.command(root, ['update-ref', `refs/remotes/${remote}/${branch}`, head])
  await git.command(root, ['config', `branch.${branch}.remote`, remote])
  await git.command(root, ['config', `branch.${branch}.merge`, ref])
  return branch
}
