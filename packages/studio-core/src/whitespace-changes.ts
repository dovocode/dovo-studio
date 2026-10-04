/** Preserve additions, deletions, renames and unavailable/binary previews. */
export function whitespaceOnlyFile(file: {
  before?: string | null
  after?: string | null
  status?: string
  previousPath?: string
  preview?: unknown
}) {
  return (
    (file.status === 'modified' || (file.status === undefined && !!file.before && !!file.after)) &&
    !file.previousPath &&
    !file.preview &&
    typeof file.before === 'string' &&
    typeof file.after === 'string' &&
    file.before !== file.after &&
    file.before.replace(/\s/g, '') === file.after.replace(/\s/g, '')
  )
}
/** Compare each patch hunk independently; never treat truncated/unavailable patches as equal. */
export function whitespaceOnlyPatch(file: {
  status: string
  previousPath?: string
  patch?: string
}) {
  if (file.status !== 'modified' || file.previousPath || !file.patch) return false
  let changed = false
  const hunks = file.patch.split(/(?=^@@)/m).filter((hunk) => hunk.startsWith('@@'))
  if (!hunks.length) return false
  return (
    hunks.every((hunk) => {
      const before: string[] = [],
        after: string[] = []
      for (const line of hunk.split('\n').slice(1)) {
        if (line.startsWith('-')) {
          before.push(line.slice(1))
          changed = true
        } else if (line.startsWith('+')) {
          after.push(line.slice(1))
          changed = true
        } else if (line.startsWith(' ')) {
          before.push(line.slice(1))
          after.push(line.slice(1))
        }
      }
      return before.join('\n').replace(/\s/g, '') === after.join('\n').replace(/\s/g, '')
    }) && changed
  )
}
