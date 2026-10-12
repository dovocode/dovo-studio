import { diffLines } from 'diff'
import type { ChangedFile } from '@dovo/protocol'
const statsCache = new WeakMap<
  ChangedFile,
  { before: string; after: string; stats: { additions: number; deletions: number } }
>()
export function fileStats(file: ChangedFile) {
  const cached = statsCache.get(file)
  if (!file.preview && cached?.before === file.before && cached.after === file.after)
    return cached.stats
  if (file.preview) return { additions: 0, deletions: 0 }
  const stats = diffLines(file.before, file.after).reduce(
    (sum, change) => ({
      additions: sum.additions + (change.added ? change.count : 0),
      deletions: sum.deletions + (change.removed ? change.count : 0),
    }),
    { additions: 0, deletions: 0 },
  )
  statsCache.set(file, { before: file.before, after: file.after, stats })
  return stats
}
