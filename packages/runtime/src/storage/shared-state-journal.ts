import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import { decode, isRuntimeStateSource } from '@dovo/protocol'
import type { StateStorage } from '@dovo/durable-connections'

const envelope = Schema.Struct({
  protocol: Schema.Literal(1),
  channel: Schema.Literal('shared-settings:v1'),
  replicaId: Schema.String,
  journal: Schema.Array(
    Schema.Struct({
      sequence: Schema.Int,
      version: Schema.Struct({
        key: Schema.String,
        updatedAt: Schema.Int,
        changeId: Schema.String,
        deleted: Schema.Literal(false),
        value: Schema.Unknown,
      }),
    }),
  ),
  checkpoints: Schema.Record(Schema.String, Schema.Int),
  sources: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})
const rows = Schema.Array(Schema.Struct({ sequence: Schema.Int, value: Schema.String }))

/** Single-writer SQLite journal. Keep the legacy document intact after migration. */
export function sharedStateJournal(
  db: Database.Database,
  runtimeId: string,
  source: string,
): StateStorage {
  db.exec(
    'CREATE TABLE IF NOT EXISTS shared_state_log (sequence INTEGER PRIMARY KEY, value TEXT NOT NULL)',
  )
  const checkpointId = 'shared-state-checkpoints:v1'
  const sourceId = 'shared-state-sources:v1'
  const readDocument = (id: string): unknown => {
    const raw = db.prepare('SELECT value FROM documents WHERE id=?').pluck().get(id)
    return raw === undefined ? undefined : JSON.parse(decode(Schema.String, raw))
  }
  const writeCheckpoints = (value: Readonly<Record<string, number>>) => {
    db.prepare(
      'INSERT INTO documents VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
    ).run(checkpointId, JSON.stringify(value))
  }
  if (readDocument('shared-state-journal-migrated:v1') !== true) {
    const legacy = readDocument('durable-state:shared-settings:v1')
    db.transaction(() => {
      if (legacy !== undefined) {
        const snapshot = decode(envelope, legacy)
        if (!isRuntimeStateSource(snapshot.replicaId, runtimeId))
          throw new Error('Stored settings journal belongs to a different runtime')
        const insert = db.prepare('INSERT INTO shared_state_log VALUES (?,?)')
        for (const [index, change] of snapshot.journal.entries()) {
          if (change.sequence !== index + 1) throw new Error('Invalid shared settings sequence')
          insert.run(change.sequence, JSON.stringify(change.version))
        }
        writeCheckpoints(source === snapshot.replicaId ? snapshot.checkpoints : {})
        if (snapshot.sources)
          db.prepare('INSERT OR REPLACE INTO documents VALUES (?,?)').run(
            sourceId,
            JSON.stringify(snapshot.sources),
          )
      }
      db.prepare('INSERT INTO documents VALUES (?,?)').run(
        'shared-state-journal-migrated:v1',
        'true',
      )
    })()
  }
  const count = () =>
    decode(
      Schema.Int,
      db.prepare('SELECT COALESCE(MAX(sequence),0) FROM shared_state_log').pluck().get(),
    )
  const read = (after: number) => {
    const revision = count()
    if (revision < after) throw new Error('Shared settings journal history changed')
    const changes = decode(
      rows,
      db
        .prepare('SELECT sequence,value FROM shared_state_log WHERE sequence>? ORDER BY sequence')
        .all(after),
    )
    if (changes.length !== revision - after)
      throw new Error('Shared settings journal history changed')
    return {
      protocol: 1,
      channel: 'shared-settings:v1',
      replicaId: source,
      after,
      journal: changes.map((row) => ({ sequence: row.sequence, version: JSON.parse(row.value) })),
      checkpoints: readDocument(checkpointId) ?? {},
      sources: readDocument(sourceId),
    }
  }
  const append: NonNullable<StateStorage['append']> = (after, changes, checkpoints, sources) => {
    db.transaction(() => {
      if (count() !== after) throw new Error('Shared settings journal history changed')
      const insert = db.prepare('INSERT INTO shared_state_log VALUES (?,?)')
      for (const [index, change] of changes.entries()) {
        if (change.sequence !== after + index + 1)
          throw new Error('Invalid shared settings sequence')
        insert.run(change.sequence, JSON.stringify(change.version))
      }
      writeCheckpoints(checkpoints)
      db.prepare(
        'INSERT INTO documents VALUES (?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      ).run(sourceId, JSON.stringify(sources ?? {}))
    })()
  }
  return {
    load: () => read(0),
    readChanges: read,
    append,
    save: (value) => {
      const snapshot = decode(envelope, value)
      if (snapshot.replicaId !== source) throw new Error('Shared settings journal identity changed')
      const after = count()
      if (snapshot.journal.length < after)
        throw new Error('Shared settings journal history changed')
      return append(after, snapshot.journal.slice(after), snapshot.checkpoints, snapshot.sources)
    },
  }
}
