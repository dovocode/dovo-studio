/** Only verified reader identities can authorize a transparent handoff. */
export class VerifiedReaders {
  private readonly identities = new Map<
    string,
    { readerIdentity: string; destination: string; available: boolean }
  >()
  private readonly selections = new Map<
    string,
    { owners: Map<string, string>; readerIdentities: Map<string, string> }
  >()
  constructor(private readonly limit = 200) {}

  identity(key: string) {
    return this.identities.get(key)
  }

  unavailable(key: string) {
    const identity = this.identities.get(key)
    if (identity) identity.available = false
  }

  candidateIdentity(key: string) {
    const identity = this.identities.get(key)
    return identity?.available ? identity.readerIdentity : undefined
  }

  remember(key: string, value: { readerIdentity: string; destination: string }) {
    const previous = this.identities.get(key)
    if (previous && previous.readerIdentity !== value.readerIdentity) {
      previous.available = false
      throw new Error(
        'This source is now signed in with a different account. Choose its source again.',
      )
    }
    this.identities.delete(key)
    this.identities.set(key, { ...value, available: true })
    this.trim(this.identities)
    return value
  }

  /** Explicit user choice starts a new account scope; retained drafts keep their old destination. */
  acceptAccount(key: string) {
    this.identities.delete(key)
  }

  resetSelection(key: string) {
    this.selections.delete(key)
  }

  selection(key: string) {
    const value = this.selections.get(key) ?? {
      owners: new Map<string, string>(),
      readerIdentities: new Map<string, string>(),
    }
    this.trim(value.owners)
    this.trim(value.readerIdentities)
    this.selections.delete(key)
    this.selections.set(key, value)
    this.trim(this.selections)
    return value
  }

  private trim<A>(entries: Map<string, A>) {
    while (entries.size > this.limit) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }
}

export const mobileReaders = new VerifiedReaders()
