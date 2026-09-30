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

/** Root files remain direct rows; other files share their actual directory. */
export function checkpointFolders(paths: string[]) {
  const folders = new Map<string, string[]>()
  for (const path of [...new Set(paths)].sort()) {
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    folders.set(folder, [...(folders.get(folder) ?? []), path])
  }
  return folders
}
