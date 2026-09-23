import { createHmac } from 'node:crypto'
import { HttpError } from '../errors.js'

const prefix = 'dovo-stored-secret:'
const container = (key: string) => key === 'envValues' || key === 'headerValues'

// Only literal MCP credentials are projected. The private workspace stays on the host.
export class McpSecrets {
  constructor(private readonly key: string) {}
  private reference(value: string) {
    return prefix + createHmac('sha256', this.key).update(value).digest('hex')
  }
  private visit(value: unknown, transform: (value: string) => string, sensitive = false): unknown {
    if (sensitive && typeof value === 'string') return transform(value)
    if (Array.isArray(value)) return value.map((entry) => this.visit(entry, transform))
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          this.visit(entry, transform, sensitive || container(key)),
        ]),
      )
    return value
  }
  public(value: unknown) {
    return this.visit(value, (secret) => this.reference(secret))
  }
  restore(value: unknown, workspace: unknown, allowMissing = false) {
    const secrets = new Map<string, string>()
    this.visit(workspace, (secret) => {
      secrets.set(this.reference(secret), secret)
      return secret
    })
    return this.visit(value, (secret) => {
      if (!secret.startsWith(prefix)) return secret
      const stored = secrets.get(secret)
      if (stored === undefined && allowMissing) return secret
      if (stored === undefined)
        throw new HttpError(409, 'Stored MCP value changed. Refresh and enter the value again.')
      return stored
    })
  }
}
