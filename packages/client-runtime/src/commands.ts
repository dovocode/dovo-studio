import type { CommandHandler, Disposable } from './types.js'

export class CommandRegistry {
  private readonly handlers = new Map<string, CommandHandler>()

  register(command: string, handler: CommandHandler): Disposable {
    if (this.handlers.has(command)) {
      throw new Error(`Command already registered: ${command}`)
    }
    this.handlers.set(command, handler)
    return {
      dispose: () => {
        this.handlers.delete(command)
      },
    }
  }

  async execute<T>(command: string, args: readonly unknown[]): Promise<T> {
    const handler = this.handlers.get(command)
    if (!handler) {
      throw new Error(`Unknown command: ${command}`)
    }
    return (await handler(...args)) as T
  }
}
