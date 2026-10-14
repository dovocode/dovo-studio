import { parsePatch, type StructuredPatch } from 'diff'
export type DiffRow = {
  text: string
  kind: 'addition' | 'deletion' | 'context' | 'header'
  before?: number
  after?: number
}
export function diffRows(patch: string): DiffRow[] {
  try {
    const rows = parsePatch(patch).flatMap(fileDiffRows)
    if (rows.length) return rows
  } catch {
    // Keep malformed/provider-limited patches readable as raw text.
  }
  return patch.split('\n').map((text) => ({ text, kind: 'header' }))
}

export function fileDiffRows(file: StructuredPatch): DiffRow[] {
  const rows: DiffRow[] = []
  for (const hunk of file.hunks) {
    rows.push({
      text: `@@ −${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
      kind: 'header',
    })
    let before = hunk.oldStart,
      after = hunk.newStart
    for (const line of hunk.lines) {
      const marker = line[0]
      if (marker === '+') rows.push({ text: line.slice(1), kind: 'addition', after: after++ })
      else if (marker === '-')
        rows.push({ text: line.slice(1), kind: 'deletion', before: before++ })
      else if (marker === ' ')
        rows.push({ text: line.slice(1), kind: 'context', before: before++, after: after++ })
      else rows.push({ text: line, kind: 'header' })
    }
  }
  return rows
}

export type ReviewDiffProps = {
  patch: string
  path?: string
  previousPath?: string
  focusedLine?: number
  onLinePress?: (line: number, side: 'additions' | 'deletions') => void
  annotations?: { line: number; side: 'additions' | 'deletions'; text: string }[]
}
