export { CORE_EXTENSION_ID, createCoreExtension } from './extensions/core-extension.js'
export { ExtensionHost } from './extensions/extension-host.js'
export { StateStore } from './state/state.js'
export { appendUniqueRows, clientScopeKey, RequestScope } from './effects/request-scope.js'
export { cliProfileOptions } from './extensions/cli-profile-options.js'
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
} from './state/types.js'
export { startPolling } from './effects/polling.js'
export { runClientEffect } from './effects/effect-boundary.js'
export { applicationState } from './state/application-state.js'
export { ExtensionError, type ExtensionOperation } from './effects/operation.js'

export { clientTaskScope } from './effects/task-scope.js'
export { startReconnecting } from './effects/reconnecting.js'
export { startSocketHeartbeat } from './effects/socket-heartbeat.js'
