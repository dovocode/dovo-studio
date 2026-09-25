import {
  WorkspaceContext,
  type WorkspaceRequest,
  type WorkspaceRequestEffect,
  type WorkspaceContextValue,
} from './context'
import {
  previewWorkspace,
  withTaskPreview,
  type TaskPreview,
  type TaskPreviewChanges,
} from './task-previews'
import { useApplicationState } from '../runtime/application-state'
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react'
import { Effect, Either, Schema } from 'effect'
import { startPolling, runClientEffect, clientTaskScope } from '@dovo/client-runtime'
import {
  recoverRuntimePairings,
  mutableStruct,
  decode,
  decodeResult,
  saveRuntimePairing,
  cancelRuntimePairing,
  type PairingProof,
  connectionSchema,
  snapshotSchema,
  runtimeSnapshotCacheSchema,
  responses,
  runtimeProfile,
  upsertRuntime,
  removeRuntime,
  loadRuntimeOverviewEffect,
  runtimeRequestEffect,
  clearRuntimeRequestCache,
  getRuntimeSnapshotTag,
  retainRuntimeSnapshot,
  retainOverviewSnapshot,
  shouldPublishOverview,
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
const connectionError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))
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
  const [previews, setPreviews] = useApplicationState<TaskPreview[]>([])
  const previewTask = useCallback(
    <A,>(
      connection: RuntimeConnection,
      taskId: string,
      changes: TaskPreviewChanges,
      action: () => Promise<A>,
    ) => withTaskPreview({ id: Symbol(taskId), connection, taskId, changes }, setPreviews, action),
    [],
  )
  const [workspace, setState, current] = useApplicationState(createWorkspace)
  const [ready, setReady] = useApplicationState(false),
    [storageError, setStorageError] = useApplicationState<string | null>(null),
    writable = useRef(true)
  const [connection, setConnection, connectionRef] = useApplicationState<RuntimeConnection | null>(
    null,
  )
  const [snapshot, setSnapshotState, snapshotRef] = useApplicationState<RuntimeSnapshot | null>(
      null,
    ),
    [connected, setConnected] = useApplicationState(false),
    [syncError, setSyncError] = useApplicationState<string | null>(null)
  const snapshotConnection = useRef<RuntimeConnection | null>(null)
  const setSnapshot = useCallback(
    (value: RuntimeSnapshot | null, target: RuntimeConnection | null) => {
      const retained = retainRuntimeSnapshot(
        snapshotRef.current,
        snapshotConnection.current,
        value,
        target,
      )
      snapshotConnection.current = target
      setSnapshotState(retained)
    },
    [],
  )
  const [runtimeRegistry, setRegistry, registryRef] = useApplicationState(emptyRegistry)
  const [overviews, setOverviews, overviewsRef] = useApplicationState<
    Record<string, RuntimeOverview>
  >({}, (previous, next) => {
    if (
      !previous ||
      Object.keys(previous).length !== Object.keys(next).length ||
      Object.entries(next).some(([id, entry]) => shouldPublishOverview(previous[id], entry))
    )
      return next
    return previous
  })
  const cacheDirty = useRef(false)
  const cacheWrites = useRef(
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
  const installedSnapshot = useRef<{
    address: string
    token: string
    tag: string
  } | null>(null)
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
  const cacheFor = useCallback((profile: RuntimeProfile) => {
    let entry = caches.current.get(profile.id)
    if (
      !entry ||
      entry.token !== profile.connection.token ||
      entry.address !== profile.connection.address
    ) {
      cacheWrites.current.delete(profile.id)
      if (entry)
        clearRuntimeRequestCache({
          address: entry.address,
          token: entry.token,
        })
      if (entry) void entry.cache.close()
      entry = {
        address: profile.connection.address,
        token: profile.connection.token,
        cache: browserReadCache(profile.connection),
      }
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
    connecting = useRef(0)
  const changingConnection = useRef(false)
  const [storageLock] = useApplicationState(() => Effect.runSync(Effect.makeSemaphore(1)))
  const [synchronization] = useState(
    () => new WorkspaceSynchronization(setSyncError, undefined, writeWorkspaceOutbox),
  )
  const install = useCallback((value: Workspace) => {
    installedSnapshot.current = null
    const next = {
      ...value,
      tasks: value.tasks.filter((task) => !task.example),
    }
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
      if (tag)
        installedSnapshot.current = {
          address: target.address,
          token: target.token,
          tag,
        }
    },
    [install],
  )
  const persistRegistryEffect = useCallback(
    (value: RuntimeRegistry) =>
      Effect.tryPromise({ try: () => writeRuntimeRegistry(value), catch: connectionError }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            setRegistry(value)
            setStorageError('')
          }),
        ),
        Effect.tapError((error) =>
          Effect.sync(() =>
            setStorageError(`Could not save runtime connections. ${error.message}`),
          ),
        ),
      ),
    [],
  )
  const saveRegistry = useCallback(
    (change: (current: RuntimeRegistry) => RuntimeRegistry) => {
      return runClientEffect(
        storageLock
          .withPermits(1)(Effect.suspend(() => persistRegistryEffect(change(registryRef.current))))
          .pipe(Effect.uninterruptible),
      )
    },
    [storageLock, persistRegistryEffect],
  )
  const cancelPairing = useCallback(
    (address: string, proof: PairingProof) =>
      runClientEffect(
        storageLock
          .withPermits(1)(
            Effect.suspend(() =>
              cancelRuntimePairing(
                registryRef.current,
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
  const updateOverview = useCallback((value: RuntimeOverview) => {
    const profile = registryRef.current.profiles.find(
      (entry) =>
        entry.id === value.profile.id && entry.connection.token === value.profile.connection.token,
    )
    if (!profile) return
    const next = {
      ...overviewsRef.current,
      [value.profile.id]: overviewsRef.current[value.profile.id]
        ? retainOverviewSnapshot(overviewsRef.current[value.profile.id], value)
        : value,
    }
    setOverviews(next)
    if (value.connected && value.snapshot) cacheDirty.current = true
  }, [])
  useEffect(() => {
    const persist = Effect.gen(function* () {
      if (!cacheDirty.current) return
      cacheDirty.current = false
      yield* Effect.forEach(
        Object.values(overviewsRef.current),
        (entry) =>
          Effect.gen(function* () {
            if (
              !entry.snapshot ||
              !entry.connected ||
              !registryRef.current.profiles.some(
                (profile) =>
                  profile.id === entry.profile.id &&
                  profile.connection.token === entry.profile.connection.token,
              )
            )
              return
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
            yield* cacheFor(entry.profile).writeEffect('snapshot', {
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
        { concurrency: 3, discard: true },
      ).pipe(
        Effect.catchAll(() =>
          Effect.sync(() => {
            cacheDirty.current = true
            setStorageError('Could not cache device workspaces. Keep this window open.')
          }),
        ),
      )
    }).pipe(Effect.uninterruptible)
    const polling = startPolling(persist, { interval: 5000, immediate: false, onError: () => {} })
    window.addEventListener('pagehide', polling.refresh)
    return () => {
      window.removeEventListener('pagehide', polling.refresh)
      void polling.stop().then(() => runClientEffect(persist))
    }
  }, [cacheFor])
  const flush = useCallback(() => synchronization.flush(), [synchronization])
  const setWorkspace = useCallback<Dispatch<SetStateAction<Workspace>>>(
    (update) => {
      if (changingConnection.current)
        throw new Error('Connection is changing. Wait before editing.')
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
      persist = true,
    ) => {
      synchronization.bind(profile.connection, outbox)
      setConnection(profile.connection)
      setSnapshot(value, profile.connection)
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
      if (persist)
        void saveRegistry((saved) => upsertRuntime(saved, profile)).catch(() => {
          /* Storage error remains visible. */
        })
    },
    [install, installSnapshot, saveRegistry, synchronization],
  )
  const openProfileEffect = useCallback(
    (profile: RuntimeProfile, proof?: PairingProof) =>
      Effect.acquireUseRelease(
        Effect.try({
          try: () => {
            if (changingConnection.current)
              throw new Error('Another connection change is in progress.')
            changingConnection.current = true
          },
          catch: connectionError,
        }),
        () =>
          Effect.gen(function* () {
            const attempt = ++connecting.current
            const previousProfile = registryRef.current.profiles.find(
              (item) => item.id === profile.id,
            )
            const previousConnection =
              registryRef.current.activeId === profile.id
                ? connectionRef.current
                : previousProfile?.connection
            const replacing =
              !!previousConnection &&
              (previousConnection.address !== profile.connection.address ||
                previousConnection.token !== profile.connection.token)
            const replacingActive = replacing && registryRef.current.activeId === profile.id
            if (!replacingActive) yield* synchronization.flushEffect()
            const saved = yield* synchronization.savedEffect()
            const checkpoint = saved.checkpoint
            const accepts = () =>
              replacingActive
                ? synchronization.acceptsSaved(checkpoint)
                : synchronization.accepts(checkpoint)
            let outbox = yield* Effect.tryPromise({
              try: () => readWorkspaceOutbox(profile.connection),
              catch: connectionError,
            })
            if (replacing && previousConnection) {
              const oldOutbox = replacingActive
                ? saved.outbox
                : yield* Effect.tryPromise({
                    try: () => readWorkspaceOutbox(previousConnection),
                    catch: connectionError,
                  })
              if (oldOutbox && outbox && JSON.stringify(oldOutbox) !== JSON.stringify(outbox))
                return yield* Effect.fail(
                  new Error(
                    'Both addresses have saved edits. Resolve the target connection edits before replacing it.',
                  ),
                )
              outbox = oldOutbox ?? outbox
            }
            const value = yield* runtimeRequestEffect(
              profile.connection,
              profile.connection.address,
              '/api/snapshot',
              undefined,
              snapshotSchema,
              'GET',
            )
            if (attempt !== connecting.current)
              return yield* Effect.fail(new Error('Another runtime connection was selected'))
            if (!accepts())
              return yield* Effect.fail(
                new Error(
                  'The workspace changed while connecting. Wait for changes to sync, then try again.',
                ),
              )
            yield* Effect.tryPromise({
              try: () =>
                writeWorkspaceDocument(
                  `${storageKey}.before-connection`,
                  encodeWorkspace(current.current),
                ),
              catch: connectionError,
            }).pipe(Effect.uninterruptible)
            if (attempt !== connecting.current || !accepts())
              return yield* Effect.fail(
                new Error('The workspace changed while connecting. Try again after it syncs.'),
              )
            if (replacing && outbox)
              yield* Effect.tryPromise({
                try: () => writeWorkspaceOutbox(profile.connection, outbox),
                catch: connectionError,
              }).pipe(Effect.uninterruptible)
            const named = {
              ...profile,
              name: value.runtimeHost || profile.name,
            }
            const previous = overviewsRef.current[profile.id]
            yield* storageLock
              .withPermits(1)(
                Effect.suspend(() =>
                  proof
                    ? saveRuntimePairing(
                        registryRef.current,
                        { profile: named, proof },
                        persistRegistryEffect,
                      ).pipe(Effect.asVoid)
                    : persistRegistryEffect(upsertRuntime(registryRef.current, named)),
                ),
              )
              .pipe(Effect.uninterruptible)
            adopt(named, value, true, outbox, false)
            if (replacing && previousConnection && outbox)
              yield* Effect.tryPromise({
                try: () => writeWorkspaceOutbox(previousConnection, null),
                catch: connectionError,
              }).pipe(
                Effect.catchAll((error) =>
                  Effect.sync(() =>
                    setStorageError(
                      `Connected with your saved edits, but the old address backup could not be removed. ${error.message}`,
                    ),
                  ),
                ),
              )
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
          }),
        () =>
          Effect.sync(() => {
            changingConnection.current = false
          }),
      ),
    [adopt, synchronization, updateOverview, storageLock, persistRegistryEffect],
  )
  const openProfile = useCallback(
    (profile: RuntimeProfile, proof?: PairingProof) =>
      runClientEffect(openProfileEffect(profile, proof)),
    [openProfileEffect],
  )
  useEffect(() => {
    if (!ready) return
    const commands = clientTaskScope()
    const recover = storageLock
      .withPermits(1)(
        Effect.suspend(() => {
          const before = registryRef.current
          return recoverRuntimePairings(before, persistRegistryEffect).pipe(
            Effect.map((saved) => {
              const active = saved.profiles.find((item) => item.id === saved.activeId)
              const old = before.profiles.find((item) => item.id === saved.activeId)
              return active &&
                (active.connection.address !== old?.connection.address ||
                  active.connection.token !== old?.connection.token)
                ? active
                : null
            }),
          )
        }),
      )
      .pipe(
        Effect.flatMap((active) => (active ? openProfileEffect(active) : Effect.void)),
        Effect.asVoid,
        Effect.catchAll((error) => Effect.sync(() => setStorageError(error.message))),
      )
    const foreground = () => {
      if (document.visibilityState === 'visible') void commands.run(recover)
    }
    foreground()
    document.addEventListener('visibilitychange', foreground)
    return () => {
      document.removeEventListener('visibilitychange', foreground)
      void commands.stop()
    }
  }, [ready, storageLock, persistRegistryEffect, openProfileEffect])
  const connect = useCallback(
    async (value: RuntimeConnection, proof?: PairingProof, replaceId?: string) => {
      const next = decode(connectionSchema, {
        ...value,
        address: new URL(value.address).origin,
      })
      const previous = registryRef.current.profiles.find((item) => item.id === replaceId)
      if (replaceId && (!previous || !proof))
        throw new Error('Select a saved computer and pair its new address before replacing it.')
      await openProfile(
        { ...runtimeProfile(next, previous?.name), ...(previous ? { id: previous.id } : {}) },
        proof,
      )
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
  const disconnectCurrent = useCallback(async () => {
    connecting.current++
    await flush()
    await saveRegistry((saved) => ({ ...saved, activeId: null }))
    if (connectionRef.current) clearRuntimeRequestCache(connectionRef.current)
    setConnection(null)
    setConnected(false)
    setSnapshot(null, null)
    synchronization.bind(null)
    setSyncError(null)
    install({
      ...createWorkspace(),
      repositories: [],
      agents: [],
      tasks: [],
      automations: [],
    })
  }, [flush, install, saveRegistry, synchronization])
  const disconnect = useCallback(async () => {
    if (changingConnection.current) throw new Error('Wait for the connection change to finish.')
    changingConnection.current = true
    try {
      await disconnectCurrent()
    } finally {
      changingConnection.current = false
    }
  }, [disconnectCurrent])
  const forgetRuntime = useCallback(
    async (id: string) => {
      if (changingConnection.current) throw new Error('Wait for the connection change to finish.')
      changingConnection.current = true
      try {
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
        if (registryRef.current.activeId === id) await disconnectCurrent()
        await saveRegistry((saved) => removeRuntime(saved, id))
        const next = {
          ...overviewsRef.current,
        }
        delete next[id]
        setOverviews(next)
        if (profile) {
          clearRuntimeRequestCache(profile.connection)
          await cacheFor(profile).clear()
        }
        caches.current.delete(id)
        cacheWrites.current.delete(id)
        // Retire this client's credential on that computer once the removal is saved.
        // Owner credentials (the local desktop runtime) are refused by design and ignored.
        if (profile)
          await runClientEffect(
            runtimeRequestEffect(
              profile.connection,
              profile.connection.address,
              '/api/devices/revoke-self',
              {},
              responses.ok,
              'POST',
              4000,
            ).pipe(Effect.ignore),
          )
      } finally {
        changingConnection.current = false
      }
    },
    [disconnectCurrent, saveRegistry, cacheFor],
  )
  // Explicit-owner requests never borrow the currently active connection.
  const readRuntimeEffect = useCallback<WorkspaceContextValue['readRuntimeEffect']>(
    (profile, path, input, schema, method) =>
      Effect.gen(function* () {
        const check = Effect.try({ try: () => assertProfile(profile), catch: connectionError })
        yield* check
        if (
          connectionRef.current?.address === profile.connection.address &&
          connectionRef.current.token === profile.connection.token
        ) {
          yield* synchronization.flushEffect()
          yield* check
        }
        const value = yield* runtimeRequestEffect(
          profile.connection,
          profile.connection.address,
          path,
          input,
          schema,
          method,
        )
        yield* check
        return value
      }),
    [assertProfile, synchronization],
  )
  const readRuntime = useCallback<WorkspaceContextValue['readRuntime']>(
    (profile, path, input, schema, method) =>
      runClientEffect(readRuntimeEffect(profile, path, input, schema, method)),
    [readRuntimeEffect],
  )
  const runtimeReadCache = useCallback(
    (profile: RuntimeProfile) => {
      assertProfile(profile)
      return cacheFor(profile)
    },
    [assertProfile, cacheFor],
  )
  const requestEffect = useCallback<WorkspaceRequestEffect>(
    (path, input, schema, method) =>
      Effect.gen(function* () {
        const target = connection
        const check = Effect.try({
          try: () => {
            if (target !== connectionRef.current)
              throw new Error('Runtime connection changed. Reopen this view before continuing.')
          },
          catch: connectionError,
        })
        yield* check
        if (!target) return yield* Effect.fail(new Error('Connect to a runtime first'))
        yield* synchronization.flushEffect()
        yield* check
        const value = yield* runtimeRequestEffect(
          target,
          target.address,
          path,
          input,
          schema,
          method,
        )
        yield* check
        return value
      }),
    [connection, synchronization],
  )
  const request = useCallback<WorkspaceRequest>(
    (path, input, schema, method) => runClientEffect(requestEffect(path, input, schema, method)),
    [requestEffect],
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
        setSnapshot(value, profile.connection)
        setConnected(true)
        synchronization.clearNetworkError()
        if (synchronization.accepts(checkpoint)) installSnapshot(profile.connection, value)
      }
    },
    [assertProfile, readRuntime, synchronization, updateOverview, installSnapshot],
  )
  const refreshRuntimesEffect = useCallback(
    () =>
      Effect.suspend(() =>
        Effect.forEach(
          registryRef.current.profiles,
          (profile) =>
            Effect.gen(function* () {
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
                if (
                  registryRef.current.activeId !== profile.id ||
                  !synchronization.isCurrent(checkpoint)
                )
                  return
                setConnected(value.connected)
                if (value.connected && value.snapshot) {
                  setSnapshot(value.snapshot, profile.connection)
                  synchronization.clearNetworkError()
                  if (synchronization.accepts(checkpoint))
                    installSnapshot(profile.connection, value.snapshot)
                } else setSyncError(value.error)
              }
              yield* Effect.gen(function* () {
                const value = yield* loadRuntimeOverviewEffect(
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
              }).pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    busyHosts.current.delete(profile.id)
                  }),
                ),
              )
            }),
          { concurrency: 3, discard: true },
        ),
      ),
    [installSnapshot, synchronization, updateOverview],
  )
  const refreshRuntimes = useCallback(
    () => runClientEffect(refreshRuntimesEffect()),
    [refreshRuntimesEffect],
  )
  useEffect(() => {
    if (bootstrapped.current) return
    bootstrapped.current = true
    let disposed = false
    const commands = clientTaskScope()
    const native = <A,>(run: () => A | Promise<A>) =>
      Effect.tryPromise({
        try: () => Promise.resolve(run()),
        catch: connectionError,
      })
    const restore = Effect.gen(function* () {
      let restoredWorkspaceDocument: string | null = null
      yield* Effect.gen(function* () {
        const saved = yield* native(() => readWorkspaceDocument(storageKey))
        if (saved) {
          const decoded = yield* Effect.try({
            try: () => decodeWorkspace(saved),
            catch: connectionError,
          })
          install(decoded)
          restoredWorkspaceDocument = saved
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            writable.current = false
            setStorageError(
              `Saved workspace could not be loaded and has not been overwritten. ${error.message}`,
            )
          }),
        ),
      )
      let registry = yield* native(readRuntimeRegistry)
      let cached: Record<string, RuntimeSnapshot> = {}
      yield* Effect.try({
        try: () => {
          const saved = localStorage.getItem(snapshotKey)
          if (saved)
            cached = decode(
              Schema.mutable(Schema.Record({ key: Schema.String, value: snapshotSchema })),
              JSON.parse(saved),
            )
        },
        catch: connectionError,
      }).pipe(
        Effect.catchAll(() =>
          Effect.sync(() => {
            setStorageError('Saved device cache could not be loaded. Reconnect to refresh it.')
          }),
        ),
      )
      const desktop = decodeResult(
        mutableStruct({
          dovo: mutableStruct({
            runtimeConnection: Schema.Unknown.pipe(
              Schema.filter(
                (value): value is (...args: unknown[]) => unknown => typeof value === 'function',
              ),
            ),
          }),
        }),
        window,
      )
      if (desktop.success) {
        const connection = yield* native(() => desktop.data.dovo.runtimeConnection())
        const local = yield* Effect.try({
          try: () => runtimeProfile(decode(connectionSchema, connection)),
          catch: connectionError,
        })
        const firstConnection = !registry.profiles.length
        registry = upsertRuntime(registry, local, firstConnection)
        if (firstConnection) {
          const initial = yield* runtimeRequestEffect(
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
          )
            yield* runtimeRequestEffect(
              local.connection,
              local.connection.address,
              '/api/workspace/import',
              current.current,
              responses.ok,
            ).pipe(Effect.uninterruptible)
        }
      }
      yield* native(() => saveRegistry(() => registry))
      let migrated = true
      for (const profile of registry.profiles) {
        let lastSeen: string | null = null
        let pulls: RuntimeOverview['pulls'] = null
        yield* Effect.gen(function* () {
          const stored = yield* cacheFor(profile).readEffect('snapshot', runtimeSnapshotCacheSchema)
          if (stored) {
            cached[profile.id] = stored.value.snapshot
            lastSeen = stored.value.lastSeen
            pulls = stored.value.pulls ? { ...stored.value.pulls, partial: true } : null
          } else if (cached[profile.id])
            yield* cacheFor(profile).writeEffect('snapshot', {
              snapshot: cached[profile.id],
              lastSeen: null,
              pulls: null,
            })
        }).pipe(
          Effect.catchAll(() =>
            Effect.sync(() => {
              migrated = false
              setStorageError('Saved device cache could not be loaded. Reconnect to refresh it.')
            }),
          ),
        )
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
      if (migrated) yield* native(() => localStorage.removeItem(snapshotKey))
      const active = registry.profiles.find((profile) => profile.id === registry.activeId)
      if (active) {
        const outbox = yield* native(() => readWorkspaceOutbox(active.connection))
        const legacyRecovery = `${storageKey}.before-outbox-migration`
        if (
          !outbox &&
          restoredWorkspaceDocument &&
          !(yield* native(() => readWorkspaceDocument(legacyRecovery)))
        ) {
          const document = restoredWorkspaceDocument
          yield* native(() => writeWorkspaceDocument(legacyRecovery, document)).pipe(
            Effect.uninterruptible,
          )
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
        if (!outbox)
          yield* openProfileEffect(active).pipe(
            Effect.catchAll((error) => Effect.sync(() => setSyncError(error.message))),
          )
      }
      setReady(true)
      yield* refreshRuntimesEffect().pipe(
        Effect.catchAll((error) => Effect.sync(() => setSyncError(String(error)))),
      )
    }).pipe(
      Effect.catchAll((error) =>
        Effect.sync(() => {
          if (!disposed) setSyncError(error.message)
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
      bootstrapped.current = false
      void commands.stop()
    }
  }, [
    adopt,
    install,
    openProfileEffect,
    refreshRuntimesEffect,
    saveRegistry,
    updateOverview,
    cacheFor,
  ])
  useEffect(() => {
    if (!ready || !writable.current) return
    void writeWorkspaceDocument(storageKey, encodeWorkspace(workspace)).catch(() =>
      setStorageError('Could not save workspace. Keep this window open.'),
    )
  }, [workspace, ready])
  useEffect(() => {
    if (!connection) return
    let stopped = false
    const id =
      registryRef.current.profiles.find(
        (profile) =>
          profile.connection.address === connection.address &&
          profile.connection.token === connection.token,
      )?.id ?? runtimeProfile(connection).id
    const poll = Effect.suspend(() => {
      if (document.visibilityState !== 'visible' || busySnapshots.current.has(id))
        return Effect.void
      busySnapshots.current.add(id)
      const order = (snapshotOrder.current.get(id) ?? 0) + 1
      snapshotOrder.current.set(id, order)
      const checkpoint = synchronization.checkpoint()
      return Effect.gen(function* () {
        const response = yield* Effect.either(
          runtimeRequestEffect(
            connection,
            connection.address,
            '/api/snapshot',
            undefined,
            snapshotSchema,
            'GET',
          ),
        )
        if (Either.isRight(response)) {
          const value = response.right
          if (
            stopped ||
            !synchronization.isCurrent(checkpoint) ||
            snapshotOrder.current.get(id) !== order
          )
            return
          setSnapshot(value, connection)
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
        } else {
          const error = response.left
          if (
            !stopped &&
            synchronization.isCurrent(checkpoint) &&
            snapshotOrder.current.get(id) === order
          ) {
            const message = error instanceof Error ? error.message : String(error)
            setConnected(false)
            setSyncError(message)
            const previous = overviewsRef.current[id]
            if (previous)
              updateOverview({
                ...previous,
                connected: false,
                error: message,
              })
          }
          // Already published above; failing only lets the poller back off.
          return yield* Effect.fail(error)
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            busySnapshots.current.delete(id)
          }),
        ),
      )
    })
    const polling = startPolling(poll, {
      interval: 1000,
      // An unreachable host is not hammered every second; returning or reconnecting retries at once.
      backoff: 10000,
      onError: () => {},
    })
    const wake = () => {
      if (document.visibilityState === 'visible') polling.refresh()
    }
    window.addEventListener('online', wake)
    document.addEventListener('visibilitychange', wake)
    return () => {
      stopped = true
      window.removeEventListener('online', wake)
      document.removeEventListener('visibilitychange', wake)
      void polling.stop()
    }
  }, [connection, installSnapshot, synchronization, updateOverview])
  useEffect(() => {
    if (!ready) return
    const polling = startPolling(
      Effect.suspend(() =>
        document.visibilityState === 'visible' ? refreshRuntimesEffect() : Effect.void,
      ),
      { interval: 30000, immediate: false, onError: (error) => setSyncError(String(error)) },
    )
    document.addEventListener('visibilitychange', polling.refresh)
    return () => {
      void polling.stop()
      document.removeEventListener('visibilitychange', polling.refresh)
    }
  }, [ready, refreshRuntimesEffect])
  const visibleWorkspace = useMemo(
    () => previewWorkspace(workspace, connection, previews),
    [workspace, connection, previews],
  )
  const visibleRuntimes = useMemo(
    () =>
      runtimeRegistry.profiles.map((profile) => {
        const entry =
          overviews[profile.id]?.profile.connection.token === profile.connection.token
            ? overviews[profile.id]
            : idleOverview(profile)
        if (!entry.snapshot) return entry
        const workspace = previewWorkspace(entry.snapshot.workspace, profile.connection, previews)
        return workspace === entry.snapshot.workspace
          ? entry
          : {
              ...entry,
              snapshot: { ...entry.snapshot, workspace },
            }
      }),
    [runtimeRegistry.profiles, overviews, previews],
  )
  const readCache = useMemo(
    () =>
      connection
        ? cacheFor(
            runtimeRegistry.profiles.find(
              (profile) =>
                profile.connection.address === connection.address &&
                profile.connection.token === connection.token,
            ) ?? runtimeProfile(connection),
          )
        : null,
    [connection, runtimeRegistry.profiles, cacheFor],
  )
  const contextValue = useMemo(
    () => ({
      previewTask,
      workspace: visibleWorkspace,
      setWorkspace,
      ready,
      storageError,
      connection,
      snapshot,
      connected,
      syncError,
      connect,
      cancelPairing,
      disconnect,
      request,
      requestEffect,
      flush,
      runtimeRegistry,
      activeRuntimeId: runtimeRegistry.activeId,
      runtimes: visibleRuntimes,
      switchRuntime,
      forgetRuntime,
      refreshRuntimes,
      refreshRuntime,
      retrySync,
      discardAndReload,
      pendingSync: synchronization.hasPending(),
      readCache,
      readRuntime,
      readRuntimeEffect,
      runtimeReadCache,
    }),
    [
      previewTask,
      visibleWorkspace,
      setWorkspace,
      ready,
      storageError,
      connection,
      snapshot,
      connected,
      syncError,
      connect,
      cancelPairing,
      disconnect,
      request,
      requestEffect,
      flush,
      runtimeRegistry,
      visibleRuntimes,
      switchRuntime,
      forgetRuntime,
      refreshRuntimes,
      refreshRuntime,
      retrySync,
      discardAndReload,
      synchronization,
      readCache,
      readRuntime,
      readRuntimeEffect,
      runtimeReadCache,
    ],
  )
  return <WorkspaceContext.Provider value={contextValue}>{children}</WorkspaceContext.Provider>
}

export { useWorkspace } from './context'
export { WorkspaceScope } from './scope'
