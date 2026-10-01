/** Read porcelain v2 headers without treating filenames as branch metadata. */
export function gitActionState(status: string, remotes: string) {
  const lines = status.split('\n')
  const branch = lines.find((line) => line.startsWith('# branch.head '))?.slice(14) ?? ''
  const upstream = lines.find((line) => line.startsWith('# branch.upstream '))?.slice(18)
  const tracking = !!upstream
  const counts = lines.find((line) => line.startsWith('# branch.ab '))?.match(/\+(\d+) -(\d+)/)
  const names = remotes.trim().split('\n').filter(Boolean)
  return {
    dirty: lines.some((line) => /^[12u?] /.test(line)),
    branch: branch === '(detached)' ? '' : branch,
    ahead: Number(counts?.[1] ?? 0),
    behind: Number(counts?.[2] ?? 0),
    tracking,
    canPush:
      branch !== '(detached)' &&
      !!branch &&
      (names.some((name) => upstream?.startsWith(`${name}/`)) ||
        names.includes('origin') ||
        names.length === 1),
  }
}
