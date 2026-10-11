import { changedFileFingerprint, type Task } from '@dovo/protocol'

/** Version metadata lives beside files, preserving existing workspace PATCH preconditions. */
export function versionReviewedFiles(task: Task, previous?: Task): Task {
  if (previous && task.files === previous.files)
    return task.fileReviewVersion === previous.fileReviewVersion &&
      task.fileReviewVersions === previous.fileReviewVersions
      ? task
      : {
          ...task,
          fileReviewVersion: previous.fileReviewVersion,
          fileReviewVersions: previous.fileReviewVersions,
        }
  const prior = new Map(previous?.files.map((file) => [file.path, file]))
  const previousVersions = previous?.fileReviewVersions
  let version = previous?.fileReviewVersion ?? 0
  for (const value of Object.values(previousVersions ?? {})) version = Math.max(version, value)
  if (
    !task.files.length &&
    version === 0 &&
    task.fileReviewVersion === undefined &&
    task.fileReviewVersions === undefined
  )
    return task
  const versions: [string, number][] = []
  const files = task.files.map((file) => {
    const old = prior.get(file.path)
    const changed = !!old && changedFileFingerprint(old) !== changedFileFingerprint(file)
    const viewed = changed ? false : file.viewed
    const viewedVersion =
      old && !changed && old.viewed === viewed ? (previousVersions?.[file.path] ?? 0) : ++version
    if (!Number.isSafeInteger(viewedVersion)) throw new Error('File review version limit exceeded')
    versions.push([file.path, viewedVersion])
    return file.viewed === viewed ? file : { ...file, viewed }
  })
  return {
    ...task,
    files,
    fileReviewVersion: version,
    fileReviewVersions: Object.fromEntries(versions),
  }
}
