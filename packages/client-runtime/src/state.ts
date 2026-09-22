import type { ExtensionState } from './types.js'

export class StateStore implements ExtensionState {
  private readonly values = new Map<string, unknown>()

  get<T>(key: string, defaultValue?: T): T | undefined {
    return (this.values.has(key) ? this.values.get(key) : defaultValue) as T | undefined
  }

  set<T>(key: string, value: T): void {
    this.values.set(key, value)
  }
}
