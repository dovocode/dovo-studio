import {
  optimisticTaskEffect,
  previewTasks,
  type OptimisticTask,
  type TaskPreview,
} from './optimistic-tasks'
import { nativeEffect, mobileWorkflow } from './native-effect'
import { useApplicationState } from './application-state'
import { decode } from '@dovo/protocol'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react'
import { AppState } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { Data, Effect, Schema } from 'effect'
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
import { registryKey, restoreRegistry } from './restore-registry'
const empty: RuntimeRegistry = {
  version: 1,
  activeId: null,
  profiles: [],
}
type Call = <T extends Schema.Schema.AnyNoContext>(
  path: string,
  input: unknown,
  schema: T,
  method?: string,
) => Promise<Schema.Schema.Type<T>>
type RuntimeRead = <T extends Schema.Schema.AnyNoContext>(
  profile: RuntimeProfile,
  path: string,
  input: unknown,
  schema: T,
  method?: string,
) => Promise<Schema.Schema.Type<T>>
class ConnectionChangedError extends Data.TaggedError('ConnectionChangedError')<{
  readonly message: string
}> {}
type CallEffect = <T extends Schema.Schema.AnyNoContext>(
  path: string,
  input: unknown,
  schema: T,
  method?: string,
) => Effect.Effect<Schema.Schema.Type<T>, Error>
type RuntimeReadEffect = <T extends Schema.Schema.AnyNoContext>(
  profile: RuntimeProfile,
  path: string,
  input: unknown,
  schema: T,
  method?: string,
) => Effect.Effect<Schema.Schema.Type<T>, Error>
type Runtime = {
  previewTaskEffect: <A, E>(
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
  error: string
  connectEffect: (
    value: RuntimeConnection,
    name?: string,
    proof?: PairingProof,
    replaceId?: string,
  ) => Effect.Effect<void, Error>
  selectRuntimeEffect: (id: string) => Effect.Effect<void, Error>
  forgetRuntimeEffect: (id: string) => Effect.Effect<void, Error>
  renameRuntimeEffect: (id: string, name: string) => Effect.Effect<void, Error>
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
  read: Call
  readRuntime: RuntimeRead
  cacheForRuntime: (profile: RuntimeProfile) => RuntimeReadCache
  readCache: RuntimeReadCache | null
}
const Context = createContext<Runtime | null>(null)
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
    [storageError, setStorageError] = useApplicationState(''),
    [legacyDraftRuntimeId, setLegacyDraftRuntimeId] = useApplicationState<string | null>(null)
  const [previews, setPreviews] = useApplicationState<OptimisticTask[]>([])
  const previewTaskEffect = useCallback(
    <A, E>(
      owner: RuntimeProfile,
      taskId: string,
      changes: TaskPreview,
      request: Effect.Effect<A, E>,
    ) =>
      optimisticTaskEffect(
        { id: Symbol(taskId), connection: owner.connection, taskId, changes },
        setPreviews,
        request,
      ),
    [],
  )
  const [storageLock] = useApplicationState(() => Effect.runSync(Effect.makeSemaphore(1)))
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
      if (!saved || saved.connection.token !== profile.connection.token) return
      const previous =
        entryRef.current[profile.id]?.profile.connection.token === profile.connection.token
          ? entryRef.current[profile.id]
          : initialOverview(profile)
      const entry = retainOverviewSnapshot(previous, {
        ...update(previous),
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
    [],
  )
  useEffect(() => {
    const persist = mobileWorkflow(function* () {
      if (!cacheDirty.current.size) return
      const ids = [...cacheDirty.current]
      cacheDirty.current.clear()
      yield* Effect.forEach(
        ids,
        (id) =>
          mobileWorkflow(function* () {
            const entry = entryRef.current[id]
            if (!entry?.snapshot || !current.current.profiles.some((item) => item.id === id)) return
            const cache = cacheFor(entry.profile)
            yield* cache.writeEffect('snapshot', {
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
          }),
        {
          concurrency: 3,
          discard: true,
        },
      ).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            for (const id of ids) cacheDirty.current.add(id)
            setStorageError(`Could not save the offline cache. ${error.message}`)
          }),
        ),
      )
    }).pipe(Effect.uninterruptible)
    const polling = startPolling(persist, {
      interval: 5000,
      immediate: false,
      onError: () => {},
    })
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') polling.refresh()
    })
    return () => {
      subscription.remove()
      void runClientEffect(nativeEffect(() => polling.stop()).pipe(Effect.flatMap(() => persist)))
    }
  }, [cacheFor])
  const persistRegistryEffect = useCallback(
    (next: RuntimeRegistry) =>
      Effect.tryPromise({
        try: () =>
          SecureStore.setItemAsync(registryKey, JSON.stringify(next), {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          }),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
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
        const version = (sequence.current.get(profile.id) ?? 0) + 1
        sequence.current.set(profile.id, version)
        return runtimeRequestEffect(
          profile.connection,
          profile.connection.address,
          '/api/snapshot',
          undefined,
          snapshotSchema,
          'GET',
          10000,
        ).pipe(
          Effect.tap((snapshot) =>
            Effect.sync(() => {
              if (sequence.current.get(profile.id) === version)
                updateEntry(profile, (previous) => ({
                  ...previous,
                  snapshot,
                  connected: true,
                  lastSeen: new Date().toISOString(),
                  error: null,
                }))
            }),
          ),
          Effect.tapError((error) =>
            Effect.sync(() => {
              if (sequence.current.get(profile.id) === version)
                updateEntry(profile, (previous) => ({
                  ...previous,
                  connected: false,
                  error: error.message,
                }))
            }),
          ),
          Effect.asVoid,
        )
      }),
    [updateEntry],
  )
  const refreshProfile = useCallback(
    (profile: RuntimeProfile) => runClientEffect(refreshProfileEffect(profile)),
    [refreshProfileEffect],
  )
  const refreshOverviewEffect = useCallback(
    (profile: RuntimeProfile): Effect.Effect<void> =>
      Effect.suspend(() => {
        const pending = fleetPending.current.get(profile.id)
        if (pending?.token === profile.connection.token) return pending.effect
        const version = (sequence.current.get(profile.id) ?? 0) + 1
        sequence.current.set(profile.id, version)
        const shared = Effect.runSync(
          Effect.cached(
            loadRuntimeOverviewEffect(profile, entryRef.current[profile.id], (next) => {
              if (sequence.current.get(profile.id) === version) updateEntry(profile, () => next)
            }).pipe(
              Effect.tap((next) =>
                Effect.sync(() =>
                  updateEntry(profile, (previous) =>
                    sequence.current.get(profile.id) === version
                      ? next
                      : {
                          ...previous,
                          pulls: next.pulls,
                          pullError: next.pullError,
                        },
                  ),
                ),
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
    () =>
      Effect.suspend(() =>
        Effect.forEach(current.current.profiles, refreshOverviewEffect, {
          concurrency: 3,
          discard: true,
        }),
      ),
    [refreshOverviewEffect],
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
      if (profile) yield* refreshProfileEffect(profile)
    })
  }, [profile, refreshProfileEffect])
  const connectEffect = useCallback(
    (value: RuntimeConnection, name?: string, proof?: PairingProof, replaceId?: string) => {
      return mobileWorkflow(function* () {
        const previous = current.current.profiles.find((item) => item.id === replaceId)
        if (replaceId && (!previous || !proof))
          return yield* Effect.fail(
            new Error('Select a saved computer and pair its new address before replacing it.'),
          )
        const next = {
          ...runtimeProfile(value, name || previous?.name),
          ...(previous ? { id: previous.id } : {}),
        }
        yield* refreshProfileEffect(next)
        if (proof)
          yield* storageLock.withPermits(1)(
            Effect.suspend(() =>
              saveRuntimePairing(current.current, { profile: next, proof }, persistRegistryEffect),
            ),
          )
        else yield* changeRegistryEffect((saved) => upsertRuntime(saved, next))
        yield* refreshOverviewEffect(next)
      })
    },
    [
      changeRegistryEffect,
      refreshProfileEffect,
      refreshOverviewEffect,
      storageLock,
      persistRegistryEffect,
    ],
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
      })
    },
    [changeRegistryEffect, cacheFor],
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
        return runtimeRequestEffect(
          profile.connection,
          profile.connection.address,
          path,
          input,
          schema,
          method,
        ).pipe(
          Effect.flatMap((result) => (valid() ? Effect.succeed(result) : Effect.fail(changed()))),
        )
      }),
    [profile],
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
        return runtimeRequestEffect(
          owner.connection,
          owner.connection.address,
          path,
          input,
          schema,
          method,
        ).pipe(
          Effect.flatMap((result) => (valid() ? Effect.succeed(result) : Effect.fail(changed()))),
        )
      }),
    [],
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
            ? refreshProfileEffect(profile).pipe(Effect.catchAll(() => Effect.void))
            : Effect.void,
        ),
      ),
    [readEffect, profile, refreshProfileEffect],
  )
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
      setRegistry(saved)
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
            Effect.catchAll((error) =>
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
      Effect.catchAll((error) =>
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
  }, [cacheFor, updateEntry, persistRegistryEffect])
  useEffect(() => {
    if (!ready) return
    const commands = clientTaskScope()
    const recover = storageLock
      .withPermits(1)(
        Effect.suspend(() => recoverRuntimePairings(current.current, persistRegistryEffect)),
      )
      .pipe(
        Effect.asVoid,
        Effect.catchAll((error) => Effect.sync(() => setStorageError(error.message))),
      )
    void commands.run(recover)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void commands.run(recover)
    })
    return () => {
      subscription.remove()
      void commands.stop()
    }
  }, [ready, storageLock, persistRegistryEffect])
  useEffect(() => {
    if (!ready || !profile) return
    const polling = startPolling(
      Effect.suspend(() =>
        AppState.currentState === 'active' ? refreshProfileEffect(profile) : Effect.void,
      ),
      {
        interval: 1000,
        // An unreachable host is not hammered every second; foregrounding still retries at once.
        backoff: 10000,
        onError: (error) =>
          updateEntry(profile, (previous) => ({
            ...previous,
            connected: false,
            error: error.message,
          })),
      },
    )
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') polling.refresh()
    })
    return () => {
      void polling.stop()
      subscription.remove()
    }
  }, [ready, profile, refreshProfileEffect, updateEntry])
  useEffect(() => {
    if (!ready) return
    const polling = startPolling(
      Effect.suspend(() => (AppState.currentState === 'active' ? refreshAllEffect() : Effect.void)),
      {
        interval: 30000,
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
  }, [ready, registry.profiles, refreshAllEffect])
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
  const overviews = useMemo(
    () =>
      registry.profiles.map((item) =>
        previewTasks(
          {
            ...(entries[item.id]?.profile.connection.token === item.connection.token
              ? entries[item.id]
              : initialOverview(item)),
            profile: item,
          },
          previews,
        ),
      ),
    [registry.profiles, entries, previews],
  )
  return (
    <Context.Provider
      value={{
        previewTaskEffect,
        connection,
        profile,
        profiles: registry.profiles,
        activeId: registry.activeId,
        overviews,
        snapshot: overviews.find((entry) => entry.profile.id === profile?.id)?.snapshot ?? null,
        connected: active?.connected ?? false,
        ready,
        error:
          storageError ||
          active?.error ||
          (registry.pendingPairings?.length
            ? 'A connection is waiting to finish pairing. Keep the computer online; recovery retries when you return to the app.'
            : ''),
        legacyDraftRuntimeId,
        connect,
        cancelPairing,
        selectRuntime,
        forgetRuntime,
        renameRuntime,
        disconnect,
        refresh,
        refreshAll,
        refreshRuntime: refreshProfile,
        call,
        callEffect,
        read,
        readEffect,
        readRuntime,
        readRuntimeEffect,
        refreshRuntimeEffect: refreshProfileEffect,
        cacheForRuntime: cacheFor,
        readCache: profile ? cacheFor(profile) : null,
        refreshEffect,
        connectEffect,
        selectRuntimeEffect,
        forgetRuntimeEffect,
        renameRuntimeEffect,
        disconnectEffect,
      }}
    >
      {children}
    </Context.Provider>
  )
}
export function useRuntime() {
  const runtime = useContext(Context)
  if (!runtime) throw new Error('RuntimeProvider required')
  return runtime
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
    () => (profile ? refreshRuntimeEffect(profile) : Effect.void),
    [profile, refreshRuntimeEffect],
  )
  const refresh = useCallback(() => runClientEffect(refreshEffect()), [refreshEffect])
  const callEffect = useCallback<CallEffect>(
    (path, input, schema, method) =>
      readEffect(path, input, schema, method).pipe(
        Effect.tap(() =>
          profile
            ? refreshRuntimeEffect(profile).pipe(Effect.catchAll(() => Effect.void))
            : Effect.void,
        ),
      ),
    [readEffect, profile, refreshRuntimeEffect],
  )
  const call = useCallback<Call>((...args) => runClientEffect(callEffect(...args)), [callEffect])
  if (!entry) return null
  return (
    <Context.Provider
      key={clientScopeKey(entry.profile.connection)}
      value={{
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
        readCache: runtime.cacheForRuntime(entry.profile),
      }}
    >
      {children}
    </Context.Provider>
  )
}
