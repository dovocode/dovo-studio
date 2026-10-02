import { createHmac } from 'node:crypto'
import { HttpError } from '../errors.js'

const prefix = 'dovo-stored-secret:'
const container = (key: string) => key === 'envValues' || key === 'headerValues'

// Only literal MCP credentials are projected. The private workspace stays on the host.
export class McpSecrets {
  private readonly publicCache = new WeakMap<object, unknown>()
  private readonly privateObjects = new WeakSet<object>()
  private readonly secretCache = new WeakMap<object, Map<string, string>>()
  constructor(private readonly key: string) {}
  private reference(value: string) {
    return prefix + createHmac('sha256', this.key).update(value).digest('hex')
  }
  private visit(value: unknown, transform: (value: string) => string, sensitive = false): unknown {
    if (!sensitive && value && typeof value === 'object' && this.privateObjects.has(value))
      return value
    if (sensitive && typeof value === 'string') return transform(value)
    if (Array.isArray(value)) {
      const next = value.map((entry) => this.visit(entry, transform, sensitive))
      return next.every((entry, index) => entry === value[index]) ? value : next
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value)
      const next = entries.map(
        ([key, entry]) => [key, this.visit(entry, transform, sensitive || container(key))] as const,
      )
      return next.every(([, entry], index) => entry === entries[index][1])
        ? value
        : Object.fromEntries(next)
    }
    return value
  }
  public(value: unknown) {
    if (value && typeof value === 'object') {
      const cached = this.publicCache.get(value)
      if (cached !== undefined) return cached
      const projected = this.project(value)
      this.publicCache.set(value, projected)
      return projected
    }
    return value
  }
  private project(value: unknown, sensitive = false): unknown {
    if (sensitive && typeof value === 'string') return this.reference(value)
    if (Array.isArray(value)) {
      const next = value.map((entry) =>
        sensitive ? this.project(entry, true) : this.public(entry),
      )
      return next.every((entry, index) => entry === value[index]) ? value : next
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value)
      const next = entries.map(
        ([key, entry]) =>
          [
            key,
            sensitive || container(key) ? this.project(entry, true) : this.public(entry),
          ] as const,
      )
      return next.every(([, entry], index) => entry === entries[index][1])
        ? value
        : Object.fromEntries(next)
    }
    return value
  }
  private collect(value: unknown, sensitive = false): Map<string, string> {
    if (sensitive && typeof value === 'string') return new Map([[this.reference(value), value]])
    if (!value || typeof value !== 'object') return new Map()
    this.privateObjects.add(value)
    const cached = sensitive ? undefined : this.secretCache.get(value)
    if (cached) return cached
    const secrets = new Map<string, string>()
    for (const [key, entry] of Object.entries(value))
      for (const [reference, secret] of this.collect(entry, sensitive || container(key)))
        secrets.set(reference, secret)
    if (!sensitive) this.secretCache.set(value, secrets)
    return secrets
  }
  restore(value: unknown, workspace: unknown, allowMissing = false) {
    const secrets = this.collect(workspace)
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
