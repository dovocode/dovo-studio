/** Refresh page one while retaining explicitly loaded later pages and removing stale first-page rows. */
export function refreshFirstPage<T>(
  previous: T[],
  firstPageIds: string[],
  incoming: T[],
  id: (item: T) => string,
): T[] {
  const replaced = new Set([...firstPageIds, ...incoming.map(id)])
  return [
    ...new Map(
      [...incoming, ...previous.filter((item) => !replaced.has(id(item)))].map((item) => [
        id(item),
        item,
      ]),
    ).values(),
  ]
}
