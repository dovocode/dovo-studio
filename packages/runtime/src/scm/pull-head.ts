import type { Task } from '@dovo/protocol'
import type { GitService } from './git.js'
import { HttpError } from '../errors.js'
export async function fetchPullHead(
  git: GitService,
  cwd: string,
  source: NonNullable<Task['pullRequest']>,
  key: string,
) {
  const ref = `refs/dovo/pull-tasks/${key}`
  await git.fetchPull(cwd, source.repositoryUrl, source.number, ref, source)
  const sha = (await git.command(cwd, ['rev-parse', '--verify', ref])).trim()
  if (sha !== source.headSha)
    throw new HttpError(
      409,
      'The PR head changed before checkout. Refresh the PR and create a new task; this task remains linked to its original commit.',
    )
  return sha
}
