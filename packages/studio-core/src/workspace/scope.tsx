import { useCallback, useMemo, type ReactNode } from 'react'
import { Effect } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import { resolveRuntimeTarget, type RuntimeProfile } from '@dovo/protocol'
import { createWorkspace } from './seed'
import { isActiveRuntime } from '../runtime/ownership'
import { WorkspaceValueProvider } from './selector'
import {
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
  const { id, name, connection } = profile
  const owner = useMemo(() => ({ id, name, connection }), [id, name, connection])
  const entry = root.runtimes.find((item) => resolveRuntimeTarget([item.profile], owner))
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
  const active = isActiveRuntime(owner, root.activeRuntimeId, root.connection)
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
      syncConflicts: active ? root.syncConflicts : [],
      resolveSyncConflict: active
        ? root.resolveSyncConflict
        : async () => {
            throw new Error('Open this computer before resolving saved edits.')
          },
      readCache: entry ? runtimeReadCache(owner) : null,
      request,
      requestEffect,
      pendingMessages: (task: Parameters<WorkspaceContextValue['pendingMessages']>[0]) =>
        root.pendingMessages(task, owner.connection),
      setWorkspace: scopedSetWorkspace,
    }),
    [root, id, active, entry, owner, runtimeReadCache, request, requestEffect, scopedSetWorkspace],
  )
  if (!entry) return null
  return <WorkspaceValueProvider value={contextValue}>{children}</WorkspaceValueProvider>
}
