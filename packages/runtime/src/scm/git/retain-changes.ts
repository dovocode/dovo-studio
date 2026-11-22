import { filePreviewIdentity, type ChangedFile } from '@dovo/protocol'

/** Preserve review state and avoid publishing an identical disk scan. */
export function retainChangedFiles(
  previous: ChangedFile[],
  incoming: ChangedFile[],
  metadataOnly = false,
) {
  const byPath = new Map(previous.map((file) => [file.path, file]))
  const files = incoming.map((file) => {
    const prior = byPath.get(file.path)
    const sameRevision = !!prior?.workingRevision && prior.workingRevision === file.workingRevision
    if (metadataOnly && prior)
      return !sameRevision
        ? file
        : prior.gitStatus?.index === file.gitStatus?.index &&
            prior.gitStatus?.workingTree === file.gitStatus?.workingTree
          ? prior
          : { ...prior, gitStatus: file.gitStatus }
    if (sameRevision && prior?.preview?.kind === 'deferred' && !file.preview)
      return { ...file, viewed: prior.viewed }
    const sameContent =
      prior &&
      prior.before === file.before &&
      prior.after === file.after &&
      (!file.preview || !prior.workingRevision || !file.workingRevision || sameRevision) &&
      filePreviewIdentity(prior.preview) === filePreviewIdentity(file.preview)
    if (!sameContent) return file
    // Staging can change without changing the reviewed HEAD-to-working contents.
    return prior.workingRevision === file.workingRevision &&
      prior.diskContents === file.diskContents &&
      prior.gitStatus?.index === file.gitStatus?.index &&
      prior.gitStatus?.workingTree === file.gitStatus?.workingTree
      ? prior
      : { ...file, viewed: prior.viewed }
  })
  return files.length === previous.length && files.every((file, index) => file === previous[index])
    ? previous
    : files
}
