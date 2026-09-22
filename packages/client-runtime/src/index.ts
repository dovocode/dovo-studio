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
  MaybePromise,
} from './types.js'
