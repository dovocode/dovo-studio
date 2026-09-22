// GitHub review diff_hunk may stop at the commented line while retaining the full
// hunk's counts. Keep original line starts and describe only the supplied excerpt.
export function reviewPatch(patch: string): string {
  const lines = patch.replaceAll('\r\n', '\n').split('\n')
  if (lines.at(-1) === '') lines.pop()
  for (let index = 0; index < lines.length; index++) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(lines[index])
    if (!header) throw new Error('Invalid review hunk header')
    let oldCount = 0,
      newCount = 0,
      end = index + 1
    for (; end < lines.length && !lines[end].startsWith('@@ '); end++) {
      const line = lines[end]
      if (line === '\\ No newline at end of file') continue
      if (line.startsWith(' ')) {
        oldCount++
        newCount++
      } else if (line.startsWith('-')) oldCount++
      else if (line.startsWith('+')) newCount++
      else throw new Error('Invalid review hunk line')
    }
    if (oldCount > Number(header[2] ?? 1) || newCount > Number(header[4] ?? 1))
      throw new Error('Review hunk exceeds its declared range')
    lines[index] = `@@ -${header[1]},${oldCount} +${header[3]},${newCount} @@${header[5]}`
    index = end - 1
  }
  return lines.join('\n')
}
