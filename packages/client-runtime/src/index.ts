export { CORE_EXTENSION_ID, createCoreExtension } from './core-extension.js'
export { ExtensionHost } from './extension-host.js'
export { StateStore } from './state.js'
export { appendUniqueRows, clientScopeKey, RequestScope } from './request-scope.js'
export { cliProfileOptions } from './cli-profile-options.js'
export type {
  ActivationEvent,
  Command,
  CommandHandler,
  Disposable,
  Extension,
  ExtensionContext,
  ExtensionContribution,
  ExtensionInfo,
  ExtensionManifest,
  ExtensionState,
} from './types.js'
export { startPolling } from './polling.js'
export { runClientEffect } from './effect-boundary.js'
export { applicationState } from './application-state.js'
export { ExtensionError, type ExtensionOperation } from './operation.js'

export { clientTaskScope } from './task-scope.js'
export { startReconnecting } from './reconnecting.js'
export { startSocketHeartbeat } from './socket-heartbeat.js'
