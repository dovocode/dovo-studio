import { useCallback, useMemo, type ReactNode } from 'react'
import { Effect } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import type { RuntimeProfile } from '@dovo/protocol'
import { createWorkspace } from './seed'
import {
  WorkspaceContext,
  useWorkspace,
  type WorkspaceRequest,
  type WorkspaceRequestEffect,
  type WorkspaceContextValue,
} from './context'

const connectionError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

/** Settings for an item stay on its host even when navigation opens work on another host. */
export function WorkspaceScope({
  profile,
  children,
}: {
  profile: RuntimeProfile
  children: ReactNode
}) {
  const root = useWorkspace()
  const { readRuntimeEffect, refreshRuntime, runtimeReadCache, setWorkspace } = root
  const {
    id,
    name,
    connection: { address, token },
  } = profile
  const owner = useMemo(
    () => ({
      id,
      name,
      connection: {
        address,
        token,
      },
    }),
    [id, name, address, token],
  )
  const entry = root.runtimes.find(
    (item) =>
      item.profile.id === id &&
      item.profile.connection.address === address &&
      item.profile.connection.token === token,
  )
  const requestEffect = useCallback<WorkspaceRequestEffect>(
    (path, input, schema, method) =>
      Effect.gen(function* () {
        const result = yield* readRuntimeEffect(owner, path, input, schema, method)
        if (method === 'PATCH' && path === '/api/workspace')
          yield* Effect.tryPromise({ try: () => refreshRuntime(owner), catch: connectionError })
        return result
      }),
    [owner, readRuntimeEffect, refreshRuntime],
  )
  const request = useCallback<WorkspaceRequest>(
    (path, input, schema, method) => runClientEffect(requestEffect(path, input, schema, method)),
    [requestEffect],
  )
  const active = root.activeRuntimeId === id
  const scopedSetWorkspace = useCallback<WorkspaceContextValue['setWorkspace']>(
    (update) => {
      // Legacy optimistic editors use the active outbox. Remote settings use awaited PATCH requests.
      if (!active) throw new Error('Use an explicit workspace patch to edit this computer.')
      setWorkspace(update)
    },
    [active, setWorkspace],
  )
  const contextValue = useMemo(
    () => ({
      ...root,
      activeRuntimeId: id,
      workspace: active
        ? root.workspace
        : (entry?.snapshot?.workspace ?? {
            ...createWorkspace(),
            repositories: [],
            agents: [],
            tasks: [],
            automations: [],
          }),
      snapshot: active ? root.snapshot : (entry?.snapshot ?? null),
      connection: entry?.profile.connection ?? root.connection,
      connected: active ? root.connected : (entry?.connected ?? false),
      syncError: active ? root.syncError : (entry?.error ?? null),
      pendingSync: active && root.pendingSync,
      readCache: entry ? runtimeReadCache(owner) : null,
      request,
      requestEffect,
      setWorkspace: scopedSetWorkspace,
    }),
    [root, id, active, entry, owner, runtimeReadCache, request, requestEffect, scopedSetWorkspace],
  )
  if (!entry) return null
  return <WorkspaceContext.Provider value={contextValue}>{children}</WorkspaceContext.Provider>
}
