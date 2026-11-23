import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import {
  decode,
  mutableStruct,
  studioSourcePolicySchema,
  type StudioSourcePolicy,
} from '@dovo/protocol'
import { Schema } from 'effect'

export const sourcePolicyTarget = (target: unknown) =>
  createHash('sha256').update(JSON.stringify(target)).digest('hex')
const off: StudioSourcePolicy = { access: 'off', autoLoad: false }
const table = `CREATE TABLE IF NOT EXISTS studio_source_policies (
  owner TEXT NOT NULL, id TEXT NOT NULL, source TEXT NOT NULL, target TEXT NOT NULL,
  policy TEXT NOT NULL, PRIMARY KEY(owner,id,source))`
const savedPolicy = mutableStruct({
  owner: Schema.String,
  id: Schema.String,
  source: Schema.String,
  target: Schema.String,
  policy: Schema.String,
})

export function preserveSourcePolicies(staged: Database.Database, current: Database.Database) {
  staged.exec(table)
  staged.exec('DELETE FROM studio_source_policies')
  if (
    !current
      .prepare("SELECT 1 FROM sqlite_master WHERE name='studio_source_policies' AND type='table'")
      .get()
  )
    return
  const insert = staged.prepare('INSERT INTO studio_source_policies VALUES (?,?,?,?,?)')
  for (const row of current.prepare('SELECT * FROM studio_source_policies').iterate()) {
    const value = decode(savedPolicy, row)
    insert.run(value.owner, value.id, value.source, value.target, value.policy)
  }
}

export class SourcePolicies {
  private readonly sessions = new Map<
    string,
    { id: string; sourceId: string; target: string; policy: StudioSourcePolicy }
  >()
  constructor(
    private readonly db: Database.Database,
    private readonly owner: 'dashboard' | 'extension',
  ) {
    db.exec(table)
  }

  read(id: string, sourceId: string, target: string): StudioSourcePolicy {
    const key = JSON.stringify([id, sourceId])
    const session = this.sessions.get(key)
    if (session?.target === target) return session.policy
    const saved = this.db
      .prepare(
        'SELECT policy FROM studio_source_policies WHERE owner=? AND id=? AND source=? AND target=?',
      )
      .pluck()
      .get(this.owner, id, sourceId, target)
    return typeof saved === 'string' ? decode(studioSourcePolicySchema, JSON.parse(saved)) : off
  }

  save(id: string, sourceId: string, target: string, policy: StudioSourcePolicy) {
    const key = JSON.stringify([id, sourceId])
    if (policy.access === 'persistent') {
      this.db
        .prepare(`INSERT INTO studio_source_policies VALUES (?,?,?,?,?)
        ON CONFLICT(owner,id,source) DO UPDATE SET target=excluded.target,policy=excluded.policy`)
        .run(this.owner, id, sourceId, target, JSON.stringify(policy))
    } else {
      this.db
        .prepare('DELETE FROM studio_source_policies WHERE owner=? AND id=? AND source=?')
        .run(this.owner, id, sourceId)
    }
    this.sessions.delete(key)
    if (policy.access === 'session') this.sessions.set(key, { id, sourceId, target, policy })
    return policy.access === 'off' ? off : policy
  }

  clear(id: string, sourceId?: string) {
    this.db
      .prepare(
        'DELETE FROM studio_source_policies WHERE owner=? AND id=? AND (? IS NULL OR source=?)',
      )
      .run(this.owner, id, sourceId ?? null, sourceId ?? null)
    for (const [key, saved] of this.sessions) {
      if (saved.id === id && (sourceId === undefined || saved.sourceId === sourceId))
        this.sessions.delete(key)
    }
  }
}
