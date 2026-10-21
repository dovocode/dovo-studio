import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
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
    db.prepare("INSERT OR IGNORE INTO relay_settings VALUES(1,'default',NULL)").run()
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
    if (saved.mode === 'custom' && saved.config)
      return { mode: 'custom', configured: true, urls: saved.config.urls }
    if (organization)
      return {
        mode: 'organization',
        configured:
          organization.lease > Date.now() &&
          !!organization.relay &&
          organization.relay.expiresAt > Date.now() + 60_000,
        urls: organization.relay?.iceServers.flatMap((server) => server.urls) ?? [],
        organization: organization.name,
      }
    return { mode: 'default', configured: false, urls: [] }
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
