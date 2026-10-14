import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  decodeResult,
  defaultTaskHarness,
  modelCatalogPresentation,
  modelCatalogSchema,
  modelDiscoveryInput,
  mutableStruct,
  providerSchema,
  type AcpInstallation,
  type AgentDiscovery,
  type ModelCatalog,
} from '@dovo/protocol'
import type { AgentRegistry } from '../configuration/registry.js'

const ttl = 5 * 60_000
const limit = 64
const rowSchema = mutableStruct({ value: Schema.String })
const sorted = (values: Record<string, string> | undefined) =>
  Object.fromEntries(Object.entries(values ?? {}).sort(([a], [b]) => a.localeCompare(b)))

/** Capture the effective launch/account configuration; only its digest can reach SQLite. */
export function configuredModelCatalogKey(
  input: AgentDiscovery,
  registry: Pick<AgentRegistry, 'configure' | 'launch'>,
  installations: readonly AcpInstallation[] = [],
): string {
  const agent = modelDiscoveryInput(registry.configure(input))
  const launch = registry.launch(agent)
  const installation =
    agent.provider === 'acp'
      ? installations.find((item) => item.id === agent.acpInstallationId)
      : undefined
  return createHash('sha256')
    .update(
      JSON.stringify([
        agent,
        launch ? { command: launch.command, args: launch.args, env: sorted(launch.env) } : null,
        installation
          ? [installation.version, installation.installedAt, !!installation.needsRepair]
          : null,
      ]),
    )
    .digest('hex')
}

/** Snapshot generations contain no launch paths, environment values or private ACP config. */
export function modelCatalogGenerations(
  registry: Pick<AgentRegistry, 'configure' | 'launch'>,
  installations: readonly AcpInstallation[],
): Record<string, string> {
  return Object.fromEntries([
    ...providerSchema.literals.map((provider) => [
      provider,
      configuredModelCatalogKey(defaultTaskHarness(provider), registry),
    ]),
    ...installations.map((installation) => {
      const input = { ...defaultTaskHarness('acp'), acpInstallationId: installation.id }
      // Broken/changing installations still need a stable, targeted invalidation marker.
      let launch: string | null = null
      try {
        launch = configuredModelCatalogKey(input, registry, installations)
      } catch {
        /* not launchable */
      }
      return [
        `acp:${installation.id}`,
        createHash('sha256')
          .update(
            JSON.stringify([
              launch,
              installation.version,
              installation.installedAt,
              !!installation.needsRepair,
            ]),
          )
          .digest('hex'),
      ]
    }),
  ])
}

/** Live results are short lived. Durable presentation is always stale and never returned by get. */
export class ModelCatalogCache {
  private entries = new Map<string, { expires: number; value: ModelCatalog }>()
  private presentations = new Map<string, ModelCatalog>()
  private pending = new Map<string, Promise<ModelCatalog>>()
  private durable = true

  constructor(private readonly db: Database.Database) {
    try {
      db.exec(
        'CREATE TABLE IF NOT EXISTS model_catalog_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated INTEGER NOT NULL)',
      )
      this.trimStored()
    } catch {
      this.durable = false
      console.warn('Could not initialize model catalog presentation cache')
    }
  }

  private trim<T>(entries: Map<string, T>) {
    while (entries.size > limit) {
      const oldest = entries.keys().next().value
      if (oldest !== undefined) entries.delete(oldest)
    }
  }

  private trimStored() {
    this.db
      .prepare(
        'DELETE FROM model_catalog_cache WHERE key IN (SELECT key FROM model_catalog_cache ORDER BY updated DESC, rowid DESC LIMIT -1 OFFSET ?)',
      )
      .run(limit)
  }

  /** Presentation-only endpoint: no provider lookup or launch, including after restart. */
  peek(key: string): ModelCatalog | null {
    const cached = this.presentations.get(key)
    if (cached) return modelCatalogPresentation(cached)
    if (!this.durable) return null
    try {
      const row = decodeResult(
        rowSchema,
        this.db.prepare('SELECT value FROM model_catalog_cache WHERE key=?').get(key),
      )
      if (!row.success) return null
      let parsed: unknown
      try {
        parsed = JSON.parse(row.data.value)
      } catch {
        this.db.prepare('DELETE FROM model_catalog_cache WHERE key=?').run(key)
        return null
      }
      const result = decodeResult(modelCatalogSchema, parsed)
      if (!result.success || !result.data.models.length) {
        this.db.prepare('DELETE FROM model_catalog_cache WHERE key=?').run(key)
        return null
      }
      const value = modelCatalogPresentation(result.data)
      this.presentations.set(key, value)
      this.trim(this.presentations)
      return value
    } catch {
      console.warn('Could not restore model catalog presentation')
      return null
    }
  }

  private save(key: string, value: ModelCatalog) {
    const presentation = modelCatalogPresentation(value)
    this.presentations.delete(key)
    this.presentations.set(key, presentation)
    this.trim(this.presentations)
    if (!this.durable) return
    try {
      this.db.transaction(() => {
        this.db
          .prepare('INSERT OR REPLACE INTO model_catalog_cache(key,value,updated) VALUES(?,?,?)')
          .run(key, JSON.stringify(presentation), Date.now())
        this.trimStored()
      })()
    } catch {
      console.warn('Could not save model catalog presentation')
    }
  }

  get(
    key: string,
    load: () => Promise<ModelCatalog>,
    refresh = false,
    validate: () => void = () => {},
  ): Promise<ModelCatalog> {
    try {
      validate()
    } catch (error) {
      return Promise.reject(error)
    }
    const running = this.pending.get(key)
    if (running)
      return running.then((value) => {
        validate()
        return value
      })
    const cached = this.entries.get(key)
    if (!refresh && cached && cached.expires > Date.now()) return Promise.resolve(cached.value)
    if (this.pending.size >= limit)
      return Promise.reject(new Error('Too many model discoveries in progress'))
    // Failed/empty refreshes invalidate readiness, while preserving last-good display metadata.
    this.entries.delete(key)
    const request = Promise.resolve()
      .then(load)
      .then((loaded) => {
        const value = decode(modelCatalogSchema, loaded)
        validate()
        if (value.models.length) {
          this.entries.set(key, { expires: Date.now() + ttl, value })
          this.trim(this.entries)
          this.save(key, value)
        }
        return value
      })
      .finally(() => this.pending.delete(key))
    this.pending.set(key, request)
    return request
  }
}
