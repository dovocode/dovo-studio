import { parsePatch } from 'diff'
import type { PullDetail } from '@dovo/protocol'

export function parseForgeDiff(diff: string): PullDetail['files'] {
  return parsePatch(diff)
    .map((file) => {
      const oldPath = file.oldFileName?.replace(/^a\//, ''),
        newPath = file.newFileName?.replace(/^b\//, '')
      const path = newPath && newPath !== '/dev/null' ? newPath : (oldPath ?? '')
      const lines = file.hunks.flatMap((hunk) => hunk.lines)
      const patch = file.hunks
        .map(
          (hunk) =>
            `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join('\n')}`,
        )
        .join('\n')
      return {
        path,
        ...(oldPath && oldPath !== '/dev/null' && oldPath !== path
          ? { previousPath: oldPath }
          : {}),
        status:
          oldPath === '/dev/null'
            ? 'added'
            : newPath === '/dev/null'
              ? 'removed'
              : oldPath !== path
                ? 'renamed'
                : 'modified',
        additions: lines.filter((line) => line.startsWith('+')).length,
        deletions: lines.filter((line) => line.startsWith('-')).length,
        ...(patch ? { patch } : {}),
      }
    })
    .filter((file) => !!file.path)
}

export function completeForgeDiff(diff: string): PullDetail['files'] {
  if (!diff.endsWith('\n') || !diff.startsWith('diff --git '))
    throw new Error('The raw diff is incomplete or has an unsupported format')
  const parsed = parsePatch(diff)
  for (const file of parsed) {
    for (const hunk of file.hunks) {
      let oldLines = 0
      let newLines = 0
      for (const line of hunk.lines) {
        if (line.startsWith(' ') || line.startsWith('-')) oldLines++
        if (line.startsWith(' ') || line.startsWith('+')) newLines++
        if (![' ', '+', '-', '\\'].some((prefix) => line.startsWith(prefix)))
          throw new Error('The raw diff contains an invalid hunk')
      }
      if (oldLines !== hunk.oldLines || newLines !== hunk.newLines)
        throw new Error('The raw diff contains an incomplete hunk')
    }
  }
  return parseForgeDiff(diff)
}
