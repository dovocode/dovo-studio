import type { LinkedCheckpoint } from '@dovo/protocol'
import { errorMessage } from '../../errors.js'
import type { GitService } from '../git/git.js'
import type {
  LinkedCheckouts,
  LinkedCheckpointTarget,
  ResolvedCheckout,
} from './linked-checkouts.js'

export async function linkedBefore(
  git: GitService,
  turnId: string,
  links: ResolvedCheckout[],
  nested: LinkedCheckpointTarget[],
) {
  const targets: LinkedCheckpointTarget[] = links
    .filter((link) => link.access === 'edit' && link.git)
    .map((link) => ({
      checkoutId: link.id,
      repositoryId: link.repositoryId,
      repositoryName: link.name,
      directory: link.directory,
      branch: link.branch,
    }))
  const checkpoints: LinkedCheckpoint[] = []
  for (const target of [...targets, ...nested]) {
    checkpoints.push({
      ...target,
      before: await git.snapshot(
        target.directory,
        `refs/dovo/checkpoints/${turnId}/linked/${target.checkoutId}/before`,
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
  checkouts?: LinkedCheckouts,
) {
  const result: LinkedCheckpoint[] = []
  for (const checkpoint of checkpoints) {
    if (checkpoint.nestedWorktree && !checkpoint.after && checkouts) {
      try {
        await checkouts.checkpointDirectory(checkpoint, true)
      } catch (error) {
        result.push({ ...checkpoint, error: errorMessage(error) })
        continue
      }
    }
    const after =
      checkpoint.after ??
      (await git.turnAfterSnapshot(checkpoint.directory, turnId, checkpoint.checkoutId))
    result.push({
      ...checkpoint,
      after,
      error: undefined,
      ...(await git.checkpointChanges(checkpoint.directory, checkpoint.before, after)),
    })
  }
  return result
}
