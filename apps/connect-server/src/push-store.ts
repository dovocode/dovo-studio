import type { ManagedLiveActivity, ManagedPushSubscription } from '@dovo/protocol'
import type { AccountStore } from './store.js'
import { hash, secret } from './store.js'

/** Grants are bound to the phone's account session and a single paired runtime profile. */
export class PushStore {
  constructor(private readonly accounts: AccountStore) {
    accounts.db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS push_subscriptions (
      session TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE, runtime TEXT NOT NULL, token TEXT NOT NULL UNIQUE, value TEXT NOT NULL,
      PRIMARY KEY(session,runtime));
      CREATE TABLE IF NOT EXISTS live_activity_grants (
      session TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE, runtime TEXT NOT NULL,
      activity TEXT NOT NULL, token TEXT NOT NULL UNIQUE, value TEXT NOT NULL, expires INTEGER NOT NULL,
      PRIMARY KEY(session,runtime,activity));`)
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
  subscribeActivity(session: string, value: ManagedLiveActivity) {
    this.cleanup()
    const sessionId = hash(session)
    const existing = this.accounts.db
      .prepare(
        'SELECT expires FROM live_activity_grants WHERE session=? AND runtime=? AND activity=?',
      )
      .get(sessionId, value.runtimeId, value.activityId)
    const count = this.accounts.db
      .prepare('SELECT count(*) AS n FROM live_activity_grants WHERE session=?')
      .get(sessionId)
    if (Number(count?.n) >= 8 && !existing) throw new Error('Live Activity limit reached')
    const token = secret()
    this.accounts.db
      .prepare('INSERT OR REPLACE INTO live_activity_grants VALUES(?,?,?,?,?,?)')
      .run(
        sessionId,
        value.runtimeId,
        value.activityId,
        hash(token),
        JSON.stringify(value),
        existing ? Number(existing.expires) : this.accounts.now() + 8 * 60 * 60_000,
      )
    return { token }
  }
  activity(token: string): ManagedLiveActivity | undefined {
    const row = this.accounts.db
      .prepare(`SELECT p.value,s.user FROM live_activity_grants p JOIN sessions s ON s.token=p.session
      WHERE p.token=? AND p.expires>? AND s.expires>?`)
      .get(hash(token), this.accounts.now(), this.accounts.now())
    if (
      typeof row?.value !== 'string' ||
      typeof row.user !== 'string' ||
      this.accounts.deleting(row.user)
    )
      return
    const value: ManagedLiveActivity = JSON.parse(row.value)
    return value
  }
  retainActivities(session: string, activities: Array<{ runtimeId: string; activityId: string }>) {
    const keep = new Set(
      activities.map((value) => JSON.stringify([value.runtimeId, value.activityId])),
    )
    for (const row of this.accounts.db
      .prepare('SELECT runtime,activity FROM live_activity_grants WHERE session=?')
      .all(hash(session)))
      if (!keep.has(JSON.stringify([row.runtime, row.activity])))
        this.accounts.db
          .prepare('DELETE FROM live_activity_grants WHERE session=? AND runtime=? AND activity=?')
          .run(hash(session), row.runtime, row.activity)
  }
  invalidateActivity(token: string) {
    this.accounts.db.prepare('DELETE FROM live_activity_grants WHERE token=?').run(hash(token))
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
        'DELETE FROM live_activity_grants WHERE expires<=? OR session NOT IN (SELECT token FROM sessions WHERE expires>?)',
      )
      .run(this.accounts.now(), this.accounts.now())
    this.accounts.db
      .prepare(
        'DELETE FROM push_subscriptions WHERE session NOT IN (SELECT token FROM sessions WHERE expires>?)',
      )
      .run(this.accounts.now())
  }
}
