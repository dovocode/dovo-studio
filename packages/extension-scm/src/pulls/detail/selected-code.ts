import type { FileDiffMetadata } from '@pierre/diffs'
export function selectedPatchCode(
  diff: FileDiffMetadata | undefined,
  start: number,
  end: number,
): string | undefined {
  if (!diff) return undefined
  const lines: string[] = []
  for (let line = start; line <= end; line++) {
    const hunk = diff.hunks.find(
      (h) => line >= h.additionStart && line < h.additionStart + h.additionCount,
    )
    if (!hunk) return undefined // Never invent omitted context in a partial PR patch.
    const text = diff.additionLines[hunk.additionLineIndex + line - hunk.additionStart]
    if (text === undefined) return undefined
    lines.push(text.replace(/\r?\n$/, ''))
  }
  return lines.join('\n')
}
