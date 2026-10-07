import { createContext, useContext, type Dispatch, type SetStateAction } from 'react'
import type { Effect, Schema } from 'effect'
import type {
  PairingProof,
  RuntimeConnection,
  RuntimeSnapshot,
  RuntimeProfile,
  RuntimeRegistry,
  RuntimeOverview,
  RuntimeReadCache,
} from '@dovo/protocol'
import type { TaskPreviewChanges } from './task-previews'
import type { Workspace } from './schema'

export type WorkspaceRequest = <T extends Schema.Codec<unknown, unknown>>(
  path: string,
  input: unknown,
  schema: T,
  method?: 'GET' | 'POST' | 'PATCH',
) => Promise<T['Type']>
export type WorkspaceRequestEffect = <T extends Schema.Codec<unknown, unknown>>(
  path: string,
  input: unknown,
  schema: T,
  method?: 'GET' | 'POST' | 'PATCH',
) => Effect.Effect<T['Type'], Error>
export type WorkspaceContextValue = {
  previewTask: <A>(
    connection: RuntimeConnection,
    taskId: string,
    changes: TaskPreviewChanges,
    action: () => Promise<A>,
  ) => Promise<A>

  workspace: Workspace
  setWorkspace: Dispatch<SetStateAction<Workspace>>
  ready: boolean
  storageError: string | null
  connection: RuntimeConnection | null
  snapshot: RuntimeSnapshot | null
  connected: boolean
  syncError: string | null
  connect: (
    connection: RuntimeConnection,
    proof?: PairingProof,
    replaceId?: string,
  ) => Promise<void>
  cancelPairing: (address: string, proof: PairingProof) => Promise<void>
  disconnect: () => Promise<void>
  request: WorkspaceRequest
  requestEffect: WorkspaceRequestEffect
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
  mutationStatus: (profile: RuntimeProfile) => { pending: number; error: string | null }
  discardMutations: (profile: RuntimeProfile) => Promise<void>
  pendingSync: boolean
  readCache: RuntimeReadCache | null
  readRuntime: <T extends Schema.Codec<unknown, unknown>>(
    profile: RuntimeProfile,
    path: string,
    input: unknown,
    schema: T,
    method?: 'GET' | 'POST' | 'PATCH',
  ) => Promise<T['Type']>
  readRuntimeEffect: <T extends Schema.Codec<unknown, unknown>>(
    profile: RuntimeProfile,
    path: string,
    input: unknown,
    schema: T,
    method?: 'GET' | 'POST' | 'PATCH',
  ) => Effect.Effect<T['Type'], Error>
  runtimeReadCache: (profile: RuntimeProfile) => RuntimeReadCache
}
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export function useWorkspace() {
  const value = useContext(WorkspaceContext)
  if (!value) throw new Error('WorkspaceProvider is required')
  return value
}
