import { parseDiffFromFile } from '@pierre/diffs'
import { FileTypeIcon } from '@dovo/studio-ui'
import type { ChangedFile } from '@dovo/studio-core'
const statsCache = new WeakMap<
  ChangedFile,
  {
    before: string
    after: string
    path: string
    stats: { path: string; additions: number; deletions: number }
  }
>()
export function fileStats(file: ChangedFile) {
  const cached = statsCache.get(file)
  if (
    !file.preview &&
    cached?.path === file.path &&
    cached.before === file.before &&
    cached.after === file.after
  )
    return cached.stats
  if (file.preview) return { path: file.path, additions: 0, deletions: 0 }
  const diff = parseDiffFromFile(
    { name: file.path, contents: file.before },
    { name: file.path, contents: file.after },
  )
  const stats = {
    path: file.path,
    additions: diff.hunks.reduce((n, h) => n + h.additionLines, 0),
    deletions: diff.hunks.reduce((n, h) => n + h.deletionLines, 0),
  }
  statsCache.set(file, { path: file.path, before: file.before, after: file.after, stats })
  return stats
}
export function FileIcon({ path }: { path: string }) {
  return <FileTypeIcon path={path} />
}
export function DiffAmounts({
  stats,
}: {
  stats: { additions: number; deletions: number } | undefined
}) {
  if (!stats) return null
  return (
    <span className="flex shrink-0 gap-1.5 text-[0.625rem] tabular-nums">
      <span className="text-emerald-500">+{stats.additions}</span>
      <span className="text-rose-500">-{stats.deletions}</span>
    </span>
  )
}
