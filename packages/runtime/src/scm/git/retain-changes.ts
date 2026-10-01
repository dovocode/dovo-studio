import type { ChangedFile } from '@dovo/protocol'

/** Preserve review state and avoid publishing an identical disk scan. */
export function retainChangedFiles(previous: ChangedFile[], incoming: ChangedFile[]) {
  const byPath = new Map(previous.map((file) => [file.path, file]))
  const files = incoming.map((file) => {
    const prior = byPath.get(file.path)
    return prior &&
      prior.before === file.before &&
      prior.after === file.after &&
      prior.diskContents === file.diskContents
      ? prior
      : file
  })
  return files.length === previous.length && files.every((file, index) => file === previous[index])
    ? previous
    : files
}
