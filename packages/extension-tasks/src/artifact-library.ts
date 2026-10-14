import {
  artifactLibrarySchema,
  type ArtifactLibraryEntry,
  type RuntimeProfile,
  type RuntimeReadCache,
} from '@dovo/protocol'

/** Library rows belong to one paired connection; re-pairing or re-addressing starts empty. */
export type ArtifactOwnerKey = string
export const artifactOwnerKey = (profile: RuntimeProfile): ArtifactOwnerKey =>
  JSON.stringify([profile.id, profile.connection.address, profile.connection.token])

export type SavedArtifacts = {
  readonly artifacts: readonly ArtifactLibraryEntry[]
  readonly savedAt: string
}
export type ArtifactSourceState =
  | { readonly status: 'loading'; readonly saved: SavedArtifacts | null }
  | { readonly status: 'ready'; readonly saved: SavedArtifacts }
  | { readonly status: 'offline'; readonly saved: SavedArtifacts | null }
  | { readonly status: 'failed'; readonly saved: SavedArtifacts | null; readonly error: string }

export type ArtifactLibraryMemory = {
  recall(owner: ArtifactOwnerKey): SavedArtifacts | undefined
  remember(owner: ArtifactOwnerKey, saved: SavedArtifacts): void
  /** Drop rows for connections that were removed or re-paired. */
  retain(owners: ReadonlySet<ArtifactOwnerKey>): void
}

/** Section navigation unmounts the view; keep the last rows of a few computers only. */
export function createArtifactLibraryMemory(limit: number): ArtifactLibraryMemory {
  const entries = new Map<ArtifactOwnerKey, SavedArtifacts>()
  return {
    recall: (owner) => entries.get(owner),
    remember(owner, saved) {
      entries.delete(owner)
      entries.set(owner, saved)
      for (const oldest of entries.keys()) {
        if (entries.size <= limit) break
        entries.delete(oldest)
      }
    },
    retain(owners) {
      for (const owner of entries.keys()) if (!owners.has(owner)) entries.delete(owner)
    },
  }
}
export const artifactLibraryMemory = createArtifactLibraryMemory(8)

const cacheKey = 'artifacts.library'
const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))

/** The read replica is disposable: its failures never hide live rows or block a read. */
async function readSaved(cache: () => RuntimeReadCache): Promise<SavedArtifacts | null> {
  try {
    const cached = await cache().read(cacheKey, artifactLibrarySchema)
    return cached && { artifacts: cached.value.artifacts, savedAt: cached.cachedAt }
  } catch {
    return null
  }
}
export async function saveArtifacts(
  cache: () => RuntimeReadCache,
  artifacts: readonly ArtifactLibraryEntry[],
) {
  try {
    await cache().write(cacheKey, { artifacts })
  } catch {
    // A full or closed replica only costs offline browsing.
  }
}

/**
 * Read one computer's library. A disconnect is a status, not a failure, and keeps saved rows.
 * An obsolete read (`current` false) still settles but never writes the memory or the replica.
 */
export async function loadArtifactSource({
  owner,
  connected,
  read,
  cache,
  current = () => true,
  memory = artifactLibraryMemory,
  now = () => new Date(),
}: {
  owner: ArtifactOwnerKey
  connected: boolean
  read: () => Promise<{ artifacts: ArtifactLibraryEntry[] }>
  cache: () => RuntimeReadCache
  current?: () => boolean
  memory?: ArtifactLibraryMemory
  now?: () => Date
}): Promise<ArtifactSourceState> {
  const saved = async () => {
    const recalled = memory.recall(owner) ?? (await readSaved(cache))
    if (recalled && current()) memory.remember(owner, recalled)
    return recalled ?? null
  }
  if (!connected) return { status: 'offline', saved: await saved() }
  try {
    const { artifacts } = await read()
    const result = { artifacts, savedAt: now().toISOString() }
    if (current()) {
      memory.remember(owner, result)
      void saveArtifacts(cache, artifacts)
    }
    return { status: 'ready', saved: result }
  } catch (cause) {
    return { status: 'failed', error: message(cause), saved: await saved() }
  }
}

/** Only the latest read for an owner may publish; slower earlier replies are discarded. */
export function createRequestGuard() {
  const latest = new Map<ArtifactOwnerKey, number>()
  let attempts = 0
  return {
    begin(owner: ArtifactOwnerKey) {
      const attempt = ++attempts
      latest.set(owner, attempt)
      return () => latest.get(owner) === attempt
    },
    /** Reads for removed or re-paired connections become obsolete. */
    retain(owners: ReadonlySet<ArtifactOwnerKey>) {
      for (const owner of latest.keys()) if (!owners.has(owner)) latest.delete(owner)
    },
    cancel() {
      latest.clear()
    },
  }
}
