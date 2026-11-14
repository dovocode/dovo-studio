import { createHash } from 'node:crypto'
import type { LifecycleEvent } from './hook-events.js'

export class ToolLoopStop extends Error {
  constructor() {
    super(
      'Stopped after five identical failed tool calls. Review the error before retrying. Saved work is kept.',
    )
  }
}

/** HookEvents emits one terminal outcome per call. Retain only a digest, never tool contents. */
export class ToolLoopGuard {
  private previous = ''
  private count = 0
  accept(event: LifecycleEvent) {
    if (event.event === 'tool-complete') {
      this.previous = ''
      this.count = 0
      return false
    }
    const tool = event.data.tool
    if (event.event !== 'tool-error' || !tool) return false
    if (!tool.name || tool.input === undefined || tool.output === undefined) {
      this.previous = ''
      this.count = 0
      return false
    }
    const key = createHash('sha256')
      .update(
        JSON.stringify([tool.name, tool.input, tool.output], (_key, value: unknown) =>
          value && typeof value === 'object' && !Array.isArray(value)
            ? Object.fromEntries(
                Object.keys(value)
                  .sort()
                  .map((key) => [key, Reflect.get(value, key)]),
              )
            : value,
        ),
      )
      .digest('hex')
    this.count = key === this.previous ? this.count + 1 : 1
    this.previous = key
    return this.count === 5
  }
}
