import type { ManagedPushSubscription } from '@dovo/protocol'
import type { AccountStore } from './store.js'
import { hash, secret } from './store.js'

/** Grants are bound to the phone's account session and a single paired runtime profile. */
export class PushStore {
  constructor(private readonly accounts: AccountStore) {
    accounts.db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS push_subscriptions (
      session TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE, runtime TEXT NOT NULL, token TEXT NOT NULL UNIQUE, value TEXT NOT NULL,
      PRIMARY KEY(session,runtime));`)
  }
  subscribe(session: string, value: ManagedPushSubscription) {
    this.cleanup()
    const token = secret()
    const count = this.accounts.db
      .prepare('SELECT count(*) AS n FROM push_subscriptions WHERE session=?')
      .get(hash(session))
    const exists = this.accounts.db
      .prepare('SELECT runtime FROM push_subscriptions WHERE session=? AND runtime=?')
      .get(hash(session), value.runtimeId)
    if (Number(count?.n) >= 100 && !exists) throw new Error('Push subscription limit reached')
    this.accounts.db
      .prepare('INSERT OR REPLACE INTO push_subscriptions VALUES(?,?,?,?)')
      .run(hash(session), value.runtimeId, hash(token), JSON.stringify(value))
    return { token }
  }
  subscription(token: string): ManagedPushSubscription | undefined {
    const row = this.accounts.db
      .prepare(`SELECT p.value,s.user FROM push_subscriptions p JOIN sessions s ON s.token=p.session
      WHERE p.token=? AND s.expires>?`)
      .get(hash(token), this.accounts.now())
    if (
      typeof row?.value !== 'string' ||
      typeof row.user !== 'string' ||
      this.accounts.deleting(row.user)
    )
      return
    const value: ManagedPushSubscription = JSON.parse(row.value)
    return value
  }
  retain(session: string, runtimeIds: string[]) {
    const keep = new Set(runtimeIds)
    for (const row of this.accounts.db
      .prepare('SELECT runtime FROM push_subscriptions WHERE session=?')
      .all(hash(session)))
      if (typeof row.runtime === 'string' && !keep.has(row.runtime))
        this.accounts.db
          .prepare('DELETE FROM push_subscriptions WHERE session=? AND runtime=?')
          .run(hash(session), row.runtime)
  }
  invalidate(token: string) {
    this.accounts.db.prepare('DELETE FROM push_subscriptions WHERE token=?').run(hash(token))
  }
  cleanup() {
    this.accounts.db
      .prepare(
        'DELETE FROM push_subscriptions WHERE session NOT IN (SELECT token FROM sessions WHERE expires>?)',
      )
      .run(this.accounts.now())
  }
}
