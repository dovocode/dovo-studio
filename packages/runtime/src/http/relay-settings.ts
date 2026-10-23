import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  runtimeConnectionModeSchema,
  type RuntimeConnectionMode,
  customTurnSchema,
  normalizeTurnUrl,
  type CustomTurn,
  type PeerRelay,
  type RelaySettings,
} from '@dovo/protocol'

/** Secrets stay in the private runtime database; snapshots expose only status and URLs. */
export class RuntimeRelaySettings {
  private organization?: { name: string; relay?: PeerRelay; lease: number }
  constructor(private readonly db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS relay_settings(id INTEGER PRIMARY KEY CHECK(id=1), mode TEXT NOT NULL, config TEXT)',
    )
    if (
      !db
        .prepare(
          "SELECT name FROM pragma_table_info('relay_settings') WHERE name='connection_mode'",
        )
        .get()
    )
      db.exec(
        "ALTER TABLE relay_settings ADD COLUMN connection_mode TEXT NOT NULL DEFAULT 'automatic'",
      )
    db.prepare(
      "INSERT OR IGNORE INTO relay_settings(id,mode,config) VALUES(1,'default',NULL)",
    ).run()
  }
  connectionMode(): RuntimeConnectionMode {
    return decode(
      Schema.Struct({ connection_mode: runtimeConnectionModeSchema }),
      this.db.prepare('SELECT connection_mode FROM relay_settings WHERE id=1').get(),
    ).connection_mode
  }
  setConnectionMode(mode: RuntimeConnectionMode) {
    this.db
      .prepare('UPDATE relay_settings SET connection_mode=? WHERE id=1')
      .run(decode(runtimeConnectionModeSchema, mode))
    return this.status()
  }
  private saved() {
    const row = decode(
      Schema.Struct({ mode: Schema.String, config: Schema.NullOr(Schema.String) }),
      this.db.prepare('SELECT mode,config FROM relay_settings WHERE id=1').get(),
    )
    return {
      mode: row?.mode === 'custom' ? ('custom' as const) : ('default' as const),
      config:
        typeof row?.config === 'string'
          ? decode(customTurnSchema, JSON.parse(row.config))
          : undefined,
    }
  }
  status(): RelaySettings {
    const saved = this.saved()
    const organization = this.organization
    const connectionMode = this.connectionMode()
    if (saved.mode === 'custom' && saved.config)
      return { mode: 'custom', configured: true, urls: saved.config.urls, connectionMode }
    if (organization)
      return {
        mode: 'organization',
        connectionMode,
        configured:
          organization.lease > Date.now() &&
          !!organization.relay &&
          organization.relay.expiresAt > Date.now() + 60_000,
        urls: organization.relay?.iceServers.flatMap((server) => server.urls) ?? [],
        organization: organization.name,
      }
    return { mode: 'default', configured: false, urls: [], connectionMode }
  }
  set(config?: CustomTurn) {
    const normalized = config && {
      ...decode(customTurnSchema, config),
      urls: [...new Set(config.urls.map(normalizeTurnUrl))],
    }
    this.db
      .prepare('UPDATE relay_settings SET mode=?,config=? WHERE id=1')
      .run(normalized ? 'custom' : 'default', normalized ? JSON.stringify(normalized) : null)
    return this.status()
  }
  setOrganization(value?: { name: string; relay?: PeerRelay; lease: number }) {
    this.organization = value
  }
  issue(now = Date.now()): PeerRelay | undefined {
    if (this.connectionMode() !== 'automatic') return undefined
    const saved = this.saved()
    if (saved.mode === 'custom' && saved.config)
      return { provider: 'custom', expiresAt: now + 10 * 60_000, iceServers: [saved.config] }
    const organization = this.organization
    return organization?.relay &&
      organization.lease > now &&
      organization.relay.expiresAt > now + 60_000
      ? organization.relay
      : undefined
  }
}
