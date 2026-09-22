import type { Disposable, MaybePromise } from './types.js'

type EventListener = (payload: unknown) => MaybePromise<void>

export class EventBus {
  private readonly listeners = new Map<string, Set<EventListener>>()

  on<T>(event: string, listener: (payload: T) => MaybePromise<void>): Disposable {
    const listeners = this.listeners.get(event) ?? new Set<EventListener>()
    listeners.add(listener as EventListener)
    this.listeners.set(event, listeners)
    return {
      dispose: () => {
        listeners.delete(listener as EventListener)
        if (listeners.size === 0) this.listeners.delete(event)
      },
    }
  }

  async emit<T>(event: string, payload: T): Promise<void> {
    const listeners = this.listeners.get(event)
    if (!listeners) return
    for (const listener of listeners) {
      await listener(payload)
    }
  }
}
