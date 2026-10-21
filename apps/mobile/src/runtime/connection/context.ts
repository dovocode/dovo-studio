import { createContext, useContext } from 'react'
import type { Effect, Schema } from 'effect'
import type {
  PairingProof,
  PeerConfig,
  PeerRelayProvider,
  PendingMessage,
  RuntimeConnection,
  RuntimeOverview,
  RuntimeProfile,
  RuntimeReadCache,
  RuntimeSnapshot,
  Task,
  WorkspacePatchResult,
} from '@dovo/protocol'
import type { TaskPreview } from '../state/optimistic-tasks'

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

export function useRuntime() {
  const runtime = useContext(RuntimeContext)
  if (!runtime) throw new Error('RuntimeProvider required')
  return runtime
}
