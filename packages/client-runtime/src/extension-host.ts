import { CommandRegistry } from './commands.js'
import { DisposableStore } from './disposable.js'
import { EventBus } from './events.js'
import { StateStore } from './state.js'
import type {
  Extension,
  ExtensionContext,
  ExtensionInfo,
  ExtensionManifest,
  Disposable,
} from './types.js'

interface ExtensionRecord {
  extension: Extension
  state: ExtensionInfo['state']
  context?: ExtensionContext
  error?: string
  activation?: Promise<void>
  localState: StateStore
}

export class ExtensionHost implements Disposable {
  private readonly records = new Map<string, ExtensionRecord>()
  private readonly commands = new CommandRegistry()
  private readonly events = new EventBus()

  constructor(private readonly extensionPath = 'extensions') {}

  register(extension: Extension): Disposable {
    const { id } = extension.manifest
    if (this.records.has(id)) {
      throw new Error(`Extension already registered: ${id}`)
    }
    this.records.set(id, { extension, state: 'registered', localState: new StateStore() })
    return {
      dispose: () => {
        void this.deactivate(id)
        this.records.delete(id)
      },
    }
  }

  get(id: string): ExtensionInfo | undefined {
    const record = this.records.get(id)
    return record ? this.toInfo(record) : undefined
  }

  list(): ExtensionInfo[] {
    return [...this.records.values()].map((record) => this.toInfo(record))
  }

  async activate(id: string): Promise<void> {
    const record = this.records.get(id)
    if (!record) throw new Error(`Extension is not registered: ${id}`)
    if (record.state === 'active') return
    if (record.activation) return record.activation
    if (record.state === 'deactivating') {
      throw new Error(`Extension is deactivating: ${id}`)
    }

    record.state = 'activating'
    record.activation = Promise.resolve()
      .then(() => this.activateRecord(record))
      .finally(() => {
        record.activation = undefined
      })
    return record.activation
  }

  private async activateRecord(record: ExtensionRecord): Promise<void> {
    const id = record.extension.manifest.id
    const subscriptions = new DisposableStore()
    const context: ExtensionContext = {
      extension: record.extension.manifest,
      extensionPath: `${this.extensionPath}/${id}`,
      subscriptions: [],
      commands: {
        registerCommand: (command, handler) => {
          const disposable = this.commands.register(command, handler)
          subscriptions.add(disposable)
          context.subscriptions.push(disposable)
          return disposable
        },
        executeCommand: (command, ...args) => this.commands.execute(command, args),
      },
      events: {
        on: (event, listener) => {
          const disposable = this.events.on(event, listener)
          subscriptions.add(disposable)
          context.subscriptions.push(disposable)
          return disposable
        },
        emit: (event, payload) => this.events.emit(event, payload),
      },
      state: record.localState,
    }

    record.context = context
    try {
      await record.extension.activate(context)
      record.state = 'active'
      record.error = undefined
      await this.events.emit('runtime:extension-activated', { id })
    } catch (error) {
      context.subscriptions.forEach((subscription) => subscription.dispose())
      subscriptions.dispose()
      record.state = 'failed'
      record.error = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async activateByEvent(event: string): Promise<void> {
    const candidates = [...this.records.values()].filter(({ extension }) => {
      const activationEvents = extension.manifest.activationEvents ?? []
      return activationEvents.includes('*') || activationEvents.includes(event as never)
    })
    await Promise.all(candidates.map(({ extension }) => this.activate(extension.manifest.id)))
  }

  executeCommand<T = unknown>(command: string, ...args: readonly unknown[]): Promise<T> {
    return this.commands.execute(command, args)
  }

  async deactivate(id: string): Promise<void> {
    const record = this.records.get(id)
    if (!record) return
    if (record.activation) await record.activation
    if (record.state !== 'active') return
    record.state = 'deactivating'
    record.context?.subscriptions.forEach((subscription) => subscription.dispose())
    await record.extension.deactivate?.()
    record.state = 'inactive'
  }

  async dispose(): Promise<void> {
    for (const { extension } of [...this.records.values()].reverse()) {
      await this.deactivate(extension.manifest.id)
    }
  }

  private toInfo(record: ExtensionRecord): ExtensionInfo {
    const manifest: ExtensionManifest = record.extension.manifest
    return {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      state: record.state,
      ...(record.error ? { error: record.error } : {}),
    }
  }
}
