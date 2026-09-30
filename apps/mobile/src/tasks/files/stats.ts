import { diffLines } from 'diff'
import type { ChangedFile } from '@dovo/protocol'
export function fileStats(file: ChangedFile) {
  return diffLines(file.before, file.after).reduce(
    (sum, change) => ({
      additions: sum.additions + (change.added ? change.count : 0),
      deletions: sum.deletions + (change.removed ? change.count : 0),
    }),
    { additions: 0, deletions: 0 },
  )
}
