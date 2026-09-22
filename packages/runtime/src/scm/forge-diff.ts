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
