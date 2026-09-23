import { Effect, Ref } from 'effect'
import type { ExtensionState } from './types.js'

export class StateStore implements ExtensionState {
  private readonly values = Effect.runSync(Ref.make<ReadonlyMap<string, unknown>>(new Map()))

  get(key: string, defaultValue?: unknown): unknown {
    const values = Effect.runSync(Ref.get(this.values))
    return values.has(key) ? values.get(key) : defaultValue
  }

  set(key: string, value: unknown): void {
    Effect.runSync(Ref.update(this.values, (current) => new Map(current).set(key, value)))
  }
}
