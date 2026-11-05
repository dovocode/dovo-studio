import type { ChangedFile } from '@dovo/protocol'

type GitStatus = NonNullable<ChangedFile['gitStatus']>

function change(code: string): GitStatus['index'] {
  switch (code) {
    case ' ':
      return 'unchanged'
    case 'A':
      return 'added'
    case 'M':
      return 'modified'
    case 'D':
      return 'deleted'
    case 'T':
      return 'type-changed'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'U':
      return 'unmerged'
    default:
      return 'unknown'
  }
}

/** Porcelain v1 XY is index versus HEAD, then working tree versus index. */
export function workingGitStatus(xy: string): GitStatus {
  if (xy === '??') return { index: 'unchanged', workingTree: 'untracked' }
  // AA/DD and the other unmerged pairs are not ordinary committable index entries.
  if (['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(xy))
    return { index: 'unmerged', workingTree: 'unmerged' }
  return { index: change(xy.charAt(0)), workingTree: change(xy.charAt(1)) }
}
