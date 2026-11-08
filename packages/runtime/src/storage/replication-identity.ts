import type Database from 'better-sqlite3'
import { decode, runtimeStateSource, isRuntimeStateSource } from '@dovo/protocol'
import { Schema } from 'effect'

export function replicationIdentity(db: Database.Database, runtimeId: string) {
  const raw = db
    .prepare("SELECT value FROM documents WHERE id='replication-generation:v1'")
    .pluck()
    .get()
  const generation =
    raw === undefined ? undefined : decode(Schema.String, JSON.parse(decode(Schema.String, raw)))
  const source = runtimeStateSource(runtimeId, generation)
  if (!isRuntimeStateSource(source, runtimeId)) throw new Error('Invalid replication generation')
  return { generation, source }
}
