import type { Repository } from './workspace.js'

/** Canonical remote identity only: never expose embedded credentials to paired clients. */
export function gitRemoteIdentity(remote: string): string | undefined {
  const value = remote.trim()
  const scp = !value.includes('://') && value.match(/^(?:[^/@:]+@)?([^/:]+):(.+)$/)
  let url: URL
  try {
    url = new URL(scp ? `ssh://${scp[1]}/${scp[2]}` : value)
  } catch {
    return undefined
  }
  if (!['https:', 'http:', 'ssh:', 'git:'].includes(url.protocol)) return undefined
  let host = url.hostname.toLowerCase()
  let path: string
  try {
    // Decode each component without treating an encoded slash as a path separator.
    path = url.pathname
      .split('/')
      .map((part) => encodeURIComponent(decodeURIComponent(part)).replace(/%20/g, ' '))
      .join('/')
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.git$/i, '')
  } catch {
    return undefined
  }
  const ssh = url.protocol === 'ssh:'
  if (ssh && host === 'ssh.github.com' && (!url.port || url.port === '443')) host = 'github.com'
  if (ssh && host === 'altssh.gitlab.com' && (!url.port || url.port === '443')) host = 'gitlab.com'
  if (ssh && host === 'altssh.bitbucket.org' && (!url.port || url.port === '443'))
    host = 'bitbucket.org'
  if (host.endsWith('.visualstudio.com')) {
    const org = host.slice(0, -'.visualstudio.com'.length)
    path = `${org}/${path.replace(/^DefaultCollection\//i, '')}`
    host = 'dev.azure.com'
  }
  if (!path || !host) return undefined
  if (host === 'ssh.dev.azure.com' && path.startsWith('v3/')) {
    const [org, project, ...repo] = path.slice(3).split('/')
    if (org && project && repo.length)
      return `dev.azure.com/${org}/${project}/_git/${repo.join('/')}`.toLowerCase()
  }
  if (['github.com', 'gitlab.com', 'bitbucket.org', 'dev.azure.com'].includes(host))
    path = path.toLowerCase()
  const standardSshPort =
    ssh && (url.port === '22' || (url.port === '443' && host !== url.hostname))
  const port = url.port && !standardSshPort ? `:${url.port}` : ''
  return `${host}${port}/${path}`
}
export function projectMachineGroups<
  T extends { repository: Repository; runtimeId: string | null },
>(entries: readonly T[]) {
  const groups = new Map<string, { key: string; name: string; entries: T[] }>()
  for (const entry of entries) {
    const key =
      entry.repository.gitIdentity ?? JSON.stringify([entry.runtimeId, entry.repository.id])
    const group = groups.get(key) ?? { key, name: entry.repository.name, entries: [] }
    group.entries.push(entry)
    groups.set(key, group)
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      // Choose a stable label regardless of which runtime is currently selected.
      name: [...new Set(group.entries.map((entry) => entry.repository.name))].sort(
        (a, b) => a.length - b.length || a.localeCompare(b),
      )[0],
      identity: group.entries[0].repository.gitIdentity,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key))
}
