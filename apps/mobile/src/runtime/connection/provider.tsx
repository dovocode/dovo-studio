import { mergeAccountInternetConnection } from '@dovo/protocol'
import type { WorkspacePatchResult, PendingMessage, Task } from '@dovo/protocol'
import {
  setPeerConnectionsActive,
  setPeerConnectionNetwork,
  forgetPeerConnection,
  peerConnectionVersion,
  subscribePeerConnections,
  peerConnectionReady,
  replacePeerConnection,
  preparePeerConnection,
} from './peer-transport'
import { isPeerAddress, type PeerConfig, type PeerRelayProvider } from '@dovo/protocol'
import type { Repository } from '@dovo/protocol'
import {
  runtimeHasCustomName,
  mergeSharedSettings,
  pendingSharedSettings,
  sharedSettingsSyncSchema,
} from '@dovo/protocol'
import { writeRuntimeSnapshotCache } from '@dovo/protocol'
import { RuntimeMutations } from '@dovo/protocol'
import { mobileMutationStorage } from './mutation-storage'
import { runtimeSnapshotPath } from '@dovo/protocol'
import { learnRuntimeRoutes, retryRuntimeSync, startRuntimeSync } from '@dovo/protocol'
import {
  useMobilePreferences,
  updateMobilePreferences,
  readMobilePreferences,
} from '../preferences/app-preferences'
import { pendingAgentPresets } from '@dovo/protocol'
import {
  optimisticTaskEffect,
  optimisticTaskConfirmed,
  previewTasks,
  type OptimisticTask,
  type TaskPreview,
} from '../state/optimistic-tasks'
import { nativeEffect, mobileWorkflow } from '../state/native-effect'
import { useApplicationState } from '../state/application-state'
import { decode } from '@dovo/protocol'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { RegistryContext, useAtomValue } from '@effect/atom-react'
import { Atom } from 'effect/reactivity'
import { AppState } from 'react-native'
import * as Network from 'expo-network'
import * as SecureStore from 'expo-secure-store'
import { Data, Effect, Schema, Semaphore } from 'effect'
import {
  saveRuntimePairing,
  cancelRuntimePairing,
  recoverRuntimePairings,
  type PairingProof,
  snapshotSchema,
  runtimeSnapshotCacheSchema,
  runtimeRequestEffect,
  responses,
  clearRuntimeRequestCache,
  getRuntimeSnapshotTag,
  runtimeRegistrySchema,
  runtimeProfile,
  upsertRuntime,
  removeRuntime,
  loadRuntimeOverviewEffect,
  loadFleetPullOverviewsEffect,
  pullOverviewScope,
  isUnauthorizedRuntimeError,
  sameRuntimeConnection,
  type RuntimeConnection,
  type RuntimeSnapshot,
  type RuntimeRegistry,
  type RuntimeProfile,
  type RuntimeOverview,
  type RuntimeReadCache,
} from '@dovo/protocol'
import { mobileReadCache } from './read-cache'
import {
  clientScopeKey,
  startPolling,
  runClientEffect,
  clientTaskScope,
} from '@dovo/client-runtime'
import { retainOverviewSnapshot, shouldPublishOverview } from './overview-state'
import { registryKey, restoreRegistry } from '../state/restore-registry'
const empty: RuntimeRegistry = {
  version: 1,
  activeId: null,
  profiles: [],
}
type Call = <T extends Schema.Codec<unknown, unknown>>(
  path: string,
  input: unknown,
  schema: T,
  method?: string,
) => Promise<T['Type']>
type RuntimeRead = <T extends Schema.Codec<unknown, unknown>>(
  profile: RuntimeProfile,
  path: string,
  input: unknown,
  schema: T,
  method?: string,
) => Promise<T['Type']>
class ConnectionChangedError extends Data.TaggedError('ConnectionChangedError')<{
  readonly message: string
}> {}
type CallEffect = <T extends Schema.Codec<unknown, unknown>>(
  path: string,
  input: unknown,
  schema: T,
  method?: string,
) => Effect.Effect<T['Type'], Error>
type RuntimeReadEffect = <T extends Schema.Codec<unknown, unknown>>(
  profile: RuntimeProfile,
  path: string,
  input: unknown,
  schema: T,
  method?: string,
) => Effect.Effect<T['Type'], Error>
export type Runtime = {
  previewTaskEffect: <A extends WorkspacePatchResult, E>(
    profile: RuntimeProfile,
    taskId: string,
    changes: TaskPreview,
    request: Effect.Effect<A, E>,
  ) => Effect.Effect<A, E>

  snapshot: RuntimeSnapshot | null
  connection: RuntimeConnection | null
  profile: RuntimeProfile | null
  profiles: RuntimeProfile[]
  overviews: RuntimeOverview[]
  activeId: string | null
  legacyDraftRuntimeId: string | null
  connected: boolean
  ready: boolean
  registryLoaded: boolean
  /** Saved pairings are being checked after launch; connections wait for the result. */
  recovering: boolean
  error: string
  syncAccountSession: (session: string | null) => Promise<void>
  connectEffect: (
    value: RuntimeConnection,
    name?: string,
    proof?: PairingProof,
    replaceId?: string,
  ) => Effect.Effect<void, Error>
  selectRuntimeEffect: (id: string) => Effect.Effect<void, Error>
  forgetRuntimeEffect: (id: string) => Effect.Effect<void, Error>
  renameRuntimeEffect: (id: string, name: string) => Effect.Effect<void, Error>
  upgradeInternetEffect: (
    id: string,
    previous: RuntimeConnection,
    peer: PeerConfig,
  ) => Effect.Effect<void, Error>
  setPeerRelayEffect: (
    id: string,
    relay: PeerRelayProvider | undefined,
  ) => Effect.Effect<void, Error>
  disconnectEffect: () => Effect.Effect<void, Error>
  refreshEffect: () => Effect.Effect<void, Error>
  connect: (
    value: RuntimeConnection,
    name?: string,
    proof?: PairingProof,
    replaceId?: string,
  ) => Promise<void>
  selectRuntime: (id: string) => Promise<void>
  forgetRuntime: (id: string) => Promise<void>
  renameRuntime: (id: string, name: string) => Promise<void>
  cancelPairing: (address: string, proof: PairingProof) => Promise<void>
  disconnect: () => Promise<void>
  refresh: () => Promise<void>
  refreshAll: () => Promise<void>
  refreshRuntime: (profile: RuntimeProfile) => Promise<void>
  call: Call
  callEffect: CallEffect
  readEffect: CallEffect
  readRuntimeEffect: RuntimeReadEffect
  refreshRuntimeEffect: (profile: RuntimeProfile) => Effect.Effect<void, Error>
  pendingMessages: (task: Task) => PendingMessage[]
  pendingMessagesFor: (profile: RuntimeProfile, task: Task) => PendingMessage[]
  mutationStatus: (profile: RuntimeProfile) => { pending: number; error: string | null }
  retryMutations: (profile: RuntimeProfile) => Promise<void>
  discardMutations: (profile: RuntimeProfile) => Promise<void>
  read: Call
  readRuntime: RuntimeRead
  cacheForRuntime: (profile: RuntimeProfile) => RuntimeReadCache
  readCache: RuntimeReadCache | null
}
export const RuntimeContext = createContext<Runtime | null>(null)
const Context = RuntimeContext
const RuntimeStateContext = createContext<Atom.Writable<Runtime> | null>(null)
/** Broad readers keep the context value; selectors subscribe only to the slice they render. */
function RuntimeValueProvider({ value, children }: { value: Runtime; children: ReactNode }) {
  // A rebuilt atom node reads the latest committed value, never a retained first snapshot.
  const committed = useRef(value)
  const [atom] = useState(() =>
    Atom.writable(
      () => committed.current,
      (context, next: Runtime) => context.setSelf(next),
    ),
  )
  const registry = useContext(RegistryContext)
  // Publish after commit, as the conversation selectors do, so render stays free of updates.
  useLayoutEffect(() => {
    committed.current = value
    registry.set(atom, value)
  }, [registry, atom, value])
  return (
    <RuntimeStateContext.Provider value={atom}>
      <Context.Provider value={value}>{children}</Context.Provider>
    </RuntimeStateContext.Provider>
  )
}
const initialOverview = (profile: RuntimeProfile): RuntimeOverview => ({
  profile,
  snapshot: null,
  connected: false,
  lastSeen: null,
  error: null,
  pulls: null,
  pullError: null,
})
export function RuntimeProvider({ children }: { children: ReactNode }) {
  const accountSession = useRef<string | null>(null)
  const [registry, setRegistry, current] = useApplicationState<RuntimeRegistry>(empty),
    [entries, setEntries, entryRef] = useApplicationState<Record<string, RuntimeOverview>>(
      {},
      (previous, next) => {
        if (
          !previous ||
          Object.keys(previous).length !== Object.keys(next).length ||
          Object.entries(next).some(([id, entry]) => shouldPublishOverview(previous[id], entry))
        )
          return next
        return previous
      },
    ),
    [ready, setReady] = useApplicationState(false),
    [recovering, setRecovering] = useApplicationState(true),
    [storageError, setStorageError] = useApplicationState(''),
    [legacyDraftRuntimeId, setLegacyDraftRuntimeId] = useApplicationState<string | null>(null)
  const [previews, setPreviews] = useApplicationState<OptimisticTask[]>([])
  const [appActive, setAppActive] = useApplicationState(AppState.currentState === 'active')
  const peerVersion = useSyncExternalStore(
    subscribePeerConnections,
    peerConnectionVersion,
    peerConnectionVersion,
  )
  const [registryLoaded, setRegistryLoaded, registryWritable] = useApplicationState(false)
  const [restoreAttempt, setRestoreAttempt] = useApplicationState(0)
  const { computerRefresh } = useMobilePreferences()
  useEffect(() => {
    setPeerConnectionsActive(AppState.currentState === 'active')
    let disposed = false
    let networkObserved = false
    const network = Network.addNetworkStateListener((state) => {
      if (disposed) return
      networkObserved = true
      setPeerConnectionNetwork(state)
    })
    // Android may emit its initial native state before this listener is attached.
    // A late initial read must not overwrite a newer handover event.
    void Network.getNetworkStateAsync().then(
      (state) => {
        if (!disposed && !networkObserved) setPeerConnectionNetwork(state)
      },
      (error: unknown) => console.warn('Could not read the initial network state:', error),
    )
    const subscription = AppState.addEventListener('change', (state) => {
      setPeerConnectionsActive(state === 'active')
      setAppActive(state === 'active')
    })
    return () => {
      disposed = true
      subscription.remove()
      network.remove()
      setPeerConnectionsActive(false)
    }
  }, [])
  const previewTaskEffect = useCallback(
    <A extends WorkspacePatchResult, E>(
      owner: RuntimeProfile,
      taskId: string,
      changes: TaskPreview,
      request: Effect.Effect<A, E>,
    ) =>
      optimisticTaskEffect(
        {
          id: Symbol(taskId),
          connection: owner.connection,
          taskId,
          changes,
          runtimeInstanceId: entryRef.current[owner.id]?.snapshot?.runtimeInstanceId,
        },
        setPreviews,
        request,
      ),
    [],
  )
  const [mutationVersion, setMutationVersion] = useApplicationState(0)
  const [mutations] = useApplicationState(
    () =>
      new RuntimeMutations(mobileMutationStorage, () =>
        setMutationVersion((version) => version + 1),
      ),
  )
  const [storageLock] = useApplicationState(() => Effect.runSync(Semaphore.make(1)))
  const beforeReplace = useCallback(
    (previous: RuntimeConnection) =>
      mutations
        .assertEmptyEffect(previous)
        .pipe(
          Effect.mapError(
            (error) =>
              new Error(
                `Resolve saved actions before updating this computer connection. ${error.message}`,
              ),
          ),
        ),
    [mutations],
  )
  const sequence = useRef(new Map<string, number>())
  const fleetPending = useRef(
    new Map<
      string,
      {
        token: string
        effect: Effect.Effect<void>
      }
    >(),
  )
  const caches = useRef(
    new Map<
      string,
      {
        address: string
        token: string
        cache: RuntimeReadCache
      }
    >(),
  )
  const cacheDirty = useRef(new Set<string>())
  const cacheMarks = useRef(
    new Map<
      string,
      {
        token: string
        tag: string | undefined
        pulls: string
        writtenAt: number
      }
    >(),
  )
  const cacheFor = useCallback((profile: RuntimeProfile) => {
    let entry = caches.current.get(profile.id)
    if (
      !entry ||
      entry.token !== profile.connection.token ||
      entry.address !== profile.connection.address
    ) {
      if (entry) {
        clearRuntimeRequestCache({
          address: entry.address,
          token: entry.token,
        })
        void entry.cache.close()
      }
      entry = {
        address: profile.connection.address,
        token: profile.connection.token,
        cache: mobileReadCache(profile.connection),
      }
      caches.current.set(profile.id, entry)
    }
    return entry.cache
  }, [])
  const updateEntry = useCallback(
    (profile: RuntimeProfile, update: (entry: RuntimeOverview) => RuntimeOverview) => {
      const saved = current.current.profiles.find((item) => item.id === profile.id)
      if (!saved || !sameRuntimeConnection(saved.connection, profile.connection)) return
      const previous = sameRuntimeConnection(
        entryRef.current[profile.id]?.profile.connection,
        profile.connection,
      )
        ? entryRef.current[profile.id]
        : initialOverview(profile)
      const next = update(previous)
      const entry = retainOverviewSnapshot(previous, {
        ...next,
        snapshot:
          next.snapshot && !mutations.acceptsWorkspaceSnapshot(profile.connection, next.snapshot)
            ? previous.snapshot
            : next.snapshot,
        profile: saved,
      })
      // Keep the exact latest contact time for offline transitions and persistence.
      setEntries((latest) => ({
        ...latest,
        [profile.id]: entry,
      }))
      if (entry.connected && entry.snapshot) {
        const mark = cacheMarks.current.get(profile.id)
        const tag = getRuntimeSnapshotTag(entry.snapshot)
        if (
          !tag ||
          !mark ||
          mark.tag !== tag ||
          mark.token !== profile.connection.token ||
          mark.pulls !== JSON.stringify(entry.pulls) ||
          Date.now() - mark.writtenAt > 60000
        )
          cacheDirty.current.add(profile.id)
      }
    },
    [mutations],
  )
  const persistEntryEffect = useCallback(
    (id: string) =>
      mobileWorkflow(function* () {
        const entry = entryRef.current[id]
        if (
          !entry?.snapshot ||
          !current.current.profiles.some(
            (item) =>
              item.id === id && sameRuntimeConnection(item.connection, entry.profile.connection),
          )
        )
          return
        const cache = cacheFor(entry.profile)
        yield* writeRuntimeSnapshotCache(cache, {
          snapshot: entry.snapshot,
          lastSeen: entry.lastSeen,
          pulls: entry.pulls,
        })
        if (caches.current.get(id)?.cache === cache)
          cacheMarks.current.set(id, {
            token: entry.profile.connection.token,
            tag: getRuntimeSnapshotTag(entry.snapshot),
            pulls: JSON.stringify(entry.pulls),
            writtenAt: Date.now(),
          })

        const latest = entryRef.current[id]
        if (latest?.snapshot === entry.snapshot && latest.pulls === entry.pulls)
          cacheDirty.current.delete(id)
      }).pipe(Effect.uninterruptible),
    [cacheFor],
  )
  useEffect(() => {
    if (!appActive) return
    const persist = mobileWorkflow(function* () {
      if (!cacheDirty.current.size) return
      const ids = [...cacheDirty.current]
      yield* Effect.forEach(ids, (id) => persistEntryEffect(id), {
        concurrency: 3,
        discard: true,
      }).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            for (const id of ids) cacheDirty.current.add(id)
            setStorageError(`Could not save the offline cache. ${error.message}`)
          }),
        ),
      )
    }).pipe(Effect.uninterruptible)
    const polling = startPolling(persist, {
      interval: 15_000,
      immediate: false,
      onError: () => {},
    })
    return () => {
      void runClientEffect(nativeEffect(() => polling.stop()).pipe(Effect.flatMap(() => persist)))
    }
  }, [persistEntryEffect, appActive])
  const persistRegistryEffect = useCallback(
    (next: RuntimeRegistry) =>
      Effect.tryPromise({
        try: () => {
          if (!registryWritable.current)
            throw new Error(
              'Saved computers could not be loaded. Retry loading before pairing or editing connections.',
            )
          return SecureStore.setItemAsync(registryKey, JSON.stringify(next), {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          })
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            for (const profile of [
              ...next.profiles,
              ...(next.pendingPairings ?? []).map((entry) => entry.profile),
            ]) {
              if (profile.connection.peer) preparePeerConnection(profile.connection.peer)
              if (profile.connection.internet)
                preparePeerConnection(profile.connection.internet.peer)
            }
            setRegistry(next)
            setStorageError('')
          }),
        ),
        Effect.tapError((error) => Effect.sync(() => setStorageError(String(error)))),
      ),
    [],
  )
  const changeRegistryEffect = useCallback(
    (change: (value: RuntimeRegistry) => RuntimeRegistry) =>
      storageLock.withPermits(1)(
        mobileWorkflow(function* () {
          const next = yield* Effect.try({
            try: () => decode(runtimeRegistrySchema, change(current.current)),
            catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
          })
          yield* persistRegistryEffect(next)
        }).pipe(Effect.uninterruptible),
      ),
    [storageLock, persistRegistryEffect],
  )
  useEffect(() => {
    const learned = new Map<string, RuntimeConnection>()
    for (const entry of Object.values(entries)) {
      const saved = registry.profiles.find((profile) => profile.id === entry.profile.id)
      if (
        !saved ||
        !entry.connected ||
        !entry.snapshot ||
        !sameRuntimeConnection(saved.connection, entry.profile.connection)
      )
        continue
      try {
        const next = learnRuntimeRoutes(saved.connection, entry.snapshot)
        if (JSON.stringify(next) !== JSON.stringify(saved.connection)) learned.set(saved.id, next)
      } catch (error) {
        setStorageError(error instanceof Error ? error.message : String(error))
      }
    }
    if (learned.size)
      void runClientEffect(
        changeRegistryEffect((registry) => ({
          ...registry,
          profiles: registry.profiles.map((profile) => {
            const next = learned.get(profile.id)
            return next &&
              sameRuntimeConnection(profile.connection, next) &&
              next.peer?.relay === profile.connection.peer?.relay
              ? { ...profile, connection: next }
              : profile
          }),
        })),
      ).catch(() => undefined)
  }, [entries, registry.profiles, changeRegistryEffect])
  const cancelPairing = useCallback(
    (address: string, proof: PairingProof) =>
      runClientEffect(
        storageLock
          .withPermits(1)(
            Effect.suspend(() =>
              cancelRuntimePairing(
                current.current,
                new URL(address).origin,
                proof,
                persistRegistryEffect,
              ),
            ),
          )
          .pipe(Effect.asVoid),
      ),
    [storageLock, persistRegistryEffect],
  )
  const refreshProfileEffect = useCallback(
    (profile: RuntimeProfile) =>
      Effect.suspend(() => {
        const workspaceCheckpoint = mutations.workspaceRefreshCheckpoint(profile.connection)
        const version = (sequence.current.get(profile.id) ?? 0) + 1
        sequence.current.set(profile.id, version)
        return runtimeRequestEffect(
          profile.connection,
          profile.connection.address,
          runtimeSnapshotPath(profile.connection),
          undefined,
          snapshotSchema,
          'GET',
          10000,
        ).pipe(
          Effect.tap((snapshot) =>
            Effect.sync(() => {
              if (
                sequence.current.get(profile.id) === version &&
                mutations.acceptsWorkspaceSnapshot(profile.connection, snapshot) &&
                !(
                  entryRef.current[profile.id]?.snapshot?.runtimeInstanceId ===
                    snapshot.runtimeInstanceId &&
                  (entryRef.current[profile.id]?.snapshot?.revision ?? -1) > snapshot.revision
                )
              ) {
                mutations.workspaceRefreshed(profile.connection, workspaceCheckpoint, snapshot)
                updateEntry(profile, (previous) => ({
                  ...previous,
                  snapshot,
                  connected: true,
                  lastSeen: new Date().toISOString(),
                  error: null,
                  unauthorized: false,
                }))
              }
            }),
          ),
          Effect.tapError((error) =>
            Effect.sync(() => {
              if (sequence.current.get(profile.id) === version)
                updateEntry(profile, (previous) => ({
                  ...previous,
                  connected: false,
                  error: error.message,
                  unauthorized: isUnauthorizedRuntimeError(error),
                }))
            }),
          ),
          Effect.tap(() =>
            mutations.recoverEffect(profile.connection).pipe(Effect.catch(() => Effect.void)),
          ),
          Effect.asVoid,
        )
      }),
    [updateEntry, mutations],
  )
  const workspaceRefreshWorker = useRef<ReturnType<typeof startPolling> | null>(null)
  useEffect(() => {
    if (!ready || !appActive) return
    const worker = startPolling(
      Effect.suspend(() =>
        Effect.forEach(
          registry.profiles,
          (owner) =>
            mutations.requiresWorkspaceRefresh(owner.connection) &&
            !entryRef.current[owner.id]?.unauthorized
              ? refreshProfileEffect(owner)
              : Effect.void,
          { concurrency: 4, discard: true },
        ),
      ),
      { interval: 1000, backoff: 10000, onError: () => {} },
    )
    workspaceRefreshWorker.current = worker
    return () => {
      workspaceRefreshWorker.current = null
      void worker.stop()
    }
  }, [ready, appActive, registry.profiles, mutations, refreshProfileEffect])
  useEffect(() => {
    workspaceRefreshWorker.current?.refresh()
  }, [mutationVersion])
  const refreshProfile = useCallback(
    (profile: RuntimeProfile) => runClientEffect(refreshProfileEffect(profile)),
    [refreshProfileEffect],
  )
  const pullOverviewReads = useRef(new Map<string, { at: number; scope: string }>())
  const refreshOverviewEffect = useCallback(
    (profile: RuntimeProfile): Effect.Effect<void> =>
      Effect.suspend(() => {
        const pending = fleetPending.current.get(profile.id)
        if (pending?.token === profile.connection.token) return pending.effect
        const version = (sequence.current.get(profile.id) ?? 0) + 1
        sequence.current.set(profile.id, version)
        const shared = Effect.runSync(
          Effect.cached(
            loadRuntimeOverviewEffect(
              profile,
              entryRef.current[profile.id],
              (next) => {
                if (sequence.current.get(profile.id) === version) updateEntry(profile, () => next)
              },
              current.current.activeId !== profile.id,
              false,
              { loadPulls: false },
            ).pipe(
              Effect.tap((next) =>
                Effect.sync(() => {
                  updateEntry(profile, (previous) =>
                    sequence.current.get(profile.id) === version
                      ? next
                      : {
                          ...previous,
                          pulls: next.pulls,
                          pullError: next.pullError,
                        },
                  )
                }),
              ),
              Effect.asVoid,
              Effect.ensuring(
                Effect.sync(() => {
                  if (fleetPending.current.get(profile.id)?.effect === shared)
                    fleetPending.current.delete(profile.id)
                }),
              ),
            ),
          ),
        )
        fleetPending.current.set(profile.id, {
          token: profile.connection.token,
          effect: shared,
        })
        return shared
      }),
    [updateEntry],
  )
  const refreshAllEffect = useCallback(
    (includeActive = true) =>
      Effect.gen(function* () {
        yield* Effect.forEach(
          current.current.profiles.filter(
            (item) => includeActive || item.id !== current.current.activeId,
          ),
          (profile) => refreshOverviewEffect(profile),
          { concurrency: 3, discard: true },
        )
        const entries = current.current.profiles.flatMap((profile) => {
          const entry = entryRef.current[profile.id]
          return entry && entry.profile.connection.token === profile.connection.token ? [entry] : []
        })
        const scope = (entry: RuntimeOverview, repositories: readonly Repository[]) =>
          JSON.stringify([entry.profile.connection, pullOverviewScope(repositories)])
        const scopes = new Map<string, string>()
        yield* loadFleetPullOverviewsEffect(
          entries,
          (value) => {
            const previous = entryRef.current[value.profile.id]
            if (
              !previous?.snapshot ||
              !value.snapshot ||
              !sameRuntimeConnection(previous.profile.connection, value.profile.connection) ||
              pullOverviewScope(previous.snapshot.workspace.repositories) !==
                pullOverviewScope(value.snapshot.workspace.repositories)
            )
              return
            const selectedScope = scopes.get(value.profile.id)
            if (!selectedScope) pullOverviewReads.current.delete(value.profile.id)
            if (selectedScope && !value.pullError)
              pullOverviewReads.current.set(value.profile.id, {
                at: Date.now(),
                scope: selectedScope,
              })
            updateEntry(value.profile, (previous) => ({
              ...previous,
              pulls: value.pulls,
              pullError: value.pullError,
            }))
          },
          (entry, repositories) => {
            const selectedScope = scope(entry, repositories)
            scopes.set(entry.profile.id, selectedScope)
            const previous = pullOverviewReads.current.get(entry.profile.id)
            return (
              includeActive ||
              previous?.scope !== selectedScope ||
              Date.now() - previous.at >= 5 * 60_000
            )
          },
        )
      }),
    [refreshOverviewEffect, updateEntry],
  )
  const refreshAll = useCallback(() => runClientEffect(refreshAllEffect()), [refreshAllEffect])
  const profile = registry.profiles.find((item) => item.id === registry.activeId) ?? null
  const connection = profile?.connection ?? null
  const active =
    profile && entries[profile.id]?.profile.connection.token === profile.connection.token
      ? entries[profile.id]
      : undefined
  const refreshEffect = useCallback(() => {
    return mobileWorkflow(function* () {
      if (profile) {
        retryRuntimeSync(profile.connection)
        yield* refreshProfileEffect(profile)
      }
    })
  }, [profile, refreshProfileEffect])
  const connectEffect = useCallback(
    (value: RuntimeConnection, name?: string, proof?: PairingProof, replaceId?: string) => {
      return mobileWorkflow(function* () {
        if (!registryWritable.current)
          return yield* Effect.fail(
            new Error(
              'Saved computers could not be loaded. Retry loading before pairing or editing connections.',
            ),
          )
        if (proof || value.accountSession) {
          const snapshot = yield* runtimeRequestEffect(
            value,
            value.address,
            '/api/snapshot',
            undefined,
            snapshotSchema,
            'GET',
          )
          value = learnRuntimeRoutes(value, snapshot)
        }
        const previous = current.current.profiles.find((item) =>
          replaceId
            ? item.id === replaceId
            : !!value.runtimeId && item.connection.runtimeId === value.runtimeId,
        )
        if (replaceId && (!previous || !proof))
          return yield* Effect.fail(
            new Error('Select a saved computer and pair its new address before replacing it.'),
          )
        const next = {
          ...runtimeProfile(
            mergeAccountInternetConnection(previous?.connection, value),
            name || previous?.name,
          ),
          nameIsCustom: name?.trim() ? true : previous ? runtimeHasCustomName(previous) : false,
          ...(previous ? { id: previous.id } : {}),
        }
        if (previous && !sameRuntimeConnection(previous.connection, next.connection))
          yield* beforeReplace(previous.connection)
        yield* refreshProfileEffect(next)
        if (proof)
          yield* storageLock.withPermits(1)(
            Effect.suspend(() =>
              saveRuntimePairing(
                current.current,
                { profile: next, proof },
                persistRegistryEffect,
                beforeReplace,
              ),
            ),
          )
        else
          yield* changeRegistryEffect((saved) => {
            if (value.accountSession && accountSession.current !== value.accountSession)
              throw new Error('Account changed while connecting. Sign in again.')
            const current = saved.profiles.find((item) => item.id === next.id)
            if (
              previous &&
              (!current || !sameRuntimeConnection(current.connection, previous.connection))
            )
              throw new Error('Computer connection changed while connecting. Try again.')
            return upsertRuntime(saved, next)
          })
        yield* refreshOverviewEffect(next)
      })
    },
    [
      changeRegistryEffect,
      refreshProfileEffect,
      refreshOverviewEffect,
      storageLock,
      persistRegistryEffect,
      beforeReplace,
    ],
  )
  const syncAccountSession = useCallback(
    (session: string | null) => {
      accountSession.current = session
      if (
        !current.current.profiles.some(
          (profile) =>
            (profile.connection.accountSession && profile.connection.accountSession !== session) ||
            (profile.connection.internet && profile.connection.internet.session !== session),
        )
      )
        return Promise.resolve()
      return runClientEffect(
        changeRegistryEffect((saved) => {
          let changed = false
          const profiles = saved.profiles.flatMap((profile) => {
            if (
              profile.connection.accountSession &&
              profile.connection.accountSession !== session
            ) {
              forgetPeerConnection(profile.connection.address)
              changed = true
              return []
            }
            if (profile.connection.internet && profile.connection.internet.session !== session) {
              forgetPeerConnection(profile.connection.internet.address)
              changed = true
              return [{ ...profile, connection: { ...profile.connection, internet: undefined } }]
            }
            return [profile]
          })
          return changed
            ? {
                ...saved,
                profiles,
                activeId: profiles.some((item) => item.id === saved.activeId)
                  ? saved.activeId
                  : (profiles[0]?.id ?? null),
              }
            : saved
        }),
      )
    },
    [changeRegistryEffect],
  )
  const selectRuntimeEffect = useCallback(
    (id: string) => {
      return mobileWorkflow(function* () {
        yield* changeRegistryEffect((saved) => {
          if (!saved.profiles.some((item) => item.id === id))
            throw new Error('This computer is no longer saved')
          return {
            ...saved,
            activeId: id,
          }
        })
      })
    },
    [changeRegistryEffect],
  )
  const forgetRuntimeEffect = useCallback(
    (id: string) => {
      return mobileWorkflow(function* () {
        const profile = current.current.profiles.find((item) => item.id === id)
        if (profile) yield* mutations.assertEmptyEffect(profile.connection)
        if (profile) clearRuntimeRequestCache(profile.connection)
        yield* changeRegistryEffect((saved) => removeRuntime(saved, id))
        const next = {
          ...entryRef.current,
        }
        delete next[id]
        setEntries(next)
        if (profile) yield* cacheFor(profile).clearEffect()
        caches.current.delete(id)
        cacheDirty.current.delete(id)
        cacheMarks.current.delete(id)
        // After the local removal is durable, retire this phone's credential on the computer so
        // forgotten phones don't linger as trusted devices. Offline or owner hosts just skip it.
        if (profile)
          yield* runtimeRequestEffect(
            profile.connection,
            profile.connection.address,
            '/api/devices/revoke-self',
            {},
            responses.ok,
            'POST',
            4000,
          ).pipe(Effect.ignore)
        if (profile) {
          forgetPeerConnection(profile.connection.address)
          if (profile.connection.internet) forgetPeerConnection(profile.connection.internet.address)
        }
      })
    },
    [changeRegistryEffect, cacheFor, mutations],
  )
  const renameRuntimeEffect = useCallback(
    (id: string, name: string) => {
      return mobileWorkflow(function* () {
        if (!name.trim()) return yield* Effect.fail(new Error('Enter a computer name'))
        yield* changeRegistryEffect((saved) => ({
          ...saved,
          profiles: saved.profiles.map((item) =>
            item.id === id
              ? {
                  ...item,
                  name: name.trim(),
                  nameIsCustom: true,
                }
              : item,
          ),
        }))
      })
    },
    [changeRegistryEffect],
  )
  const disconnectEffect = useCallback(() => {
    return mobileWorkflow(function* () {
      const active = current.current.profiles.find((item) => item.id === current.current.activeId)
      if (active) clearRuntimeRequestCache(active.connection)
      yield* changeRegistryEffect((saved) => ({
        ...saved,
        activeId: null,
      }))
    })
  }, [changeRegistryEffect])
  const upgradeInternetEffect = useCallback(
    (id: string, previous: RuntimeConnection, peer: PeerConfig) =>
      mobileWorkflow(function* () {
        const profile = current.current.profiles.find((item) => item.id === id)
        if (!profile || !sameRuntimeConnection(profile.connection, previous))
          return yield* Effect.fail(new Error('This computer connection changed. Try again.'))
        yield* beforeReplace(previous)
        const address = preparePeerConnection(peer)
        const connection = { ...previous, address, peer, alternateAddresses: undefined }
        let committed = false
        yield* mobileWorkflow(function* () {
          // Prove the new path works with the existing token before replacing the saved route.
          const snapshot = yield* runtimeRequestEffect(
            connection,
            address,
            '/api/snapshot',
            undefined,
            snapshotSchema,
            'GET',
            30000,
          )
          const verified = learnRuntimeRoutes(connection, snapshot)
          yield* beforeReplace(previous)
          yield* changeRegistryEffect((saved) => {
            const current = saved.profiles.find((item) => item.id === id)
            if (!current || !sameRuntimeConnection(current.connection, previous))
              throw new Error('This computer connection changed. Try again.')
            return {
              ...saved,
              profiles: saved.profiles.map((item) =>
                item.id === id ? { ...item, connection: verified } : item,
              ),
            }
          }).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                committed = true
              }),
            ),
            Effect.uninterruptible,
          )
          clearRuntimeRequestCache(previous)
          updateEntry({ ...profile, connection: verified }, (entry) => ({
            ...entry,
            snapshot,
            connected: true,
            error: null,
            unauthorized: false,
          }))
        }).pipe(
          Effect.onError(() =>
            Effect.sync(() => {
              if (!committed) forgetPeerConnection(address)
            }),
          ),
        )
      }),
    [beforeReplace, changeRegistryEffect, updateEntry],
  )
  const setPeerRelayEffect = useCallback(
    (id: string, relay: PeerRelayProvider | undefined) =>
      mobileWorkflow(function* () {
        const profile = current.current.profiles.find((item) => item.id === id)
        if (!profile?.connection.peer || !isPeerAddress(profile.connection.address))
          return yield* Effect.fail(new Error('Relay settings require an internet pairing'))
        const peer = { ...profile.connection.peer, relay }
        yield* changeRegistryEffect((saved) => ({
          ...saved,
          profiles: saved.profiles.map((item) =>
            item.id === id && sameRuntimeConnection(item.connection, profile.connection)
              ? { ...item, connection: { ...item.connection, peer } }
              : item,
          ),
        }))
        replacePeerConnection(peer)
      }),
    [changeRegistryEffect],
  )
  // Bind every caller to the selected host. An async action can never continue on a new host.
  const readEffect = useCallback<CallEffect>(
    (path, input, schema, method) =>
      Effect.suspend(() => {
        if (!profile)
          return Effect.fail(
            new ConnectionChangedError({
              message: 'Connect a computer first',
            }),
          )
        const valid = () =>
          current.current.activeId === profile.id &&
          current.current.profiles.some(
            (item) => item.id === profile.id && item.connection.token === profile.connection.token,
          )
        const changed = () =>
          new ConnectionChangedError({
            message: 'The selected computer changed. Try the action again.',
          })
        if (!valid()) return Effect.fail(changed())
        return mutations
          .requestEffect(profile.connection, path, input, schema, method)
          .pipe(
            Effect.flatMap((result) => (valid() ? Effect.succeed(result) : Effect.fail(changed()))),
          )
      }),
    [profile, mutations],
  )
  const read = useCallback<Call>((...args) => runClientEffect(readEffect(...args)), [readEffect])
  // Collection operations retain their owner even when the selected computer changes.
  const readRuntimeEffect = useCallback<RuntimeReadEffect>(
    (owner, path, input, schema, method) =>
      Effect.suspend(() => {
        const valid = () =>
          current.current.profiles.some(
            (saved) =>
              saved.id === owner.id &&
              saved.connection.address === owner.connection.address &&
              saved.connection.token === owner.connection.token,
          )
        const changed = () =>
          new ConnectionChangedError({
            message: 'This computer connection changed. Refresh the collection.',
          })
        if (!valid()) return Effect.fail(changed())
        return mutations
          .requestEffect(owner.connection, path, input, schema, method)
          .pipe(
            Effect.flatMap((result) => (valid() ? Effect.succeed(result) : Effect.fail(changed()))),
          )
      }),
    [mutations],
  )
  const readRuntime = useCallback<RuntimeRead>(
    (...args) => runClientEffect(readRuntimeEffect(...args)),
    [readRuntimeEffect],
  )
  const callEffect = useCallback<CallEffect>(
    (path, input, schema, method) =>
      readEffect(path, input, schema, method).pipe(
        // The mutation already committed. A failed refresh is reported in overview state.
        Effect.tap(() =>
          profile
            ? refreshProfileEffect(profile).pipe(Effect.catch(() => Effect.void))
            : Effect.void,
        ),
        Effect.tap(() =>
          profile
            ? persistEntryEffect(profile.id).pipe(
                Effect.catch((error) =>
                  Effect.sync(() =>
                    setStorageError(`Could not save the offline cache. ${error.message}`),
                  ),
                ),
              )
            : Effect.void,
        ),
      ),
    [readEffect, profile, refreshProfileEffect, persistEntryEffect],
  )
  useEffect(() => {
    if (!ready || !appActive) return
    for (const profile of registry.profiles)
      void runClientEffect(mutations.recoverEffect(profile.connection)).catch(() => undefined)
  }, [ready, appActive, registry.profiles, mutations])
  const call = useCallback<Call>((...args) => runClientEffect(callEffect(...args)), [callEffect])
  useEffect(() => {
    let disposed = false
    const commands = clientTaskScope()
    const restore = mobileWorkflow(function* () {
      const { registry: restored, draftRuntimeId } = yield* restoreRegistry({
        getItem: (key) => SecureStore.getItemAsync(key),
        setItem: (key, value) =>
          SecureStore.setItemAsync(key, value, {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          }),
        removeItem: (key) => SecureStore.deleteItemAsync(key),
      })
      const saved = restored
      if (!disposed) setLegacyDraftRuntimeId(draftRuntimeId)
      if (disposed) return
      for (const profile of [
        ...saved.profiles,
        ...(saved.pendingPairings ?? []).map((entry) => entry.profile),
      ]) {
        if (profile.connection.peer) preparePeerConnection(profile.connection.peer)
        if (profile.connection.internet) preparePeerConnection(profile.connection.internet.peer)
      }
      setRegistry(saved)
      setRegistryLoaded(true)
      setStorageError('')
      yield* Effect.forEach(
        saved.profiles,
        (profile) =>
          mobileWorkflow(function* () {
            const cached = yield* cacheFor(profile).readEffect(
              'snapshot',
              runtimeSnapshotCacheSchema,
            )
            if (!cached || disposed) return
            updateEntry(profile, (entry) => ({
              ...entry,
              snapshot: {
                ...cached.value.snapshot,
                approvals: [],
                questions: [],
                terminals: [],
                pendingDevices: [],
              },
              lastSeen: cached.value.lastSeen,
              pulls: cached.value.pulls
                ? {
                    ...cached.value.pulls,
                    partial: true,
                  }
                : null,
              connected: false,
            }))
          }).pipe(
            Effect.catch((error) =>
              Effect.sync(() => {
                if (!disposed) setStorageError(`Could not load the offline cache. ${error.message}`)
              }),
            ),
          ),
        {
          concurrency: 3,
          discard: true,
        },
      )
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => {
          if (!disposed) setStorageError(error.message)
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          if (!disposed) setReady(true)
        }),
      ),
    )
    void commands.run(restore)
    return () => {
      disposed = true
      void commands.stop()
    }
  }, [cacheFor, updateEntry, persistRegistryEffect, restoreAttempt])
  useEffect(() => {
    if (!ready) return
    const commands = clientTaskScope()
    const recover = storageLock
      .withPermits(1)(
        Effect.suspend(() =>
          recoverRuntimePairings(current.current, persistRegistryEffect, beforeReplace),
        ),
      )
      .pipe(
        Effect.asVoid,
        Effect.catch((error) => Effect.sync(() => setStorageError(error.message))),
        // A pairing rotated while the app was killed must settle before the first snapshot
        // read, so the stale registry never produces a spurious error.
        Effect.ensuring(Effect.sync(() => setRecovering(false))),
      )
    void commands.run(recover)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void commands.run(recover)
    })
    return () => {
      subscription.remove()
      void commands.stop()
    }
  }, [ready, storageLock, persistRegistryEffect, beforeReplace])
  useEffect(() => {
    if (!ready || recovering || !profile || !appActive) return
    let stopped = false
    let wakeFallback = () => {}
    const live = startRuntimeSync(profile.connection, {
      onStatus: (syncStatus) => {
        if (!stopped) updateEntry(profile, (previous) => ({ ...previous, syncStatus }))
      },
      onWake: () => wakeFallback(),
      onSnapshot: (snapshot) => {
        if (
          stopped ||
          !mutations.acceptsWorkspaceSnapshot(profile.connection, snapshot) ||
          (entryRef.current[profile.id]?.snapshot?.runtimeInstanceId ===
            snapshot.runtimeInstanceId &&
            (entryRef.current[profile.id]?.snapshot?.revision ?? -1) > snapshot.revision)
        )
          return
        void runClientEffect(mutations.recoverEffect(profile.connection)).catch(() => undefined)
        sequence.current.set(profile.id, (sequence.current.get(profile.id) ?? 0) + 1)
        mutations.workspaceRefreshed(
          profile.connection,
          mutations.workspaceRefreshCheckpoint(profile.connection),
          snapshot,
        )
        updateEntry(profile, (previous) => ({
          ...previous,
          snapshot,
          connected: true,
          lastSeen: new Date().toISOString(),
          error: null,
          unauthorized: false,
        }))
      },
    })
    const polling = startPolling(
      Effect.suspend(() =>
        // A revoked pairing cannot recover by polling; explicit Reconnect still checks it.
        !live.online() && !entryRef.current[profile.id]?.unauthorized
          ? refreshProfileEffect(profile)
          : Effect.void,
      ),
      {
        interval: 1000,
        // An unreachable host is not hammered every second; foregrounding still retries at once.
        backoff: 10000,
        // refreshProfileEffect owns error publication and rejects failures superseded
        // by a newer request or streamed snapshot. Do not publish them again here.
        onError: () => {},
      },
    )
    wakeFallback = polling.refresh
    // Wi-Fi to cellular, a VPN toggle or captive portal: ask the runtime at once instead of
    // waiting for the socket watchdog or the next failed poll.
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected) {
        live.refresh()
        polling.refresh()
      }
    })
    return () => {
      stopped = true
      network.remove()
      live.stop()
      void polling.stop()
    }
  }, [ready, recovering, profile, appActive, refreshProfileEffect, updateEntry, mutations])
  useEffect(() => {
    if (!ready || !appActive || computerRefresh === 'manual') return
    const polling = startPolling(
      Effect.suspend(() => {
        if (AppState.currentState !== 'active') return Effect.void
        if (computerRefresh !== 'reduced') return refreshAllEffect(false)
        // Reduced background activity on a metered link keeps other computers' summaries as
        // they are; the active computer still refreshes through its own connection.
        return Effect.tryPromise({
          try: () => Network.getNetworkStateAsync(),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }).pipe(
          Effect.flatMap((state) =>
            state.type === Network.NetworkStateType.CELLULAR
              ? Effect.void
              : refreshAllEffect(false),
          ),
        )
      }),
      {
        interval: computerRefresh === 'reduced' ? 120000 : 30000,
        onError: (error) => setStorageError(String(error)),
      },
    )
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') polling.refresh()
    })
    return () => {
      void polling.stop()
      subscription.remove()
    }
  }, [ready, appActive, registry.profiles, refreshAllEffect, computerRefresh])
  const refresh = useCallback(
    (...args: Parameters<typeof refreshEffect>) => runClientEffect(refreshEffect(...args)),
    [refreshEffect],
  )
  const connect = useCallback(
    (...args: Parameters<typeof connectEffect>) => runClientEffect(connectEffect(...args)),
    [connectEffect],
  )
  const selectRuntime = useCallback(
    (...args: Parameters<typeof selectRuntimeEffect>) =>
      runClientEffect(selectRuntimeEffect(...args)),
    [selectRuntimeEffect],
  )
  const forgetRuntime = useCallback(
    (...args: Parameters<typeof forgetRuntimeEffect>) =>
      runClientEffect(forgetRuntimeEffect(...args)),
    [forgetRuntimeEffect],
  )
  const renameRuntime = useCallback(
    (...args: Parameters<typeof renameRuntimeEffect>) =>
      runClientEffect(renameRuntimeEffect(...args)),
    [renameRuntimeEffect],
  )
  const disconnect = useCallback(
    (...args: Parameters<typeof disconnectEffect>) => runClientEffect(disconnectEffect(...args)),
    [disconnectEffect],
  )
  useEffect(() => {
    setPreviews((items) => {
      const next = items.filter((item) => {
        const owner = registry.profiles.find((profile) =>
          sameRuntimeConnection(profile.connection, item.connection),
        )
        return (
          !!owner &&
          (!entries[owner.id] || !optimisticTaskConfirmed(item, entries[owner.id], items))
        )
      })
      return next.length === items.length ? items : next
    })
  }, [previews, registry.profiles, entries])
  useEffect(() => {
    for (const entry of Object.values(entries))
      if (entry.snapshot)
        mutations.acknowledgeMessages(entry.profile.connection, entry.snapshot.workspace.tasks)
  }, [entries, mutationVersion, mutations])
  const overviews = useMemo(
    () =>
      registry.profiles.map((item) =>
        previewTasks(
          {
            ...(entries[item.id]?.profile.connection.token === item.connection.token
              ? entries[item.id]
              : initialOverview(item)),
            profile: item,
            ...(isPeerAddress(item.connection.address) &&
            !peerConnectionReady(item.connection.address)
              ? { connected: false }
              : {}),
          },
          previews.filter(
            (pending) =>
              !entries[item.id] || !optimisticTaskConfirmed(pending, entries[item.id], previews),
          ),
        ),
      ),
    [registry.profiles, entries, previews, peerVersion],
  )
  const [presetSyncError, setPresetSyncError] = useApplicationState('')
  const {
    sharedScopedSettings,
    globalAgentPresets,
    retiredGlobalAgentPresets,
    globalModelPreferences,
    globalModelPreferencesUpdatedAt,
  } = useMobilePreferences()
  const [settingsSyncError, setSettingsSyncError] = useApplicationState('')
  const settingsRequests = useRef(new Set<string>())
  const failedSettingsRequests = useRef(new Map<string, { fingerprint: string; error: string }>())
  const presetRequests = useRef(new Set<string>())
  const failedPresetRequests = useRef(new Map<string, { fingerprint: string; error: string }>())
  useEffect(() => {
    const publishError = () =>
      setPresetSyncError(Array.from(failedPresetRequests.current.values()).at(-1)?.error ?? '')
    for (const id of failedPresetRequests.current.keys())
      if (!overviews.some((entry) => entry.profile.id === id))
        failedPresetRequests.current.delete(id)
    for (const entry of overviews) {
      if (!entry.connected || !entry.snapshot) {
        failedPresetRequests.current.delete(entry.profile.id)
        continue
      }
      const presets = pendingAgentPresets(globalAgentPresets, entry.snapshot.workspace.agents)
      const retired = retiredGlobalAgentPresets.filter((id) =>
        entry.snapshot?.workspace.agents.some((agent) => agent.id === id && agent.globalPreset),
      )
      const modelPreferences =
        globalModelPreferences !== null &&
        globalModelPreferencesUpdatedAt >
          (entry.snapshot.defaults?.globalModelPreferencesUpdatedAt ?? 0)
          ? globalModelPreferences
          : undefined
      const fingerprint = JSON.stringify([
        presets,
        retired,
        modelPreferences,
        globalModelPreferencesUpdatedAt,
      ])
      if (!presets.length && !retired.length && !modelPreferences) {
        failedPresetRequests.current.delete(entry.profile.id)
        continue
      }
      if (
        presetRequests.current.has(entry.profile.id) ||
        failedPresetRequests.current.get(entry.profile.id)?.fingerprint === fingerprint
      )
        continue
      presetRequests.current.add(entry.profile.id)
      void readRuntime(
        entry.profile,
        '/api/agents/presets/apply',
        {
          presets,
          retired,
          modelPreferences,
          modelPreferencesUpdatedAt: globalModelPreferencesUpdatedAt,
        },
        responses.ok,
      )
        .then(() => {
          failedPresetRequests.current.delete(entry.profile.id)
          publishError()
          return refreshProfile(entry.profile)
        })
        .catch((error: unknown) => {
          if (
            current.current.profiles.some((profile) =>
              sameRuntimeConnection(profile.connection, entry.profile.connection),
            ) &&
            entryRef.current[entry.profile.id]?.connected
          )
            failedPresetRequests.current.set(entry.profile.id, {
              fingerprint,
              error: error instanceof Error ? error.message : String(error),
            })
          publishError()
        })
        .finally(() => presetRequests.current.delete(entry.profile.id))
    }
    publishError()
  }, [
    globalAgentPresets,
    retiredGlobalAgentPresets,
    globalModelPreferences,
    globalModelPreferencesUpdatedAt,
    overviews,
    readRuntime,
    refreshProfile,
  ])
  useEffect(() => {
    const publishError = () =>
      setSettingsSyncError(Array.from(failedSettingsRequests.current.values()).at(-1)?.error ?? '')
    for (const id of failedSettingsRequests.current.keys())
      if (!overviews.some((entry) => entry.profile.id === id))
        failedSettingsRequests.current.delete(id)
    const shared = mergeSharedSettings(
      sharedScopedSettings,
      ...overviews
        .filter((entry) => entry.connected)
        .map((entry) => entry.snapshot?.defaults?.scopedSettings?.shared ?? []),
    )
    if (JSON.stringify(shared) !== JSON.stringify(sharedScopedSettings))
      updateMobilePreferences({ sharedScopedSettings: shared })
    for (const entry of overviews) {
      if (!entry.connected || !entry.snapshot?.settingsScopesSupported) {
        // Older runtimes keep their settings until upgraded; never send unsupported writes.
        failedSettingsRequests.current.delete(entry.profile.id)
        continue
      }
      const pending = pendingSharedSettings(
        shared,
        entry.snapshot.defaults?.scopedSettings?.shared ?? [],
      )
      if (!pending.length) {
        failedSettingsRequests.current.delete(entry.profile.id)
        continue
      }
      const fingerprint = JSON.stringify(pending)
      if (
        settingsRequests.current.has(entry.profile.id) ||
        failedSettingsRequests.current.get(entry.profile.id)?.fingerprint === fingerprint
      )
        continue
      settingsRequests.current.add(entry.profile.id)
      void readRuntime(
        entry.profile,
        '/api/agents/settings/sync',
        { shared: pending },
        sharedSettingsSyncSchema,
      )
        .then((result) => {
          failedSettingsRequests.current.delete(entry.profile.id)
          publishError()
          updateMobilePreferences({
            sharedScopedSettings: mergeSharedSettings(
              readMobilePreferences().sharedScopedSettings,
              shared,
              result.shared,
            ),
          })
          return refreshProfile(entry.profile)
        })
        .catch((error: unknown) => {
          if (
            current.current.profiles.some((profile) =>
              sameRuntimeConnection(profile.connection, entry.profile.connection),
            ) &&
            entryRef.current[entry.profile.id]?.connected
          )
            failedSettingsRequests.current.set(entry.profile.id, {
              fingerprint,
              error: error instanceof Error ? error.message : String(error),
            })
          publishError()
        })
        .finally(() => settingsRequests.current.delete(entry.profile.id))
    }
    publishError()
  }, [sharedScopedSettings, overviews, readRuntime, refreshProfile])
  const pendingMessages = useCallback(
    (task: Task) => (connection ? mutations.pendingMessages(connection, task) : []),
    [connection, mutations],
  )
  const pendingMessagesFor = useCallback(
    (owner: RuntimeProfile, task: Task) => mutations.pendingMessages(owner.connection, task),
    [mutations],
  )
  const mutationStatus = useCallback(
    (owner: RuntimeProfile) => mutations.status(owner.connection),
    [mutations],
  )
  const retryMutations = useCallback(
    (owner: RuntimeProfile) => runClientEffect(mutations.recoverEffect(owner.connection, true)),
    [mutations],
  )
  const discardMutations = useCallback(
    (owner: RuntimeProfile) => runClientEffect(mutations.discardEffect(owner.connection)),
    [mutations],
  )
  const refreshAllOrRestore = useCallback(async () => {
    if (!registryWritable.current) {
      setRestoreAttempt((attempt) => attempt + 1)
      return
    }
    await refreshAll()
  }, [refreshAll])
  const readCache = useMemo(() => (profile ? cacheFor(profile) : null), [profile, cacheFor])
  const snapshot = overviews.find((entry) => entry.profile.id === profile?.id)?.snapshot ?? null
  const error =
    storageError ||
    settingsSyncError ||
    presetSyncError ||
    active?.error ||
    (registry.pendingPairings?.length
      ? 'A connection is waiting to finish pairing. Keep the computer online; recovery retries when you return to the app.'
      : '')
  const connected =
    (active?.connected ?? false) &&
    (!connection || !isPeerAddress(connection.address) || peerConnectionReady(connection.address))
  // Mutation status is read through stable functions; its version still publishes a new value.
  const value = useMemo<Runtime>(
    () => ({
      previewTaskEffect,
      connection,
      profile,
      profiles: registry.profiles,
      activeId: registry.activeId,
      overviews,
      snapshot,
      connected,
      ready,
      registryLoaded,
      recovering,
      error,
      legacyDraftRuntimeId,
      connect,
      cancelPairing,
      selectRuntime,
      forgetRuntime,
      renameRuntime,
      disconnect,
      refresh,
      refreshAll: refreshAllOrRestore,
      refreshRuntime: refreshProfile,
      call,
      callEffect,
      read,
      readEffect,
      readRuntime,
      readRuntimeEffect,
      refreshRuntimeEffect: refreshProfileEffect,
      pendingMessages,
      pendingMessagesFor,
      mutationStatus,
      retryMutations,
      discardMutations,
      cacheForRuntime: cacheFor,
      readCache,
      refreshEffect,
      syncAccountSession,
      connectEffect,
      selectRuntimeEffect,
      forgetRuntimeEffect,
      renameRuntimeEffect,
      upgradeInternetEffect,
      setPeerRelayEffect,
      disconnectEffect,
    }),
    [
      mutationVersion,
      previewTaskEffect,
      connection,
      profile,
      registry.profiles,
      registry.activeId,
      overviews,
      snapshot,
      connected,
      ready,
      registryLoaded,
      recovering,
      error,
      legacyDraftRuntimeId,
      connect,
      cancelPairing,
      selectRuntime,
      forgetRuntime,
      renameRuntime,
      disconnect,
      refresh,
      refreshAllOrRestore,
      refreshProfile,
      call,
      callEffect,
      read,
      readEffect,
      readRuntime,
      readRuntimeEffect,
      refreshProfileEffect,
      pendingMessages,
      pendingMessagesFor,
      mutationStatus,
      retryMutations,
      discardMutations,
      cacheFor,
      readCache,
      refreshEffect,
      syncAccountSession,
      connectEffect,
      selectRuntimeEffect,
      forgetRuntimeEffect,
      renameRuntimeEffect,
      upgradeInternetEffect,
      setPeerRelayEffect,
      disconnectEffect,
    ],
  )
  return <RuntimeValueProvider value={value}>{children}</RuntimeValueProvider>
}
export function useRuntime() {
  const runtime = useContext(Context)
  if (!runtime) throw new Error('RuntimeProvider required')
  return runtime
}
/**
 * Re-render only when the selected value changes. Keep `select` and `equals` stable, for
 * example at module scope or with useCallback, so the derived subscription is reused.
 */
export function useRuntimeSelector<A>(
  select: (runtime: Runtime) => A,
  equals: (previous: A, next: A) => boolean = Object.is,
): A {
  const atom = useContext(RuntimeStateContext)
  if (!atom) throw new Error('RuntimeProvider required')
  const selected = useMemo(
    () => Atom.withEquality(Atom.map(atom, select), equals),
    [atom, select, equals],
  )
  return useAtomValue(selected)
}
/** Compare selected records field by field, for action and identity slices. */
export function sameRuntimeFields<A extends object>(previous: A, next: A) {
  const keys = Object.keys(next) as (keyof A)[]
  return (
    Object.keys(previous).length === keys.length &&
    keys.every((key) => Object.is(previous[key], next[key]))
  )
}

/** Host-scoped controls never borrow the globally active computer's workspace or credentials. */
export function RuntimeScope({ runtimeId, children }: { runtimeId: string; children: ReactNode }) {
  const runtime = useRuntime()
  const entry = runtime.overviews.find((item) => item.profile.id === runtimeId)
  const profile = entry?.profile
  const { readRuntimeEffect, refreshRuntimeEffect } = runtime
  const readEffect = useCallback<CallEffect>(
    (path, input, schema, method) =>
      profile
        ? readRuntimeEffect(profile, path, input, schema, method)
        : Effect.fail(
            new ConnectionChangedError({
              message: 'This computer is no longer saved',
            }),
          ),
    [profile, readRuntimeEffect],
  )
  const read = useCallback<Call>((...args) => runClientEffect(readEffect(...args)), [readEffect])
  const refreshEffect = useCallback(
    () =>
      profile
        ? Effect.sync(() => retryRuntimeSync(profile.connection)).pipe(
            Effect.andThen(refreshRuntimeEffect(profile)),
          )
        : Effect.void,
    [profile, refreshRuntimeEffect],
  )
  const refresh = useCallback(() => runClientEffect(refreshEffect()), [refreshEffect])
  const callEffect = useCallback<CallEffect>(
    (path, input, schema, method) =>
      readEffect(path, input, schema, method).pipe(
        Effect.tap(() =>
          profile
            ? refreshRuntimeEffect(profile).pipe(Effect.catch(() => Effect.void))
            : Effect.void,
        ),
      ),
    [readEffect, profile, refreshRuntimeEffect],
  )
  const call = useCallback<Call>((...args) => runClientEffect(callEffect(...args)), [callEffect])
  const { pendingMessagesFor, cacheForRuntime } = runtime
  const pendingMessages = useCallback(
    (task: Task) => (profile ? pendingMessagesFor(profile, task) : []),
    [profile, pendingMessagesFor],
  )
  const readCache = useMemo(
    () => (profile ? cacheForRuntime(profile) : null),
    [profile, cacheForRuntime],
  )
  const value = useMemo<Runtime | null>(
    () =>
      entry
        ? {
            ...runtime,
            activeId: runtimeId,
            profile: entry.profile,
            connection: entry.profile.connection,
            snapshot: entry.snapshot,
            connected: entry.connected,
            error: entry.error ?? '',
            read,
            readEffect,
            call,
            callEffect,
            refresh,
            refreshEffect,
            pendingMessages,
            readCache,
          }
        : null,
    [
      runtime,
      runtimeId,
      entry,
      read,
      readEffect,
      call,
      callEffect,
      refresh,
      refreshEffect,
      pendingMessages,
      readCache,
    ],
  )
  if (!entry || !value) return null
  return (
    <RuntimeValueProvider key={clientScopeKey(entry.profile.connection)} value={value}>
      {children}
    </RuntimeValueProvider>
  )
}
