import { Effect } from 'effect'
import { extensionOperation, type ExtensionOperation } from './operation.js'
import type { Disposable } from './types.js'

type EventListener = (payload: unknown) => ExtensionOperation<void>

export class EventBus {
  private readonly listeners = new Map<string, Set<EventListener>>()

  on(event: string, listener: EventListener): Disposable {
    const listeners = this.listeners.get(event) ?? new Set<EventListener>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
    return {
      dispose: () => {
        listeners.delete(listener)
        if (listeners.size === 0) this.listeners.delete(event)
      },
    }
  }

  emit(event: string, payload: unknown) {
    return Effect.suspend(() =>
      Effect.forEach(
        [...(this.listeners.get(event) ?? [])],
        (listener) => extensionOperation(event, () => listener(payload)),
        { discard: true },
      ),
    )
  }
}
