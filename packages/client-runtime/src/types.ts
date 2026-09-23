import type { Effect } from 'effect'
import type { ExtensionError, ExtensionOperation } from './operation.js'

export interface Disposable {
  dispose(): void | Promise<void>
}

export type ActivationEvent =
  | 'onStartupFinished'
  | '*'
  | `onView:${string}`
  | `onCommand:${string}`
  | `onEvent:${string}`

export interface Command {
  command: string
  title: string
  category?: string
}

export type CommandHandler = (...args: readonly unknown[]) => ExtensionOperation<unknown>

export interface ExtensionContribution {
  commands?: readonly Command[]
  configuration?: Readonly<Record<string, unknown>>
  views?: Readonly<Record<string, readonly { id: string; name: string }[]>>
}

export interface ExtensionManifest {
  id: string
  name: string
  version: string
  description?: string
  activationEvents?: readonly ActivationEvent[]
  contributes?: ExtensionContribution
}

export interface ExtensionState {
  get(key: string, defaultValue?: unknown): unknown
  set<T>(key: string, value: T): void
}

export interface ExtensionContext {
  readonly extension: ExtensionManifest
  readonly extensionPath: string
  readonly subscriptions: Disposable[]
  readonly commands: {
    registerCommand(command: string, handler: CommandHandler): Disposable
    executeCommand(
      command: string,
      ...args: readonly unknown[]
    ): Effect.Effect<unknown, ExtensionError>
  }
  readonly events: {
    on(event: string, listener: (payload: unknown) => ExtensionOperation<void>): Disposable
    emit(event: string, payload: unknown): Effect.Effect<void, ExtensionError>
  }
  readonly state: ExtensionState
}

export interface Extension<TApi = unknown> {
  readonly manifest: ExtensionManifest
  activate(context: ExtensionContext): ExtensionOperation<TApi | void>
  deactivate?(): ExtensionOperation<void>
}

export interface ExtensionInfo {
  id: string
  name: string
  version: string
  state: 'registered' | 'activating' | 'active' | 'deactivating' | 'inactive' | 'failed'
  error?: string
}
