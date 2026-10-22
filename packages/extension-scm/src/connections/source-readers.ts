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
    origins: Map<string, string>
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
  const previous = identities.get(scope)
  if (previous && previous.destination !== identity.destination)
    throw new RuntimeRequestError({
      kind: 'request',
      status: 409,
      message:
        'This source destination changed. Refresh its project or choose its source explicitly.',
    })
  const recovered = failedDiscovery.delete(scope)
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
const identityCacheKey = (source: Source) =>
  JSON.stringify([
    'forge',
    'source-identity',
    sourceIdentityInput(source),
    source.repository?.path,
    source.repository?.gitIdentity,
    source.repository?.pullIdentity,
    source.repository?.forge,
    source.jira,
  ])

/** Discovery never promotes an unknown account to a verified reader. Older runtimes
 * may still serve their own data, but cannot qualify for transparent handoff. */
function discoverSourceIdentity(source: Source) {
  return source
    .requestEffect(
      '/api/scm/source/identity',
      sourceIdentityInput(source),
      forgeSourceIdentitySchema,
    )
    .pipe(
      Effect.tap((identity) =>
        Effect.try({
          try: () => rememberIdentity(source.scope, identity),
          catch: (cause) =>
            cause instanceof RuntimeRequestError
              ? cause
              : new RuntimeRequestError({
                  kind: 'request',
                  message: 'Could not verify integration identity',
                  cause,
                }),
        }),
      ),
      Effect.tap((identity) =>
        source.readCache.writeEffect(identityCacheKey(source), identity).pipe(
          // Live verification remains valid if this device cannot retain it for the next launch.
          Effect.catch(() => Effect.logWarning('Could not save the verified integration identity')),
        ),
      ),
      Effect.catch((error) =>
        Effect.gen(function* () {
          if (error instanceof RuntimeRequestError && [404, 405].includes(error.status ?? 0)) {
            const removed = identities.delete(source.scope)
            const recovered = failedDiscovery.delete(source.scope)
            if (removed || recovered) publish()
            yield* source.readCache
              .removeEffect(identityCacheKey(source))
              .pipe(
                Effect.catch(() =>
                  Effect.logWarning('Could not clear the saved integration identity'),
                ),
              )
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
  // An explicit choice can accept a changed source; automatic discovery cannot.
  return Effect.suspend(() => {
    identities.delete(source.scope)
    return discoverSourceIdentity(source)
  }).pipe(
    Effect.tap((identity) =>
      Effect.sync(() => {
        const previous = assignments.get(namespace)
        const owners = new Map(previous?.owners)
        const origins = new Map(previous?.origins)
        const readerIdentities = new Map(previous?.identities)
        const destinations = new Map(previous?.destinations)
        owners.set(remote, source.key)
        origins.set(remote, source.key)
        if (identity) {
          readerIdentities.set(remote, identity.readerIdentity)
          destinations.set(remote, identity.destination)
        } else {
          readerIdentities.delete(remote)
          destinations.delete(remote)
        }
        assignments.set(namespace, { owners, origins, identities: readerIdentities, destinations })
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
      return Effect.succeed({
        expectedReaderIdentity: identity?.readerIdentity,
        expectedDestination: identity?.destination,
      })
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
  allowHandoff = true,
) {
  const { activeRuntimeId } = useWorkspace()
  const identityRevision = useSyncExternalStore(subscribe, () => revision)
  const sourcesKey = JSON.stringify(allSources.map((source) => [source.scope, source.connected]))
  useEffect(() => {
    if (!enabled) return
    let stopped = false
    const load = Effect.gen(function* () {
      yield* Effect.forEach(
        allSources.filter((source) => !source.connected && !identities.has(source.scope)),
        (source) =>
          source.readCache.readEffect(identityCacheKey(source), forgeSourceIdentitySchema).pipe(
            Effect.tap((saved) =>
              Effect.sync(() => {
                // Saved identity constrains the account allowed to take over; it does not
                // authorize a live request without discovering that reader again.
                if (saved && !stopped && !identities.has(source.scope))
                  rememberIdentity(source.scope, saved.value)
              }),
            ),
            Effect.catch(() => Effect.logWarning('Could not read the saved integration identity')),
          ),
        { concurrency: 3, discard: true },
      )
      yield* Effect.forEach(
        allSources.filter((source) => source.connected),
        (source) => discoverSourceIdentity(source).pipe(Effect.catch(() => Effect.void)),
        { concurrency: 3, discard: true },
      )
    })
    const polling = startPolling(load, { interval: 30000, onError: () => {} })
    return () => {
      stopped = true
      void polling.stop()
    }
  }, [sourcesKey, enabled])
  return useMemo(() => {
    if (!enabled)
      return {
        sources: [...allSources],
        origins: new Map(allSources.map((source) => [remote(source), source])),
        destinations: new Map<string, string>(),
        unavailable: new Set<string>(),
      }
    const originIdentity = origin ? identities.get(origin.scope) : undefined
    const previous = assignments.get(namespace) ?? {
      owners: new Map<string, string>(origin ? [[remote(origin), origin.key]] : []),
      origins: new Map<string, string>(origin ? [[remote(origin), origin.key]] : []),
      identities: new Map<string, string>(
        origin && originIdentity ? [[remote(origin), originIdentity.readerIdentity]] : [],
      ),
      destinations: new Map<string, string>(
        origin && originIdentity ? [[remote(origin), originIdentity.destination]] : [],
      ),
    }
    for (const [key, originKey] of previous.origins) {
      const current = allSources.find((source) => source.key === originKey)
      if (current && remote(current) !== key) {
        previous.origins.delete(key)
        previous.destinations.delete(key)
      }
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
      allowHandoff,
      sharedPreference: enriched.every((source) => !!source.serverId),
      preferredRuntimeId: activeRuntimeId,
      remote,
    })
    const nextIdentities = new Map(previous.identities)
    const nextDestinations = new Map(previous.destinations)
    for (const source of assigned.selected) {
      if (!previous.origins.has(remote(source))) previous.origins.set(remote(source), source.key)
      const owner = allSources.find(
        (candidate) =>
          candidate.key === previous.origins.get(remote(source)) &&
          remote(candidate) === remote(source),
      )
      const identity = owner && identities.get(owner.scope)
      if (identity && !nextDestinations.has(remote(source)))
        nextDestinations.set(remote(source), identity.destination)
      if (source.readerIdentity && !nextIdentities.has(remote(source)))
        nextIdentities.set(remote(source), source.readerIdentity)
    }
    if (
      origin &&
      originIdentity &&
      originIdentity.readerIdentity === nextIdentities.get(remote(origin))
    )
      nextDestinations.set(remote(origin), originIdentity.destination)
    // Only identities for retained remote records survive a bounded cache eviction.
    const owners = new Map([...assigned.owners].slice(-256))
    const readerIdentities = new Map([...nextIdentities].filter(([key]) => owners.has(key)))
    const origins = new Map([...previous.origins].filter(([key]) => owners.has(key)))
    assignments.delete(namespace)
    const destinations = new Map([...nextDestinations].filter(([key]) => owners.has(key)))
    assignments.set(namespace, { owners, origins, identities: readerIdentities, destinations })
    while (assignments.size > 32) {
      const oldest = assignments.keys().next().value
      if (oldest !== undefined) assignments.delete(oldest)
    }
    const selectedRemotes = new Set(assigned.selected.map(remote))
    return {
      sources: assigned.selected,
      origins: new Map(
        allSources
          .filter((source) => origins.get(remote(source)) === source.key)
          .map((source) => [remote(source), source]),
      ),
      destinations,
      unavailable: new Set([...owners.keys()].filter((key) => !selectedRemotes.has(key))),
    }
  }, [allSources, namespace, identityRevision, enabled, allowHandoff])
}

/** Reading may use a same-account alternate; cached data and all mutations keep
 * the originating source and its retained account/destination. */
export function useDetailReader<T extends Source>(
  origin: T | undefined,
  allSources: readonly T[],
  entity: string,
  remote: (source: T) => string = (source) =>
    source.repository ? pullRepositoryKey(source.repository, source.key) : source.key,
  allowHandoff = true,
) {
  const group = useMemo(
    () =>
      origin
        ? allowHandoff
          ? allSources.filter((source) => remote(source) === remote(origin))
          : [origin]
        : [],
    [origin, allSources, allowHandoff],
  )
  const namespace = `detail:${origin?.scope ?? entity}:${entity}`
  const selected = useSourceReaders(group, namespace, remote, !!origin, origin, allowHandoff)
  return useMemo(() => {
    if (!origin) return { reader: undefined, destination: undefined }
    const reader = selected.sources[0]
    return {
      reader,
      destination: assignments.get(namespace)?.destinations.get(remote(origin)),
    }
  }, [origin, selected.sources, namespace])
}
