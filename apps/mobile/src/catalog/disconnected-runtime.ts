import { Effect, Schema } from 'effect'
import { ReadCacheError, type RuntimeReadCache } from '@dovo/protocol'
import type { Runtime } from '../runtime/connection/context'

const disabled = (operation: string) =>
  new Error(`${operation} is disabled in this catalog fixture.`)

async function noRuntimeResponse<T extends Schema.Codec<unknown, unknown>>(
  _path: string,
  _input: unknown,
  _schema: T,
): Promise<T['Type']> {
  throw disabled('Runtime requests')
}

const cacheError = () => new ReadCacheError({ cause: disabled('Runtime cache writes') })
const emptyCache: RuntimeReadCache = {
  closed: true,
  readEffect: () => Effect.succeed(null),
  writeEffect: () => Effect.fail(cacheError()),
  removeEffect: () => Effect.fail(cacheError()),
  clearEffect: () => Effect.fail(cacheError()),
  closeEffect: () => Effect.succeed(undefined),
  read: async () => null,
  write: async () => {
    throw cacheError()
  },
  remove: async () => {
    throw cacheError()
  },
  clear: async () => {
    throw cacheError()
  },
  close: async () => undefined,
}

/** A disconnected runtime fixture for catalog stories; unsupported operations reject loudly. */
export const disconnectedRuntime = {
  previewTaskEffect: (_profile, _taskId, _changes, request) => request,
  snapshot: null,
  connection: null,
  profile: null,
  profiles: [],
  overviews: [],
  activeId: null,
  legacyDraftRuntimeId: null,
  connected: false,
  ready: false,
  registryLoaded: true,
  recovering: false,
  error: '',
  syncAccountSession: async () => {
    throw disabled('Account session changes')
  },
  connectEffect: () => Effect.fail(disabled('Runtime connections')),
  selectRuntimeEffect: () => Effect.fail(disabled('Runtime selection')),
  forgetRuntimeEffect: () => Effect.fail(disabled('Runtime mutations')),
  renameRuntimeEffect: () => Effect.fail(disabled('Runtime mutations')),
  upgradeInternetEffect: () => Effect.fail(disabled('Runtime mutations')),
  setPeerRelayEffect: () => Effect.fail(disabled('Runtime mutations')),
  disconnectEffect: () => Effect.fail(disabled('Runtime connections')),
  refreshEffect: () => Effect.fail(disabled('Runtime refresh')),
  connect: async () => {
    throw disabled('Runtime connections')
  },
  selectRuntime: async () => {
    throw disabled('Runtime selection')
  },
  forgetRuntime: async () => {
    throw disabled('Runtime mutations')
  },
  renameRuntime: async () => {
    throw disabled('Runtime mutations')
  },
  cancelPairing: async () => {
    throw disabled('Runtime pairing')
  },
  disconnect: async () => {
    throw disabled('Runtime connections')
  },
  refresh: async () => {
    throw disabled('Runtime refresh')
  },
  refreshAll: async () => {
    throw disabled('Runtime refresh')
  },
  refreshRuntime: async () => {
    throw disabled('Runtime refresh')
  },
  call: noRuntimeResponse,
  callEffect: () => Effect.fail(disabled('Runtime requests')),
  readEffect: () => Effect.fail(disabled('Runtime reads')),
  readRuntimeEffect: () => Effect.fail(disabled('Runtime reads')),
  refreshRuntimeEffect: () => Effect.fail(disabled('Runtime refresh')),
  pendingMessages: () => [],
  pendingMessagesFor: () => [],
  mutationStatus: () => ({ pending: 0, error: null }),
  retryMutations: async () => {
    throw disabled('Runtime mutations')
  },
  discardMutations: async () => {
    throw disabled('Runtime mutations')
  },
  read: noRuntimeResponse,
  readRuntime: (_profile, path, input, schema) => noRuntimeResponse(path, input, schema),
  cacheForRuntime: () => emptyCache,
  readCache: null,
} satisfies Runtime
