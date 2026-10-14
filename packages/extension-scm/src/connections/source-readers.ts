import { Effect } from 'effect'
import { useEffect, useMemo, useSyncExternalStore } from 'react'
import {
  assignRemoteSources,
  forgeSourceIdentitySchema,
  pullRepositoryKey,
  RuntimeRequestError,
  type ForgeSourceIdentity,
  type JiraSource,
} from '@dovo/protocol'
import { startPolling, useWorkspace, type RepositorySource } from '@dovo/studio-core'

type Source = Omit<RepositorySource, 'repository'> & {
  repository?: RepositorySource['repository']
  jira?: JiraSource
  readerIdentity?: string
}
const identities = new Map<string, ForgeSourceIdentity>()
// Keep the last verified account/destination for continuity, but do not use a
// failed discovery as evidence that this transport is available for reading.
const failedDiscovery = new Set<string>()
const assignments = new Map<
  string,
  {
    owners: Map<string, string>
    identities: Map<string, string>
    destinations: Map<string, string>
  }
>()
const listeners = new Set<() => void>()
let revision = 0
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const publish = () => {
  revision++
  for (const listener of listeners) listener()
}
const rememberIdentity = (scope: string, identity: ForgeSourceIdentity) => {
  const recovered = failedDiscovery.delete(scope)
  const previous = identities.get(scope)
  const changed =
    previous?.readerIdentity !== identity.readerIdentity ||
    previous?.destination !== identity.destination ||
    recovered
  identities.delete(scope)
  identities.set(scope, identity)
  while (identities.size > 256) {
    const oldest = identities.keys().next().value
    if (oldest !== undefined) identities.delete(oldest)
  }
  if (changed) publish()
}
export const sourceIdentityInput = (source: Pick<Source, 'repository' | 'jira'>) =>
  source.jira ? { jiraSourceId: source.jira.id } : { repositoryId: source.repository?.id }

/** Discovery never promotes an unknown account to a verified reader. Older runtimes
 * may still serve their own data, but cannot qualify for transparent handoff. */
export function discoverSourceIdentity(source: Source) {
  return source
    .requestEffect(
      '/api/scm/source/identity',
      sourceIdentityInput(source),
      forgeSourceIdentitySchema,
    )
    .pipe(
      Effect.tap((identity) => Effect.sync(() => rememberIdentity(source.scope, identity))),
      Effect.catch((error) =>
        Effect.gen(function* () {
          if (error instanceof RuntimeRequestError && [404, 405].includes(error.status ?? 0)) {
            const removed = identities.delete(source.scope)
            const recovered = failedDiscovery.delete(source.scope)
            if (removed || recovered) publish()
            return undefined
          }
          const changed = !failedDiscovery.has(source.scope)
          failedDiscovery.add(source.scope)
          while (failedDiscovery.size > 256) {
            const oldest = failedDiscovery.values().next().value
            if (oldest !== undefined) failedDiscovery.delete(oldest)
          }
          if (changed) publish()
          return yield* Effect.fail(error)
        }),
      ),
    )
}

/** The user's explicit source choice accepts the newly verified account for this
 * collection, without rewriting any open detail's owner or destination. */
export function chooseSourceReader(source: Source, namespace: string, remote: string) {
  return discoverSourceIdentity(source).pipe(
    Effect.tap((identity) =>
      Effect.sync(() => {
        const previous = assignments.get(namespace)
        const owners = new Map(previous?.owners)
        const readerIdentities = new Map(previous?.identities)
        const destinations = new Map(previous?.destinations)
        owners.set(remote, source.key)
        if (identity) {
          readerIdentities.set(remote, identity.readerIdentity)
          destinations.set(remote, identity.destination)
        } else {
          readerIdentities.delete(remote)
          destinations.delete(remote)
        }
        assignments.set(namespace, { owners, identities: readerIdentities, destinations })
        publish()
      }),
    ),
    Effect.asVoid,
  )
}
export function verifySourceReader(source: Source) {
  return discoverSourceIdentity(source).pipe(
    Effect.flatMap((identity) => {
      if (source.readerIdentity && identity?.readerIdentity !== source.readerIdentity)
        return Effect.fail(
          new RuntimeRequestError({
            kind: 'request',
            status: 409,
            message:
              'This source account changed. Saved data remains available; choose the source explicitly to use another account.',
          }),
        )
      return Effect.succeed(identity?.readerIdentity)
    }),
  )
}

/** Retain small owner/account records across remounts. Request closures and repository
 * entities remain in the live workspace, never in this assignment cache. */
export function useSourceReaders<T extends Source>(
  allSources: readonly T[],
  namespace: string,
  remote: (source: T) => string = (source) =>
    source.repository ? pullRepositoryKey(source.repository, source.key) : source.key,
  enabled = true,
  origin?: T,
) {
  const { activeRuntimeId } = useWorkspace()
  const identityRevision = useSyncExternalStore(subscribe, () => revision)
  const sourcesKey = JSON.stringify(allSources.map((source) => [source.scope, source.connected]))
  useEffect(() => {
    if (!enabled) return
    const load = Effect.forEach(
      allSources.filter((source) => source.connected),
      (source) => discoverSourceIdentity(source).pipe(Effect.catch(() => Effect.void)),
      { concurrency: 3, discard: true },
    )
    const polling = startPolling(load, { interval: 30000, onError: () => {} })
    return () => {
      void polling.stop()
    }
  }, [sourcesKey, enabled])
  return useMemo(() => {
    if (!enabled) return { sources: [...allSources], unavailable: new Set<string>() }
    const originIdentity = origin ? identities.get(origin.scope) : undefined
    const previous = assignments.get(namespace) ?? {
      owners: new Map<string, string>(origin ? [[remote(origin), origin.key]] : []),
      identities: new Map<string, string>(
        origin && originIdentity ? [[remote(origin), originIdentity.readerIdentity]] : [],
      ),
      destinations: new Map<string, string>(
        origin && originIdentity ? [[remote(origin), originIdentity.destination]] : [],
      ),
    }
    const enriched = allSources.map((source) => ({
      ...source,
      connected: source.connected && !failedDiscovery.has(source.scope),
      readerIdentity: identities.get(source.scope)?.readerIdentity,
    }))
    const assigned = assignRemoteSources(enriched, {
      previous: previous.owners,
      previousReaderIdentities: previous.identities,
      requireSameReader: true,
      preferredRuntimeId: activeRuntimeId,
      remote,
    })
    const nextIdentities = new Map(previous.identities)
    const nextDestinations = new Map(previous.destinations)
    for (const source of assigned.selected)
      if (source.readerIdentity && !nextIdentities.has(remote(source)))
        nextIdentities.set(remote(source), source.readerIdentity)
    if (
      origin &&
      originIdentity &&
      originIdentity.readerIdentity === nextIdentities.get(remote(origin))
    )
      nextDestinations.set(remote(origin), originIdentity.destination)
    // Only identities for retained remote records survive a bounded cache eviction.
    const owners = new Map([...assigned.owners].slice(-256))
    const readerIdentities = new Map([...nextIdentities].filter(([key]) => owners.has(key)))
    assignments.delete(namespace)
    const destinations = new Map([...nextDestinations].filter(([key]) => owners.has(key)))
    assignments.set(namespace, { owners, identities: readerIdentities, destinations })
    while (assignments.size > 32) {
      const oldest = assignments.keys().next().value
      if (oldest !== undefined) assignments.delete(oldest)
    }
    const selectedRemotes = new Set(assigned.selected.map(remote))
    return {
      sources: assigned.selected,
      unavailable: new Set([...owners.keys()].filter((key) => !selectedRemotes.has(key))),
    }
  }, [allSources, namespace, identityRevision, enabled])
}

/** Reading may use a same-account alternate; cached data and all mutations keep
 * the originating source and its retained account/destination. */
export function useDetailReader<T extends Source>(
  origin: T | undefined,
  allSources: readonly T[],
  entity: string,
  remote: (source: T) => string = (source) =>
    source.repository ? pullRepositoryKey(source.repository, source.key) : source.key,
) {
  const group = useMemo(
    () => (origin ? allSources.filter((source) => remote(source) === remote(origin)) : []),
    [origin, allSources],
  )
  const namespace = `detail:${origin?.scope ?? entity}:${entity}`
  const selected = useSourceReaders(group, namespace, remote, !!origin, origin)
  return useMemo(() => {
    if (!origin) return { reader: undefined, destination: undefined }
    const reader = selected.sources[0]
    return {
      reader,
      destination: assignments.get(namespace)?.destinations.get(remote(origin)),
    }
  }, [origin, selected.sources, namespace])
}
