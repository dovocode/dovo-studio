/** A logical revision advances beyond every observed edit, even if the wall clock goes back. */
export interface VersionStamp {
  key: string
  updatedAt: number
  changeId: string
}

export function compareVersions(a: VersionStamp, b: VersionStamp) {
  return (
    a.updatedAt - b.updatedAt || (a.changeId < b.changeId ? -1 : a.changeId > b.changeId ? 1 : 0)
  )
}

export function mergeLatest<T extends VersionStamp>(...sources: readonly (readonly T[])[]): T[] {
  const values = new Map<string, T>()
  for (const source of sources)
    for (const entry of source) {
      const current = values.get(entry.key)
      if (!current || compareVersions(entry, current) > 0) values.set(entry.key, entry)
    }
  return [...values.values()].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

export function pendingLatest<T extends VersionStamp>(values: readonly T[], known: readonly T[]) {
  const current = new Map(mergeLatest(known).map((entry) => [entry.key, entry]))
  return mergeLatest(values).filter((entry) => {
    const previous = current.get(entry.key)
    return !previous || compareVersions(entry, previous) > 0
  })
}

export function nextRevision(observed: Iterable<VersionStamp>, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error('Invalid state clock')
  let revision = now
  for (const entry of observed) revision = Math.max(revision, entry.updatedAt + 1)
  if (!Number.isSafeInteger(revision)) throw new Error('State revision exhausted')
  return revision
}
