/** Use the title model's result without a second naming request on the send path. */
export function taskBranchName(title: string, uniqueKey: string) {
  const slug =
    title
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '') || 'task'
  return `dovo/${slug}-${uniqueKey}`
}

const pathPart = (value: string) =>
  value
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80) || 'repo'

/** Readable worktree location: `<org or user>/<repo>-<branch>`, e.g.
 * `dovocode/dovo-studio-fix-login-redirect-<key>`. The branch keeps its unique suffix, so the
 * folder stays unique and findable after the task's title changes. */
export function taskWorktreePath(
  identity: string | undefined,
  repositoryPath: string,
  branch: string,
) {
  // Identity is `host/owner/…/repo` (see gitRemoteIdentity); local-only repos have none.
  const parts = identity?.split('/').filter(Boolean) ?? []
  const owner = parts.length >= 3 ? parts[1] : 'local'
  const repository = parts.length >= 3 ? parts.at(-1)! : (repositoryPath.split('/').at(-1) ?? '')
  const name = branch.replace(/^dovo\//, '').replaceAll('/', '-')
  return `${pathPart(owner)}/${pathPart(repository)}-${pathPart(name)}`
}
