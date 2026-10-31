import { resolve } from 'node:path'
import { HttpError } from '../../errors.js'

/** NUL-delimited porcelain preserves spaces and newlines in checkout paths and lock reasons. */
export function worktreeRecords(output: string) {
  return output
    .split('\0\0')
    .filter(Boolean)
    .map((block, index) => {
      const lines = block.split('\0')
      return {
        path: lines.find((line) => line.startsWith('worktree '))?.slice(9),
        branch: lines.find((line) => line.startsWith('branch '))?.slice(7),
        main: index === 0,
        preparing: lines.some((line) => line.startsWith('locked dovo-preparing ')),
        prunable: lines.some((line) => line === 'prunable' || line.startsWith('prunable ')),
        creating: lines.some(
          (line) =>
            line.startsWith('locked dovo-creating ') ||
            line.startsWith('locked dovo-preparing ') ||
            line === 'locked initializing' ||
            line.startsWith('locked initializing '),
        ),
      }
    })
}

export function availableWorktree(
  record: ReturnType<typeof worktreeRecords>[number],
  root: string,
) {
  return (
    !!record.path &&
    !record.main &&
    resolve(record.path) !== resolve(root) &&
    !record.prunable &&
    !record.creating
  )
}

/** Missing folders can still own staged data in Git's registration. Never prune them on a retry. */
export function requireCompleteWorktree(record: ReturnType<typeof worktreeRecords>[number]) {
  if (record.preparing)
    throw new HttpError(
      409,
      `The worktree at ${record.path} has unfinished setup. Confirm its setup commands have stopped, then explicitly unlock its Git registration with git worktree unlock <path>; existing files and staged data were preserved.`,
    )
  if (record.prunable || record.creating)
    throw new HttpError(
      409,
      `The worktree at ${record.path} needs recovery. Restore or explicitly remove its Git registration before retrying; existing files and staged data were preserved.`,
    )
}
