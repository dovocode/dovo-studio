export {
  compareVersions,
  mergeLatest,
  pendingLatest,
  nextRevision,
  type VersionStamp,
} from './register.js'
export {
  DurableState,
  StateProtocolError,
  StateGapError,
  StateRollbackError,
  STATE_MAX_BATCH_BYTES,
  STATE_MAX_EXCHANGE_BYTES,
} from './state.js'
export type {
  StateVersion,
  StateVersionRepair,
  StateChange,
  StateBatch,
  StateRequest,
  StateResponse,
  StateSnapshot,
  StateStorage,
  DurableStateOptions,
} from './state.js'
export { startReconnecting } from './reconnecting.js'
export { startReplication, type ReplicationOptions } from './replication.js'
export { jsonStateStorage } from './storage.js'
export { startPolling } from './polling.js'
