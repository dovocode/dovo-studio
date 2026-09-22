import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { AppState } from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { z } from 'zod'
import {
  connectionSchema,
  snapshotSchema,
  runtimeSnapshotCacheSchema,
  runtimeRequest,
  clearRuntimeRequestCache,
  getRuntimeSnapshotTag,
  runtimeRegistrySchema,
  runtimeProfile,
  upsertRuntime,
  removeRuntime,
  loadRuntimeOverview,
  type RuntimeConnection,
  type RuntimeSnapshot,
  type RuntimeRegistry,
  type RuntimeProfile,
  type RuntimeOverview,
  type RuntimeReadCache,
} from '@dovo/protocol'
import { mobileReadCache } from './read-cache'
import { clientScopeKey } from '@dovo/client-runtime'
import { retainOverviewSnapshot, shouldPublishOverview } from './overview-state'

const registryKey = 'dovo.runtime.registry'
const legacyKey = 'dovo.runtime.connection'
const legacyDraftKey = 'dovo.runtime.legacy-drafts'
const empty: RuntimeRegistry = { version: 1, activeId: null, profiles: [] }
type Call = <T extends z.ZodType>(
  path: string,
  input: unknown,
  schema: T,
  method?: string,
) => Promise<z.output<T>>
type RuntimeRead = <T extends z.ZodType>(
  profile: RuntimeProfile,
  path: string,
  input: unknown,
  schema: T,
  method?: string,
) => Promise<z.output<T>>
type Runtime = {
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
  connect: (value: RuntimeConnection, name?: string) => Promise<void>
  selectRuntime: (id: string) => Promise<void>
  forgetRuntime: (id: string) => Promise<void>
  renameRuntime: (id: string, name: string) => Promise<void>
  disconnect: () => Promise<void>
  refresh: () => Promise<void>
  refreshAll: () => Promise<void>
  refreshRuntime: (profile: RuntimeProfile) => Promise<void>
  call: Call
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
  const [registry, setRegistry] = useState<RuntimeRegistry>(empty),
    current = useRef(registry),
    [entries, setEntries] = useState<Record<string, RuntimeOverview>>({}),
    entryRef = useRef(entries),
    [ready, setReady] = useState(false),
    [storageError, setStorageError] = useState(''),
    [legacyDraftRuntimeId, setLegacyDraftRuntimeId] = useState<string | null>(null)
  const storageWrite = useRef<Promise<unknown>>(Promise.resolve())
  const sequence = useRef(new Map<string, number>())
  const fleetPending = useRef(new Map<string, { token: string; promise: Promise<void> }>())
  const caches = useRef(new Map<string, { token: string; cache: RuntimeReadCache }>())
  const cacheDirty = useRef(new Set<string>())
  const cacheMarks = useRef(
    new Map<string, { token: string; tag: string | undefined; pulls: string; writtenAt: number }>(),
  )
  const cacheFor = useCallback((profile: RuntimeProfile) => {
    let entry = caches.current.get(profile.id)
    if (!entry || entry.token !== profile.connection.token) {
      if (entry) {
        clearRuntimeRequestCache({ address: profile.connection.address, token: entry.token })
        void entry.cache.close()
      }
      entry = { token: profile.connection.token, cache: mobileReadCache(profile.connection) }
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
      const entry = retainOverviewSnapshot(previous, { ...update(previous), profile: saved })
      // Keep the exact latest contact time for offline transitions and persistence.
      entryRef.current = { ...entryRef.current, [profile.id]: entry }
      setEntries((published) =>
        shouldPublishOverview(published[profile.id], entry)
          ? { ...published, [profile.id]: entry }
          : published,
      )
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
    let writing = false
    const persist = async () => {
      if (writing || !cacheDirty.current.size) return
      writing = true
      const ids = [...cacheDirty.current]
      cacheDirty.current.clear()
      try {
        await Promise.all(
          ids.map(async (id) => {
            const entry = entryRef.current[id]
            if (entry?.snapshot && current.current.profiles.some((item) => item.id === id)) {
              const cache = cacheFor(entry.profile)
              await cache.write('snapshot', {
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
            }
          }),
        )
      } catch (error) {
        for (const id of ids) cacheDirty.current.add(id)
        setStorageError(
          `Could not save the offline cache. ${error instanceof Error ? error.message : String(error)}`,
        )
      } finally {
        writing = false
      }
    }
    const timer = setInterval(() => void persist(), 5000)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void persist()
    })
    return () => {
      clearInterval(timer)
      subscription.remove()
      void persist()
    }
  }, [cacheFor])
  const changeRegistry = useCallback((change: (value: RuntimeRegistry) => RuntimeRegistry) => {
    const result = storageWrite.current.then(async () => {
      const next = runtimeRegistrySchema.parse(change(current.current))
      await SecureStore.setItemAsync(registryKey, JSON.stringify(next), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      })
      current.current = next
      setRegistry(next)
      setStorageError('')
    })
    storageWrite.current = result.catch((error) => setStorageError(String(error)))
    return result
  }, [])
  const refreshProfile = useCallback(
    async (profile: RuntimeProfile) => {
      const version = (sequence.current.get(profile.id) ?? 0) + 1
      sequence.current.set(profile.id, version)
      try {
        const snapshot = await runtimeRequest(
          profile.connection,
          profile.connection.address,
          '/api/snapshot',
          undefined,
          snapshotSchema,
          'GET',
          10000,
        )
        if (sequence.current.get(profile.id) === version)
          updateEntry(profile, (previous) => ({
            ...previous,
            snapshot,
            connected: true,
            lastSeen: new Date().toISOString(),
            error: null,
          }))
      } catch (error) {
        if (sequence.current.get(profile.id) === version)
          updateEntry(profile, (previous) => ({
            ...previous,
            connected: false,
            error: error instanceof Error ? error.message : String(error),
          }))
        throw error
      }
    },
    [updateEntry],
  )
  const refreshOverview = useCallback(
    (profile: RuntimeProfile) => {
      const pending = fleetPending.current.get(profile.id)
      if (pending?.token === profile.connection.token) return pending.promise
      const version = (sequence.current.get(profile.id) ?? 0) + 1
      sequence.current.set(profile.id, version)
      const promise = loadRuntimeOverview(profile, entryRef.current[profile.id], (next) => {
        if (sequence.current.get(profile.id) === version) updateEntry(profile, () => next)
      })
        .then((next) => {
          updateEntry(profile, (previous) =>
            sequence.current.get(profile.id) === version
              ? next
              : { ...previous, pulls: next.pulls, pullError: next.pullError },
          )
        })
        .finally(() => {
          if (fleetPending.current.get(profile.id)?.promise === promise)
            fleetPending.current.delete(profile.id)
        })
      fleetPending.current.set(profile.id, { token: profile.connection.token, promise })
      return promise
    },
    [updateEntry],
  )
  const refreshAll = useCallback(async () => {
    await Promise.all(current.current.profiles.map(refreshOverview))
  }, [refreshOverview])
  const profile = registry.profiles.find((item) => item.id === registry.activeId) ?? null
  const connection = profile?.connection ?? null
  const active =
    profile && entries[profile.id]?.profile.connection.token === profile.connection.token
      ? entries[profile.id]
      : undefined
  const refresh = useCallback(async () => {
    if (profile) await refreshProfile(profile)
  }, [profile, refreshProfile])
  const connect = useCallback(
    async (value: RuntimeConnection, name?: string) => {
      const next = runtimeProfile(value, name)
      await changeRegistry((saved) => upsertRuntime(saved, next))
      await refreshProfile(next).catch(() => undefined)
      void refreshOverview(next)
    },
    [changeRegistry, refreshProfile, refreshOverview],
  )
  const selectRuntime = useCallback(
    async (id: string) => {
      await changeRegistry((saved) => {
        if (!saved.profiles.some((item) => item.id === id))
          throw new Error('This computer is no longer saved')
        return { ...saved, activeId: id }
      })
    },
    [changeRegistry],
  )
  const forgetRuntime = useCallback(
    async (id: string) => {
      const profile = current.current.profiles.find((item) => item.id === id)
      if (profile) clearRuntimeRequestCache(profile.connection)
      await changeRegistry((saved) => removeRuntime(saved, id))
      const next = { ...entryRef.current }
      delete next[id]
      entryRef.current = next
      setEntries(next)
      if (profile) await cacheFor(profile).clear()
      caches.current.delete(id)
      cacheDirty.current.delete(id)
      cacheMarks.current.delete(id)
    },
    [changeRegistry, cacheFor],
  )
  const renameRuntime = useCallback(
    async (id: string, name: string) => {
      if (!name.trim()) throw new Error('Enter a computer name')
      await changeRegistry((saved) => ({
        ...saved,
        profiles: saved.profiles.map((item) =>
          item.id === id ? { ...item, name: name.trim() } : item,
        ),
      }))
    },
    [changeRegistry],
  )
  const disconnect = useCallback(async () => {
    const active = current.current.profiles.find((item) => item.id === current.current.activeId)
    if (active) clearRuntimeRequestCache(active.connection)
    await changeRegistry((saved) => ({ ...saved, activeId: null }))
  }, [changeRegistry])
  // Bind every caller to the selected host. An async action can never continue on a new host.
  const read = useCallback<Call>(
    async (path, input, schema, method) => {
      if (!profile) throw new Error('Connect a computer first')
      const saved = current.current.profiles.find((item) => item.id === profile.id)
      if (
        current.current.activeId !== profile.id ||
        saved?.connection.token !== profile.connection.token
      )
        throw new Error('The selected computer changed. Try the action again.')
      return runtimeRequest(
        profile.connection,
        profile.connection.address,
        path,
        input,
        schema,
        method,
      )
    },
    [profile],
  )
  // Collections span computers without changing the target of an open editor or action.
  const readRuntime = useCallback<RuntimeRead>(async (owner, path, input, schema, method) => {
    const assertOwner = () => {
      const saved = current.current.profiles.find((item) => item.id === owner.id)
      if (!saved || clientScopeKey(saved.connection) !== clientScopeKey(owner.connection))
        throw new Error('This computer connection changed. Refresh the collection.')
    }
    assertOwner()
    const result = await runtimeRequest(
      owner.connection,
      owner.connection.address,
      path,
      input,
      schema,
      method,
    )
    assertOwner()
    return result
  }, [])
  const call = useCallback<Call>(
    async (path, input, schema, method) => {
      const result = await read(path, input, schema, method)
      await refresh().catch(() => undefined)
      return result
    },
    [read, refresh],
  )
  useEffect(() => {
    let disposed = false
    const restore = async () => {
      const [stored, legacy, draftRuntime] = await Promise.all([
        SecureStore.getItemAsync(registryKey),
        SecureStore.getItemAsync(legacyKey),
        SecureStore.getItemAsync(legacyDraftKey),
      ])
      let saved = stored ? runtimeRegistrySchema.parse(JSON.parse(stored)) : empty
      if (!stored && legacy) {
        const migrated = runtimeProfile(connectionSchema.parse(JSON.parse(legacy)))
        saved = upsertRuntime(empty, migrated)
        await SecureStore.setItemAsync(registryKey, JSON.stringify(saved), {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        })
        await SecureStore.setItemAsync(legacyDraftKey, migrated.id, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        })
        if (!disposed) setLegacyDraftRuntimeId(migrated.id)
      } else if (!disposed) setLegacyDraftRuntimeId(draftRuntime)
      if (legacy) await SecureStore.deleteItemAsync(legacyKey)
      if (disposed) return
      current.current = saved
      setRegistry(saved)
      await Promise.all(
        saved.profiles.map(async (profile) => {
          try {
            const cached = await cacheFor(profile).read('snapshot', runtimeSnapshotCacheSchema)
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
              pulls: cached.value.pulls ? { ...cached.value.pulls, partial: true } : null,
              connected: false,
            }))
          } catch (error) {
            if (!disposed)
              setStorageError(
                `Could not load the offline cache. ${error instanceof Error ? error.message : String(error)}`,
              )
          }
        }),
      )
    }
    void restore()
      .catch((error) => {
        if (!disposed) setStorageError(String(error))
      })
      .finally(() => {
        if (!disposed) setReady(true)
      })
    return () => {
      disposed = true
    }
  }, [cacheFor, updateEntry])
  useEffect(() => {
    if (!ready || !profile) return
    let busy = false
    const poll = () => {
      if (busy || AppState.currentState !== 'active') return
      busy = true
      void refresh()
        .catch(() => undefined)
        .finally(() => {
          busy = false
        })
    }
    const timer = setInterval(poll, 1000)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') poll()
    })
    poll()
    return () => {
      clearInterval(timer)
      subscription.remove()
    }
  }, [ready, profile, refresh])
  useEffect(() => {
    if (!ready) return
    const poll = () => {
      if (AppState.currentState === 'active') void refreshAll()
    }
    const timer = setInterval(poll, 30000)
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') poll()
    })
    poll()
    return () => {
      clearInterval(timer)
      subscription.remove()
    }
  }, [ready, registry.profiles, refreshAll])
  return (
    <Context.Provider
      value={{
        connection,
        profile,
        profiles: registry.profiles,
        activeId: registry.activeId,
        overviews: registry.profiles.map((item) => ({
          ...(entries[item.id]?.profile.connection.token === item.connection.token
            ? entries[item.id]
            : initialOverview(item)),
          profile: item,
        })),
        snapshot: active?.snapshot ?? null,
        connected: active?.connected ?? false,
        ready,
        error: storageError || active?.error || '',
        legacyDraftRuntimeId,
        connect,
        selectRuntime,
        forgetRuntime,
        renameRuntime,
        disconnect,
        refresh,
        refreshAll,
        refreshRuntime: refreshProfile,
        call,
        read,
        readRuntime,
        cacheForRuntime: cacheFor,
        readCache: profile ? cacheFor(profile) : null,
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
  const { readRuntime, refreshRuntime } = runtime
  const read = useCallback<Call>(
    async (path, input, schema, method) => {
      if (!profile) throw new Error('This computer is no longer saved')
      return readRuntime(profile, path, input, schema, method)
    },
    [profile, readRuntime],
  )
  const refresh = useCallback(async () => {
    if (profile) await refreshRuntime(profile)
  }, [profile, refreshRuntime])
  const call = useCallback<Call>(
    async (path, input, schema, method) => {
      const result = await read(path, input, schema, method)
      await refresh().catch(() => undefined)
      return result
    },
    [read, refresh],
  )
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
        call,
        refresh,
        readCache: runtime.cacheForRuntime(entry.profile),
      }}
    >
      {children}
    </Context.Provider>
  )
}
