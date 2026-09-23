import { Effect } from 'effect'
import { extensionOperation, ExtensionError } from './operation.js'
import type { CommandHandler, Disposable } from './types.js'

export class CommandRegistry {
  private readonly handlers = new Map<string, CommandHandler>()

  register(command: string, handler: CommandHandler): Disposable {
    if (this.handlers.has(command)) throw new Error(`Command already registered: ${command}`)
    this.handlers.set(command, handler)
    return {
      dispose: () => {
        this.handlers.delete(command)
      },
    }
  }

  execute(command: string, args: readonly unknown[]) {
    return Effect.suspend(() => {
      const handler = this.handlers.get(command)
      return handler
        ? extensionOperation(command, () => handler(...args))
        : Effect.fail(
            new ExtensionError({
              operation: command,
              cause: new Error(`Unknown command: ${command}`),
            }),
          )
    })
  }
}
