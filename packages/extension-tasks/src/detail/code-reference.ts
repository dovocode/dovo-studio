export type CodeReference = { taskId: string; id: string; text: string }

/** Include the selected text: a historical diff may no longer match the checkout on disk. */
export function formatCodeReference(
  path: string,
  start: number,
  end: number,
  contents: string,
  version?: 'old' | 'new',
) {
  const lines = contents
    .split('\n')
    .slice(start - 1, end)
    .join('\n')
  const fence = '`'.repeat(
    Math.max(3, ...[...lines.matchAll(/`+/g)].map(([run]) => run.length + 1)),
  )
  const location = `${path}:L${start}${end === start ? '' : `-L${end}`}${version ? ` (${version})` : ''}`
  return `${location}\n${fence}\n${lines}\n${fence}`
}
