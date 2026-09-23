import { Cause, Effect, Exit, Scope } from 'effect'
import { CommandRegistry } from './commands.js'
import { EventBus } from './events.js'
import { StateStore } from './state.js'
import { runClientEffect } from './effect-boundary.js'
import { extensionOperation, ExtensionError } from './operation.js'
import type { Extension, ExtensionContext, ExtensionInfo, Disposable } from './types.js'

interface ExtensionRecord {
  extension: Extension
  state: ExtensionInfo['state']
  error?: string
  activation?: Effect.Effect<void, ExtensionError>
  scope?: Scope.CloseableScope
  lock: Effect.Semaphore
  localState: StateStore
}

export class ExtensionHost implements Disposable {
  private readonly records = new Map<string, ExtensionRecord>()
  private readonly commands = new CommandRegistry()
  private readonly events = new EventBus()
  private closing = false

  constructor(private readonly extensionPath = 'extensions') {}

  register(extension: Extension): Disposable {
    if (this.closing) throw new Error('Extension host is closed')
    const { id } = extension.manifest
    if (this.records.has(id)) throw new Error(`Extension already registered: ${id}`)
    this.records.set(id, {
      extension,
      state: 'registered',
      localState: new StateStore(),
      lock: Effect.runSync(Effect.makeSemaphore(1)),
    })
    return {
      dispose: () =>
        runClientEffect(
          this.deactivateEffect(id).pipe(
            Effect.tap(() => Effect.sync(() => this.records.delete(id))),
          ),
        ),
    }
  }

  get(id: string): ExtensionInfo | undefined {
    const record = this.records.get(id)
    return record ? this.toInfo(record) : undefined
  }

  list(): ExtensionInfo[] {
    return [...this.records.values()].map((record) => this.toInfo(record))
  }

  activateEffect(id: string): Effect.Effect<void, ExtensionError> {
    return Effect.suspend(() => {
      const record = this.records.get(id)
      if (!record || this.closing)
        return Effect.fail(
          new ExtensionError({
            operation: 'activate',
            cause: new Error(
              this.closing ? 'Extension host is closed' : `Extension is not registered: ${id}`,
            ),
          }),
        )
      if (record.state === 'active') return Effect.void
      if (!record.activation)
        record.activation = Effect.runSync(
          Effect.cached(
            record.lock
              .withPermits(1)(this.activateRecord(record))
              .pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    record.activation = undefined
                  }),
                ),
              ),
          ),
        )
      return record.activation
    })
  }

  activate(id: string) {
    return runClientEffect(this.activateEffect(id))
  }

  private activateRecord(record: ExtensionRecord): Effect.Effect<void, ExtensionError> {
    return Effect.gen(this, function* () {
      if (record.state === 'active') return
      record.state = 'activating'
      const id = record.extension.manifest.id
      const scope = yield* Scope.make()
      record.scope = scope
      const context: ExtensionContext = {
        extension: record.extension.manifest,
        extensionPath: `${this.extensionPath}/${id}`,
        subscriptions: [],
        commands: {
          registerCommand: (command, handler) => {
            const disposable = this.commands.register(command, handler)
            context.subscriptions.push(disposable)
            return disposable
          },
          executeCommand: (command, ...args) => this.commands.execute(command, args),
        },
        events: {
          on: (event, listener) => {
            const disposable = this.events.on(event, listener)
            context.subscriptions.push(disposable)
            return disposable
          },
          emit: (event, payload) => this.events.emit(event, payload),
        },
        state: record.localState,
      }
      yield* Scope.addFinalizer(
        scope,
        Effect.suspend(() => {
          const subscriptions = [...new Set(context.subscriptions)].reverse()
          context.subscriptions.length = 0
          return Effect.forEach(subscriptions, (subscription) =>
            Effect.exit(extensionOperation('dispose subscription', () => subscription.dispose())),
          ).pipe(
            Effect.flatMap((results) => {
              const causes = results.filter(Exit.isFailure).map((result) => result.cause)
              return causes.length
                ? Effect.failCause(causes.reduce(Cause.sequential)).pipe(Effect.orDie)
                : Effect.void
            }),
          )
        }),
      )
      yield* extensionOperation(`activate ${id}`, () => record.extension.activate(context)).pipe(
        Effect.zipRight(this.events.emit('runtime:extension-activated', { id })),
        Effect.tap(() =>
          Effect.sync(() => {
            record.state = 'active'
            record.error = undefined
          }),
        ),
        Effect.onError((cause) =>
          Effect.gen(function* () {
            record.state = 'failed'
            const error = Cause.squash(cause)
            record.error = error instanceof Error ? error.message : String(error)
            record.scope = undefined
            yield* Scope.close(scope, Exit.failCause(cause))
          }),
        ),
      )
    })
  }

  activateByEventEffect(event: string) {
    return Effect.suspend(() =>
      Effect.forEach(
        [...this.records.values()].filter(({ extension }) =>
          extension.manifest.activationEvents?.some(
            (candidate) => candidate === '*' || candidate === event,
          ),
        ),
        ({ extension }) => this.activateEffect(extension.manifest.id),
        { concurrency: 'unbounded', discard: true },
      ),
    )
  }

  activateByEvent(event: string) {
    return runClientEffect(this.activateByEventEffect(event))
  }
  executeCommandEffect(command: string, ...args: readonly unknown[]) {
    return this.commands.execute(command, args)
  }
  executeCommand(command: string, ...args: readonly unknown[]) {
    return runClientEffect(this.executeCommandEffect(command, ...args))
  }

  deactivateEffect(id: string): Effect.Effect<void, ExtensionError> {
    return Effect.suspend(() => {
      const record = this.records.get(id)
      if (!record) return Effect.void
      return record.lock.withPermits(1)(
        Effect.gen(function* () {
          if (record.state !== 'active') return
          record.state = 'deactivating'
          const scope = record.scope
          record.scope = undefined
          // Plugin deactivation still runs when a subscription's finalizer fails.
          const released = yield* Effect.exit(scope ? Scope.close(scope, Exit.void) : Effect.void)
          const deactivated = yield* Effect.exit(
            extensionOperation(`deactivate ${id}`, () => record.extension.deactivate?.()),
          )
          record.state =
            Exit.isSuccess(released) && Exit.isSuccess(deactivated) ? 'inactive' : 'failed'
          yield* released
          yield* deactivated
        }),
      )
    })
  }

  deactivate(id: string) {
    return runClientEffect(this.deactivateEffect(id))
  }

  disposeEffect() {
    return Effect.gen(this, function* () {
      this.closing = true
      const results = yield* Effect.forEach([...this.records.keys()].reverse(), (id) =>
        Effect.exit(this.deactivateEffect(id)),
      )
      const causes = results.filter(Exit.isFailure).map((result) => result.cause)
      if (causes.length) yield* Effect.failCause(causes.reduce(Cause.sequential))
    })
  }

  dispose() {
    return runClientEffect(this.disposeEffect())
  }

  private toInfo(record: ExtensionRecord): ExtensionInfo {
    const { id, name, version } = record.extension.manifest
    return {
      id,
      name,
      version,
      state: record.state,
      ...(record.error ? { error: record.error } : {}),
    }
  }
}
