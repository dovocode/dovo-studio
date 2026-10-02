import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { Effect } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import {
  decodeResult,
  runtimeRequestEffect,
  sameRuntimeConnection,
  snapshotSchema,
  type RuntimeRegistry,
  type RuntimeOverview,
} from '@dovo/protocol'
import { WorkspaceContext, type WorkspaceContextValue } from './context'
import { createWorkspace } from './seed'
import { browserReadCache } from './read-cache'

const unavailable = () => {
  throw new Error('Open Dovo to manage workspace settings')
}
const unavailableAsync = async () => unavailable()
/** The quick-task window reads snapshots and dispatches explicit requests. It never
 * initializes migrations, pairing, background sync or a second workspace outbox. */
export function LauncherWorkspaceProvider({
  registry,
  children,
}: {
  registry: RuntimeRegistry
  children: ReactNode
}) {
  const current = useRef(registry)
  current.current = registry
  const [entries, setEntries] = useState<Record<string, RuntimeOverview>>({})
  const readRuntimeEffect = useCallback<WorkspaceContextValue['readRuntimeEffect']>(
    (profile, path, input, schema, method) =>
      Effect.suspend(() => {
        const valid = () =>
          current.current.profiles.some(
            (item) =>
              item.id === profile.id && sameRuntimeConnection(item.connection, profile.connection),
          )
        if (!valid())
          return Effect.fail(new Error('This computer connection changed. Reopen quick task.'))
        return runtimeRequestEffect(
          profile.connection,
          profile.connection.address,
          path,
          input,
          schema,
          method,
        ).pipe(
          Effect.flatMap((result) => {
            if (!valid())
              return Effect.fail(new Error('This computer connection changed. Reopen quick task.'))
            if (path === '/api/snapshot') {
              const decoded = decodeResult(snapshotSchema, result)
              if (decoded.success)
                setEntries((before) => ({
                  ...before,
                  [profile.id]: {
                    profile,
                    snapshot: decoded.data,
                    connected: true,
                    lastSeen: new Date().toISOString(),
                    error: null,
                    pulls: null,
                    pullError: null,
                  },
                }))
            }
            return Effect.succeed(result)
          }),
        )
      }),
    [],
  )
  const readRuntime = useCallback<WorkspaceContextValue['readRuntime']>(
    (...args) => runClientEffect(readRuntimeEffect(...args)),
    [readRuntimeEffect],
  )
  const refreshRuntime = useCallback<WorkspaceContextValue['refreshRuntime']>(
    async (profile) => {
      await readRuntime(profile, '/api/snapshot', undefined, snapshotSchema, 'GET')
    },
    [readRuntime],
  )
  const profile =
    registry.profiles.find((item) => item.id === registry.activeId) ?? registry.profiles[0]
  const requestEffect = useCallback<WorkspaceContextValue['requestEffect']>(
    (...args) =>
      profile
        ? readRuntimeEffect(profile, ...args)
        : Effect.fail(new Error('Connect a computer in Dovo first')),
    [profile, readRuntimeEffect],
  )
  const request = useCallback<WorkspaceContextValue['request']>(
    (...args) => runClientEffect(requestEffect(...args)),
    [requestEffect],
  )
  const value = useMemo<WorkspaceContextValue>(() => {
    const runtimes = registry.profiles.map((profile) => {
      const entry = entries[profile.id]
      return entry && sameRuntimeConnection(entry.profile.connection, profile.connection)
        ? entry
        : {
            profile,
            snapshot: null,
            connected: false,
            lastSeen: null,
            error: null,
            pulls: null,
            pullError: null,
          }
    })
    const active = runtimes.find((entry) => entry.profile.id === profile?.id)
    return {
      workspace: active?.snapshot?.workspace ?? {
        ...createWorkspace(),
        tasks: [],
        repositories: [],
        agents: [],
        automations: [],
      },
      snapshot: active?.snapshot ?? null,
      connection: profile?.connection ?? null,
      ready: true,
      connected: !!active?.connected,
      storageError: null,
      syncError: null,
      pendingSync: false,
      runtimeRegistry: registry,
      activeRuntimeId: profile?.id ?? null,
      runtimes,
      request,
      requestEffect,
      readRuntime,
      readRuntimeEffect,
      refreshRuntime,
      readCache: null,
      runtimeReadCache: (profile) => browserReadCache(profile.connection),
      setWorkspace: unavailable,
      previewTask: unavailableAsync,
      connect: unavailableAsync,
      cancelPairing: unavailableAsync,
      disconnect: unavailableAsync,
      switchRuntime: unavailableAsync,
      forgetRuntime: unavailableAsync,
      flush: unavailableAsync,
      retrySync: unavailableAsync,
      discardAndReload: unavailableAsync,
      refreshRuntimes: async () => {
        await Promise.all(registry.profiles.map(refreshRuntime))
      },
    }
  }, [
    registry,
    entries,
    profile,
    request,
    requestEffect,
    readRuntime,
    readRuntimeEffect,
    refreshRuntime,
  ])
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
