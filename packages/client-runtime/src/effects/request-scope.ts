const identities = new WeakMap<object, number>()
let nextIdentity = 0

/** Reset client state when its connection object changes, without exposing credentials in keys. */
export function clientScopeKey(identity: object | null | undefined): number {
  if (!identity) return 0
  const existing = identities.get(identity)
  if (existing !== undefined) return existing
  const key = ++nextIdentity
  identities.set(identity, key)
  return key
}

/** A completion may update state only while it still belongs to the current view request. */
export class RequestScope {
  private revision = 0
  begin() {
    const revision = ++this.revision
    return () => revision === this.revision
  }
  cancel() {
    this.revision++
  }
}

export function appendUniqueRows<T extends { id: string }>(current: T[], incoming: T[]): T[] {
  const rows = new Map(current.map((row) => [row.id, row]))
  for (const row of incoming) rows.set(row.id, row)
  return [...rows.values()]
}
