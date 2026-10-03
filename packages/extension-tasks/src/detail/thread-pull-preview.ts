import { gitRemoteIdentity, pullReference, type Repository, type Task } from '@dovo/protocol'

export function threadPullPreview(url: string, task: Task, repositories: readonly Repository[]) {
  let reference: ReturnType<typeof pullReference>
  try {
    reference = pullReference(url)
  } catch {
    return null
  }
  if (!reference.url) return null
  const repositoryUrl = reference.url.replace(
    /\/(?:-\/)?(?:pull|pulls|pull-requests|pullrequest|merge_requests)\/\d+$/i,
    '',
  )
  const identity = gitRemoteIdentity(repositoryUrl)
  const repository =
    repositories.find(
      (repo) =>
        !repo.kind && repo.id === task.repositoryId && !!identity && repo.gitIdentity === identity,
    ) ?? repositories.find((repo) => !repo.kind && !!identity && repo.gitIdentity === identity)
  return repository ? { repositoryId: repository.id, number: reference.number } : null
}
