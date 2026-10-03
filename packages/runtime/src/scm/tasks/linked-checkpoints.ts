import type { LinkedCheckpoint } from '@dovo/protocol'
import type { GitService } from '../git/git.js'
import type { ResolvedCheckout } from './linked-checkouts.js'

export async function linkedBefore(git: GitService, turnId: string, links: ResolvedCheckout[]) {
  const checkpoints: LinkedCheckpoint[] = []
  for (const link of links) {
    if (link.access !== 'edit') continue
    if (!link.git) continue
    checkpoints.push({
      checkoutId: link.id,
      repositoryId: link.repositoryId,
      repositoryName: link.name,
      directory: link.directory,
      branch: link.branch,
      before: await git.snapshot(
        link.directory,
        `refs/dovo/checkpoints/${turnId}/linked/${link.id}/before`,
      ),
      files: [],
      omitted: [],
    })
  }
  return checkpoints
}

/** Saved directory identity is retained even if the link is subsequently removed. */
export async function linkedAfter(
  git: GitService,
  turnId: string,
  checkpoints: readonly LinkedCheckpoint[],
) {
  const result: LinkedCheckpoint[] = []
  for (const checkpoint of checkpoints) {
    const after =
      checkpoint.after ??
      (await git.snapshot(
        checkpoint.directory,
        `refs/dovo/checkpoints/${turnId}/linked/${checkpoint.checkoutId}/after`,
      ))
    result.push({
      ...checkpoint,
      after,
      error: undefined,
      ...(await git.checkpointChanges(checkpoint.directory, checkpoint.before, after)),
    })
  }
  return result
}
