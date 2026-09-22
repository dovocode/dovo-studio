import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { z } from 'zod'
import {
  connectionSchema,
  snapshotSchema,
  runtimeSnapshotCacheSchema,
  responses,
  runtimeProfile,
  upsertRuntime,
  removeRuntime,
  loadRuntimeOverview,
  clearRuntimeRequestCache,
  getRuntimeSnapshotTag,
  type RuntimeConnection,
  type RuntimeSnapshot,
  type RuntimeProfile,
  type RuntimeRegistry,
  type RuntimeOverview,
  type RuntimeReadCache,
} from '@dovo/protocol'
import { createWorkspace } from './seed'
import { decodeWorkspace, encodeWorkspace, storageKey } from './persistence'
import { emptyRegistry, readRuntimeRegistry, writeRuntimeRegistry } from './runtime-registry'
import type { Workspace } from './schema'
import { runtimeRequest } from '../runtime/client'
import { WorkspaceSynchronization, type WorkspaceOutbox } from '../runtime/synchronization'
import { workspacePatches } from '../runtime/patches'
import {
  browserReadCache,
  readWorkspaceDocument,
  writeWorkspaceDocument,
  readWorkspaceOutbox,
  writeWorkspaceOutbox,
} from './read-cache'
const snapshotKey = 'dovo.runtime-snapshots.v1'
type Request = <T extends z.ZodType>(
  path: string,
  input: unknown,
  schema: T,
  method?: 'GET' | 'POST' | 'PATCH',
) => Promise<z.output<T>>
type Store = {
  workspace: Workspace
  setWorkspace: Dispatch<SetStateAction<Workspace>>
  ready: boolean
  storageError: string | null
  connection: RuntimeConnection | null
  snapshot: RuntimeSnapshot | null
  connected: boolean
  syncError: string | null
  connect: (connection: RuntimeConnection) => Promise<void>
  disconnect: () => Promise<void>
  request: Request
  flush: () => Promise<void>
  runtimeRegistry: RuntimeRegistry
  activeRuntimeId: string | null
  runtimes: RuntimeOverview[]
  switchRuntime: (id: string) => Promise<void>
  forgetRuntime: (id: string) => Promise<void>
  refreshRuntimes: () => Promise<void>
  refreshRuntime: (profile: RuntimeProfile) => Promise<void>
  retrySync: () => Promise<void>
  discardAndReload: () => Promise<void>
  pendingSync: boolean
  readCache: RuntimeReadCache | null
  readRuntime: <T extends z.ZodType>(
    profile: RuntimeProfile,
    path: string,
    input: unknown,
    schema: T,
    method?: 'GET' | 'POST' | 'PATCH',
  ) => Promise<z.output<T>>
  runtimeReadCache: (profile: RuntimeProfile) => RuntimeReadCache
}
const WorkspaceContext = createContext<Store | null>(null)
const idleOverview = (
  profile: RuntimeProfile,
  snapshot: RuntimeSnapshot | null = null,
): RuntimeOverview => ({
  profile,
  snapshot,
  connected: false,
  lastSeen: null,
  error: null,
  pulls: null,
  pullError: null,
})
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspace, setState] = useState(createWorkspace),
    current = useRef(workspace)
  const [ready, setReady] = useState(false),
    [storageError, setStorageError] = useState<string | null>(null),
    writable = useRef(true)
  const [connection, setConnection] = useState<RuntimeConnection | null>(null),
    connectionRef = useRef(connection)
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null),
    [connected, setConnected] = useState(false),
    [syncError, setSyncError] = useState<string | null>(null)
  const [runtimeRegistry, setRegistry] = useState(emptyRegistry),
    registryRef = useRef(runtimeRegistry)
  const [overviews, setOverviews] = useState<Record<string, RuntimeOverview>>({}),
    overviewsRef = useRef(overviews)
  const cacheDirty = useRef(false)
  const cacheWrites = useRef(
    new Map<string, { token: string; tag: string | undefined; pulls: string; writtenAt: number }>(),
  )
  const installedSnapshot = useRef<{ address: string; token: string; tag: string } | null>(null)
  const caches = useRef(new Map<string, { token: string; cache: RuntimeReadCache }>())
  const cacheFor = useCallback((profile: RuntimeProfile) => {
    let entry = caches.current.get(profile.id)
    if (!entry || entry.token !== profile.connection.token) {
      cacheWrites.current.delete(profile.id)
      if (entry)
        clearRuntimeRequestCache({ address: profile.connection.address, token: entry.token })
      if (entry) void entry.cache.close()
      entry = { token: profile.connection.token, cache: browserReadCache(profile.connection) }
      caches.current.set(profile.id, entry)
    }
    return entry.cache
  }, [])
  const assertProfile = useCallback((profile: RuntimeProfile) => {
    if (
      !registryRef.current.profiles.some(
        (current) =>
          current.id === profile.id &&
          current.connection.token === profile.connection.token &&
          current.connection.address === profile.connection.address,
      )
    )
      throw new Error('This device connection changed. Reopen the item to continue.')
  }, [])
  const busyHosts = useRef(new Set<string>())
  const busySnapshots = useRef(new Set<string>())
  const snapshotOrder = useRef(new Map<string, number>())
  const bootstrapped = useRef(false),
    connecting = useRef(0),
    saving = useRef(Promise.resolve())
  const [synchronization] = useState(
    () => new WorkspaceSynchronization(setSyncError, undefined, writeWorkspaceOutbox),
  )
  const install = useCallback((value: Workspace) => {
    installedSnapshot.current = null
    const next = { ...value, tasks: value.tasks.filter((task) => !task.example) }
    current.current = next
    setState(next)
  }, [])
  const installSnapshot = useCallback(
    (target: RuntimeConnection, value: RuntimeSnapshot) => {
      const tag = getRuntimeSnapshotTag(value)
      const previous = installedSnapshot.current
      if (
        tag &&
        previous &&
        previous.tag === tag &&
        previous.address === target.address &&
        previous.token === target.token
      )
        return
      install(value.workspace)
      if (tag) installedSnapshot.current = { address: target.address, token: target.token, tag }
    },
    [install],
  )
  const saveRegistry = useCallback((value: RuntimeRegistry) => {
    registryRef.current = value
    setRegistry(value)
    saving.current = saving.current
      .then(() => writeRuntimeRegistry(value))
      .catch((error) => {
        setStorageError(
          `Could not save runtime connections. ${error instanceof Error ? error.message : String(error)}`,
        )
      })
  }, [])
  const updateOverview = useCallback((value: RuntimeOverview) => {
    const profile = registryRef.current.profiles.find(
      (entry) =>
        entry.id === value.profile.id && entry.connection.token === value.profile.connection.token,
    )
    if (!profile) return
    const next = { ...overviewsRef.current, [value.profile.id]: value }
    overviewsRef.current = next
    setOverviews(next)
    if (value.connected && value.snapshot) cacheDirty.current = true
  }, [])
  useEffect(() => {
    let writing = false
    const persistCache = async () => {
      if (writing || !cacheDirty.current) return
      writing = true
      cacheDirty.current = false
      try {
        await Promise.all(
          Object.values(overviewsRef.current)
            .filter(
              (entry) =>
                entry.snapshot &&
                entry.connected &&
                registryRef.current.profiles.some(
                  (profile) =>
                    profile.id === entry.profile.id &&
                    profile.connection.token === entry.profile.connection.token,
                ),
            )
            .map(async (entry) => {
              if (!entry.snapshot) return
              const tag = getRuntimeSnapshotTag(entry.snapshot)
              const pulls = JSON.stringify(entry.pulls)
              const previous = cacheWrites.current.get(entry.profile.id)
              const now = Date.now()
              if (
                tag &&
                previous &&
                previous.tag === tag &&
                previous.token === entry.profile.connection.token &&
                previous.pulls === pulls &&
                now - previous.writtenAt < 60000
              )
                return
              await cacheFor(entry.profile).write('snapshot', {
                snapshot: entry.snapshot,
                lastSeen: entry.lastSeen,
                pulls: entry.pulls,
              })
              if (
                registryRef.current.profiles.some(
                  (profile) =>
                    profile.id === entry.profile.id &&
                    profile.connection.token === entry.profile.connection.token,
                )
              )
                cacheWrites.current.set(entry.profile.id, {
                  token: entry.profile.connection.token,
                  tag,
                  pulls,
                  writtenAt: now,
                })
            }),
        )
      } catch {
        cacheDirty.current = true
        setStorageError('Could not cache device workspaces. Keep this window open.')
      } finally {
        writing = false
      }
    }
    const flushCache = () => {
      void persistCache()
    }
    const timer = setInterval(flushCache, 5000)
    window.addEventListener('pagehide', flushCache)
    return () => {
      clearInterval(timer)
      window.removeEventListener('pagehide', flushCache)
      void persistCache()
    }
  }, [cacheFor])
  const flush = useCallback(() => synchronization.flush(), [synchronization])
  const setWorkspace = useCallback<Dispatch<SetStateAction<Workspace>>>(
    (update) => {
      if (connection !== connectionRef.current)
        throw new Error('Runtime connection changed. Reopen this view before editing.')
      const before = current.current,
        next = typeof update === 'function' ? update(before) : update
      install(next)
      if (connectionRef.current) {
        synchronization.enqueue(workspacePatches(before, next), next)
        void flush().catch(() => {
          /* The error stays visible and unsent edits remain queued. */
        })
      }
    },
    [connection, flush, install, synchronization],
  )
  const adopt = useCallback(
    (
      profile: RuntimeProfile,
      value: RuntimeSnapshot | null,
      online: boolean,
      outbox: WorkspaceOutbox | null = null,
    ) => {
      synchronization.bind(profile.connection, outbox)
      connectionRef.current = profile.connection
      setConnection(profile.connection)
      setSnapshot(value)
      if (outbox) install(outbox.workspace)
      else if (value) installSnapshot(profile.connection, value)
      else
        install({
          ...createWorkspace(),
          repositories: [],
          agents: [],
          tasks: [],
          automations: [],
        })
      setConnected(online)
      setSyncError(
        outbox
          ? 'Saved edits are waiting to sync. Retry sync, or reload the host workspace from Devices & runtime.'
          : online
            ? null
            : 'This runtime is offline. Showing its last saved workspace.',
      )
      saveRegistry(upsertRuntime(registryRef.current, profile))
    },
    [install, installSnapshot, saveRegistry, synchronization],
  )
  const openProfile = useCallback(
    async (profile: RuntimeProfile) => {
      const attempt = ++connecting.current
      // A failed replacement must keep the currently authenticated profile intact.
      // New hosts can still be remembered while offline for a later reconnect.
      const saved = registryRef.current.profiles.find((entry) => entry.id === profile.id)
      if (!saved || saved.connection.token === profile.connection.token)
        saveRegistry(upsertRuntime(registryRef.current, profile, false))
      await flush()
      const checkpoint = synchronization.checkpoint()
      const outbox = await readWorkspaceOutbox(profile.connection)
      const value = await runtimeRequest(
        profile.connection,
        profile.connection.address,
        '/api/snapshot',
        undefined,
        snapshotSchema,
        'GET',
      )
      if (attempt !== connecting.current) throw new Error('Another runtime connection was selected')
      if (!synchronization.accepts(checkpoint))
        throw new Error(
          'The workspace changed while connecting. Wait for changes to sync, then try again.',
        )
      await writeWorkspaceDocument(
        `${storageKey}.before-connection`,
        encodeWorkspace(current.current),
      )
      if (attempt !== connecting.current || !synchronization.accepts(checkpoint))
        throw new Error('The workspace changed while connecting. Try again after it syncs.')
      const named = { ...profile, name: value.runtimeHost || profile.name }
      const previous = overviewsRef.current[profile.id]
      adopt(named, value, true, outbox)
      updateOverview({
        ...(previous?.profile.connection.token === profile.connection.token
          ? previous
          : idleOverview(named)),
        profile: named,
        snapshot: value,
        connected: true,
        lastSeen: new Date().toISOString(),
        error: null,
      })
    },
    [adopt, flush, saveRegistry, synchronization, updateOverview],
  )
  const connect = useCallback(
    async (value: RuntimeConnection) => {
      const next = connectionSchema.parse({ ...value, address: new URL(value.address).origin })
      await openProfile(runtimeProfile(next))
    },
    [openProfile],
  )
  const switchRuntime = useCallback(
    async (id: string) => {
      const profile = registryRef.current.profiles.find((entry) => entry.id === id)
      if (!profile) throw new Error('This runtime is no longer saved')
      await openProfile(profile)
    },
    [openProfile],
  )
  const disconnect = useCallback(async () => {
    connecting.current++
    await flush()
    if (connectionRef.current) clearRuntimeRequestCache(connectionRef.current)
    connectionRef.current = null
    setConnection(null)
    setConnected(false)
    setSnapshot(null)
    synchronization.bind(null)
    setSyncError(null)
    install({ ...createWorkspace(), repositories: [], agents: [], tasks: [], automations: [] })
    saveRegistry({ ...registryRef.current, activeId: null })
  }, [flush, install, saveRegistry, synchronization])
  const forgetRuntime = useCallback(
    async (id: string) => {
      const profile = registryRef.current.profiles.find((item) => item.id === id)
      if (
        profile &&
        registryRef.current.activeId !== id &&
        (await readWorkspaceOutbox(profile.connection))
      )
        throw new Error(
          'This runtime has saved edits waiting to sync. Open it and retry sync or reload before forgetting it.',
        )
      connecting.current++
      if (registryRef.current.activeId === id) await disconnect()
      saveRegistry(removeRuntime(registryRef.current, id))
      const next = { ...overviewsRef.current }
      delete next[id]
      overviewsRef.current = next
      setOverviews(next)
      if (profile) {
        clearRuntimeRequestCache(profile.connection)
        await cacheFor(profile).clear()
      }
      caches.current.delete(id)
      cacheWrites.current.delete(id)
    },
    [disconnect, saveRegistry, cacheFor],
  )
  // Explicit-owner requests never borrow the currently active connection.
  const readRuntime = useCallback<Store['readRuntime']>(
    async (profile, path, input, schema, method) => {
      assertProfile(profile)
      if (
        connectionRef.current?.address === profile.connection.address &&
        connectionRef.current.token === profile.connection.token
      ) {
        await flush()
        assertProfile(profile)
      }
      const value = await runtimeRequest(
        profile.connection,
        profile.connection.address,
        path,
        input,
        schema,
        method,
      )
      assertProfile(profile)
      return value
    },
    [assertProfile, flush],
  )
  const runtimeReadCache = useCallback(
    (profile: RuntimeProfile) => {
      assertProfile(profile)
      return cacheFor(profile)
    },
    [assertProfile, cacheFor],
  )
  const request = useCallback<Request>(
    async (path, input, schema, method) => {
      const target = connection
      if (target !== connectionRef.current)
        throw new Error('Runtime connection changed. Reopen this view before continuing.')
      if (!target) throw new Error('Connect to a runtime first')
      await flush()
      if (target !== connectionRef.current) throw new Error('Runtime connection changed')
      const result = await runtimeRequest(target, target.address, path, input, schema, method)
      if (target !== connectionRef.current)
        throw new Error('Runtime connection changed. Reopen this view before continuing.')
      return result
    },
    [connection, flush],
  )
  const retrySync = useCallback(async () => {
    if (connection !== connectionRef.current) throw new Error('Runtime connection changed')
    await synchronization.retry()
  }, [connection, synchronization])
  const discardAndReload = useCallback(async () => {
    const target = connection
    if (synchronization.isSending())
      throw new Error('Wait for the current sync attempt to finish before reloading.')
    if (!target || target !== connectionRef.current) throw new Error('Runtime connection changed')
    const attempt = ++connecting.current
    const checkpoint = synchronization.checkpoint()
    const value = await runtimeRequest(
      target,
      target.address,
      '/api/snapshot',
      undefined,
      snapshotSchema,
      'GET',
    )
    if (target !== connectionRef.current || attempt !== connecting.current)
      throw new Error('Runtime connection changed')
    if (synchronization.isSending() || synchronization.checkpoint().version !== checkpoint.version)
      throw new Error(
        'Edits or sync activity changed while reloading. Review the current changes and try again.',
      )
    const profile = registryRef.current.profiles.find(
      (entry) => entry.id === registryRef.current.activeId,
    )
    if (!profile) throw new Error('This runtime is no longer saved')
    // A failed backup must leave the unsent queue and workspace intact.
    await writeWorkspaceDocument(
      `${storageKey}.unsent-backup.${encodeURIComponent(profile.id)}`,
      encodeWorkspace(current.current),
    )
    if (
      target !== connectionRef.current ||
      attempt !== connecting.current ||
      synchronization.isSending() ||
      synchronization.checkpoint().version !== checkpoint.version
    )
      throw new Error('The workspace changed while backing up. Review changes before reloading.')
    await synchronization.discard(checkpoint)
    if (target !== connectionRef.current || attempt !== connecting.current)
      throw new Error('Runtime connection changed while reloading.')
    adopt(profile, value, true)
    updateOverview({
      ...(overviewsRef.current[profile.id] ?? idleOverview(profile)),
      profile,
      snapshot: value,
      connected: true,
      lastSeen: new Date().toISOString(),
      error: null,
    })
  }, [adopt, connection, synchronization, updateOverview])
  const refreshRuntime = useCallback(
    async (profile: RuntimeProfile) => {
      assertProfile(profile)
      const checkpoint = synchronization.checkpoint()
      const order = (snapshotOrder.current.get(profile.id) ?? 0) + 1
      snapshotOrder.current.set(profile.id, order)
      let value: RuntimeSnapshot
      try {
        value = await readRuntime(profile, '/api/snapshot', undefined, snapshotSchema, 'GET')
      } catch (error) {
        assertProfile(profile)
        if (snapshotOrder.current.get(profile.id) === order) {
          const message = error instanceof Error ? error.message : String(error)
          updateOverview({
            ...(overviewsRef.current[profile.id] ?? idleOverview(profile)),
            profile,
            connected: false,
            error: message,
          })
          if (
            registryRef.current.activeId === profile.id &&
            synchronization.isCurrent(checkpoint)
          ) {
            setConnected(false)
            setSyncError(message)
          }
        }
        throw error
      }
      if (snapshotOrder.current.get(profile.id) !== order) return
      updateOverview({
        ...(overviewsRef.current[profile.id] ?? idleOverview(profile)),
        profile,
        snapshot: value,
        connected: true,
        lastSeen: new Date().toISOString(),
        error: null,
      })
      if (registryRef.current.activeId === profile.id && synchronization.isCurrent(checkpoint)) {
        setSnapshot(value)
        setConnected(true)
        synchronization.clearNetworkError()
        if (synchronization.accepts(checkpoint)) installSnapshot(profile.connection, value)
      }
    },
    [assertProfile, readRuntime, synchronization, updateOverview, installSnapshot],
  )
  const refreshRuntimes = useCallback(async () => {
    await Promise.all(
      registryRef.current.profiles.map(async (profile) => {
        if (busyHosts.current.has(profile.id)) return
        busyHosts.current.add(profile.id)
        const checkpoint = synchronization.checkpoint()
        const order = (snapshotOrder.current.get(profile.id) ?? 0) + 1
        snapshotOrder.current.set(profile.id, order)
        const valid = () =>
          registryRef.current.profiles.some(
            (entry) =>
              entry.id === profile.id && entry.connection.token === profile.connection.token,
          )
        const receiveSnapshot = (value: RuntimeOverview) => {
          if (!valid() || snapshotOrder.current.get(profile.id) !== order) return
          updateOverview(value)
          if (registryRef.current.activeId !== profile.id || !synchronization.isCurrent(checkpoint))
            return
          setConnected(value.connected)
          if (value.connected && value.snapshot) {
            setSnapshot(value.snapshot)
            synchronization.clearNetworkError()
            if (synchronization.accepts(checkpoint))
              installSnapshot(profile.connection, value.snapshot)
          } else setSyncError(value.error)
        }
        try {
          const value = await loadRuntimeOverview(
            profile,
            overviewsRef.current[profile.id],
            receiveSnapshot,
          )
          if (!valid()) return
          const previous = overviewsRef.current[profile.id]
          if (snapshotOrder.current.get(profile.id) !== order && previous) {
            updateOverview({
              ...value,
              snapshot: previous.snapshot,
              connected: previous.connected,
              lastSeen: previous.lastSeen,
              error: previous.error,
            })
          } else {
            updateOverview(value)
            if (!value.connected) receiveSnapshot(value)
          }
        } finally {
          busyHosts.current.delete(profile.id)
        }
      }),
    )
  }, [installSnapshot, synchronization, updateOverview])
  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    const restore = async () => {
      let restoredWorkspaceDocument: string | null = null
      try {
        const saved = await readWorkspaceDocument(storageKey)
        if (saved) {
          install(decodeWorkspace(saved))
          restoredWorkspaceDocument = saved
        }
      } catch (error) {
        writable.current = false
        setStorageError(
          `Saved workspace could not be loaded and has not been overwritten. ${error instanceof Error ? error.message : ''}`,
        )
      }
      let registry = await readRuntimeRegistry()
      let cached: Record<string, RuntimeSnapshot> = {}
      try {
        const saved = localStorage.getItem(snapshotKey)
        if (saved) cached = z.record(z.string(), snapshotSchema).parse(JSON.parse(saved))
      } catch {
        setStorageError('Saved device cache could not be loaded. Reconnect to refresh it.')
      }
      const desktop = z
        .object({ dovo: z.object({ runtimeConnection: z.function() }) })
        .safeParse(window)
      if (desktop.success) {
        const local = runtimeProfile(
          connectionSchema.parse(await desktop.data.dovo.runtimeConnection()),
        )
        const firstConnection = !registry.profiles.length
        registry = upsertRuntime(registry, local, firstConnection)
        // Only a first-ever local desktop runtime may adopt pre-existing local drafts.
        if (firstConnection) {
          const initial = await runtimeRequest(
            local.connection,
            local.connection.address,
            '/api/snapshot',
            undefined,
            snapshotSchema,
            'GET',
          )
          if (
            initial.owner &&
            !initial.workspace.agents.length &&
            !initial.workspace.repositories.length &&
            !initial.workspace.tasks.length
          ) {
            await runtimeRequest(
              local.connection,
              local.connection.address,
              '/api/workspace/import',
              current.current,
              responses.ok,
            )
          }
        }
      }
      saveRegistry(registry)
      let migrated = true
      for (const profile of registry.profiles) {
        let lastSeen: string | null = null
        let pulls: RuntimeOverview['pulls'] = null
        try {
          const stored = await cacheFor(profile).read('snapshot', runtimeSnapshotCacheSchema)
          if (stored) {
            cached[profile.id] = stored.value.snapshot
            lastSeen = stored.value.lastSeen
            pulls = stored.value.pulls ? { ...stored.value.pulls, partial: true } : null
          } else if (cached[profile.id])
            await cacheFor(profile).write('snapshot', {
              snapshot: cached[profile.id],
              lastSeen: null,
              pulls: null,
            })
        } catch {
          migrated = false
          setStorageError('Saved device cache could not be loaded. Reconnect to refresh it.')
        }
        const value = cached[profile.id]
        if (value)
          cached[profile.id] = {
            ...value,
            approvals: [],
            questions: [],
            terminals: [],
            pendingDevices: [],
          }
        updateOverview({ ...idleOverview(profile, cached[profile.id] ?? null), lastSeen, pulls })
      }
      if (migrated) localStorage.removeItem(snapshotKey)
      const active = registry.profiles.find((profile) => profile.id === registry.activeId)
      if (active) {
        const outbox = await readWorkspaceOutbox(active.connection)
        // The old workspace document may contain unsent changes, but predates per-host
        // attribution. Preserve it without replaying it against an arbitrary runtime.
        const legacyRecovery = `${storageKey}.before-outbox-migration`
        if (
          !outbox &&
          restoredWorkspaceDocument &&
          !(await readWorkspaceDocument(legacyRecovery))
        ) {
          await writeWorkspaceDocument(legacyRecovery, restoredWorkspaceDocument)
          if (
            !cached[active.id] ||
            encodeWorkspace(current.current) !== encodeWorkspace(cached[active.id].workspace)
          )
            setStorageError(
              'A previous local workspace differs from the saved host snapshot. It has been preserved in a recovery backup instead of replaying unverified changes.',
            )
        }
        adopt(active, cached[active.id] ?? null, false, outbox)
        setReady(true)
        try {
          if (!outbox) await openProfile(active)
        } catch (error) {
          setSyncError(error instanceof Error ? error.message : String(error))
        }
      }
      setReady(true)
      void refreshRuntimes().catch((error) =>
        setSyncError(error instanceof Error ? error.message : String(error)),
      )
    }
    void restore()
      .catch((error) => setSyncError(error instanceof Error ? error.message : String(error)))
      .finally(() => setReady(true))
  }, [adopt, install, openProfile, refreshRuntimes, saveRegistry, updateOverview, cacheFor])
  useEffect(() => {
    if (!ready || !writable.current) return
    void writeWorkspaceDocument(storageKey, encodeWorkspace(workspace)).catch(() =>
      setStorageError('Could not save workspace. Keep this window open.'),
    )
  }, [workspace, ready])
  useEffect(() => {
    if (!connection) return
    let stopped = false
    const id = runtimeProfile(connection).id
    const poll = async () => {
      if (document.visibilityState !== 'visible' || busySnapshots.current.has(id)) return
      busySnapshots.current.add(id)
      const order = (snapshotOrder.current.get(id) ?? 0) + 1
      snapshotOrder.current.set(id, order)
      const checkpoint = synchronization.checkpoint()
      try {
        const value = await runtimeRequest(
          connection,
          connection.address,
          '/api/snapshot',
          undefined,
          snapshotSchema,
          'GET',
        )
        if (
          stopped ||
          !synchronization.isCurrent(checkpoint) ||
          snapshotOrder.current.get(id) !== order
        )
          return
        setSnapshot(value)
        setConnected(true)
        synchronization.clearNetworkError()
        if (synchronization.accepts(checkpoint)) installSnapshot(connection, value)
        const profile = registryRef.current.profiles.find(
          (entry) => entry.id === id && entry.connection.token === connection.token,
        )
        if (profile)
          updateOverview({
            ...(overviewsRef.current[id] ?? idleOverview(profile)),
            profile,
            snapshot: value,
            connected: true,
            lastSeen: new Date().toISOString(),
            error: null,
          })
      } catch (error) {
        if (
          !stopped &&
          synchronization.isCurrent(checkpoint) &&
          snapshotOrder.current.get(id) === order
        ) {
          const message = error instanceof Error ? error.message : String(error)
          setConnected(false)
          setSyncError(message)
          const previous = overviewsRef.current[id]
          if (previous) updateOverview({ ...previous, connected: false, error: message })
        }
      } finally {
        busySnapshots.current.delete(id)
      }
    }
    void poll()
    const timer = setInterval(() => void poll(), 1000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [connection, installSnapshot, synchronization, updateOverview])
  useEffect(() => {
    if (!ready) return
    const refresh = () => {
      if (document.visibilityState === 'visible') void refreshRuntimes()
    }
    const timer = setInterval(refresh, 30000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [ready, refreshRuntimes])
  return (
    <WorkspaceContext.Provider
      value={{
        workspace,
        setWorkspace,
        ready,
        storageError,
        connection,
        snapshot,
        connected,
        syncError,
        connect,
        disconnect,
        request,
        flush,
        runtimeRegistry,
        activeRuntimeId: runtimeRegistry.activeId,
        runtimes: runtimeRegistry.profiles.map((profile) =>
          overviews[profile.id]?.profile.connection.token === profile.connection.token
            ? overviews[profile.id]
            : idleOverview(profile),
        ),
        switchRuntime,
        forgetRuntime,
        refreshRuntimes,
        refreshRuntime,
        retrySync,
        discardAndReload,
        pendingSync: synchronization.hasPending(),
        readCache: connection ? cacheFor(runtimeProfile(connection)) : null,
        readRuntime,
        runtimeReadCache,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}
export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('WorkspaceProvider is required')
  return value
}

/** Settings for an item stay on its host even when navigation opens work on another host. */
export function WorkspaceScope({
  profile,
  children,
}: {
  profile: RuntimeProfile
  children: ReactNode
}) {
  const root = useWorkspace()
  const { readRuntime, refreshRuntime, runtimeReadCache, setWorkspace } = root
  const {
    id,
    name,
    connection: { address, token },
  } = profile
  const owner = useMemo(
    () => ({ id, name, connection: { address, token } }),
    [id, name, address, token],
  )
  const entry = root.runtimes.find(
    (item) =>
      item.profile.id === id &&
      item.profile.connection.address === address &&
      item.profile.connection.token === token,
  )
  const request = useCallback<Request>(
    async (path, input, schema, method) => {
      const result = await readRuntime(owner, path, input, schema, method)
      if (method === 'PATCH' && path === '/api/workspace') await refreshRuntime(owner)
      return result
    },
    [owner, readRuntime, refreshRuntime],
  )
  const active = root.activeRuntimeId === id
  const scopedSetWorkspace = useCallback<Store['setWorkspace']>(
    (update) => {
      // Legacy optimistic editors use the active outbox. Remote settings use awaited PATCH requests.
      if (!active) throw new Error('Use an explicit workspace patch to edit this computer.')
      setWorkspace(update)
    },
    [active, setWorkspace],
  )
  if (!entry) return null
  return (
    <WorkspaceContext.Provider
      value={{
        ...root,
        activeRuntimeId: id,
        workspace: active
          ? root.workspace
          : (entry.snapshot?.workspace ?? {
              ...createWorkspace(),
              repositories: [],
              agents: [],
              tasks: [],
              automations: [],
            }),
        snapshot: active ? root.snapshot : entry.snapshot,
        connection: entry.profile.connection,
        connected: active ? root.connected : entry.connected,
        syncError: active ? root.syncError : entry.error,
        pendingSync: active && root.pendingSync,
        readCache: runtimeReadCache(owner),
        request,
        setWorkspace: scopedSetWorkspace,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}
