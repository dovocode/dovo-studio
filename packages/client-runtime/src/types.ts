export type MaybePromise<T> = T | Promise<T>

export interface Disposable {
  dispose(): void
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

export type CommandHandler = (...args: readonly unknown[]) => MaybePromise<unknown>

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
  get<T>(key: string, defaultValue?: T): T | undefined
  set<T>(key: string, value: T): void
}

export interface ExtensionContext {
  readonly extension: ExtensionManifest
  readonly extensionPath: string
  readonly subscriptions: Disposable[]
  readonly commands: {
    registerCommand(command: string, handler: CommandHandler): Disposable
    executeCommand<T = unknown>(command: string, ...args: readonly unknown[]): Promise<T>
  }
  readonly events: {
    on<T>(event: string, listener: (payload: T) => MaybePromise<void>): Disposable
    emit<T>(event: string, payload: T): Promise<void>
  }
  readonly state: ExtensionState
}

export interface Extension<TApi = unknown> {
  readonly manifest: ExtensionManifest
  activate(context: ExtensionContext): MaybePromise<TApi | void>
  deactivate?(): MaybePromise<void>
}

export interface ExtensionInfo {
  id: string
  name: string
  version: string
  state: 'registered' | 'activating' | 'active' | 'deactivating' | 'inactive' | 'failed'
  error?: string
}
