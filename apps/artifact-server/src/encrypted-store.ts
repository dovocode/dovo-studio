import { createHash } from 'node:crypto'
import { Schema } from 'effect'
import {
  decode,
  shareRecordSchema,
  encryptedSuggestionSchema,
  verifySharePacket,
  type ShareRecord,
  type SharePacket,
  type EncryptedSuggestion,
} from '@dovo/protocol'
import { ArtifactStore, ShareError } from './store.js'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const unavailable = () => new ShareError(404, 'Shared content unavailable or access not granted')

/** No content, recipient keys, prompts or titles are decrypted by the hosting service. */
export class EncryptedShareStore {
  constructor(private readonly artifacts: ArtifactStore) {
    artifacts.db.exec(`CREATE TABLE IF NOT EXISTS encrypted_shares(
      id TEXT PRIMARY KEY,owner TEXT NOT NULL,source TEXT NOT NULL,record TEXT NOT NULL,bytes INTEGER NOT NULL,
      UNIQUE(owner,source));
      CREATE TABLE IF NOT EXISTS encrypted_suggestions(
      share TEXT NOT NULL REFERENCES encrypted_shares(id) ON DELETE CASCADE,id TEXT NOT NULL,
      body TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(share,id));`)
  }
  get(id: string) {
    const row = this.artifacts.db
      .prepare('SELECT owner,record FROM encrypted_shares WHERE id=?')
      .get(id)
    if (!row) throw unavailable()
    const value = decode(Schema.Struct({ owner: Schema.String, record: Schema.String }), row)
    return { owner: value.owner, record: decode(shareRecordSchema, JSON.parse(value.record)) }
  }
  own(id: string, owner: string) {
    const saved = this.get(id)
    if (saved.owner !== owner) throw unavailable()
    return saved.record
  }
  list(owner: string) {
    return this.artifacts.db
      .prepare('SELECT record FROM encrypted_shares WHERE owner=? ORDER BY rowid DESC')
      .all(owner)
      .map((row) => {
        const value = decode(Schema.Struct({ record: Schema.String }), row)
        const record = decode(shareRecordSchema, JSON.parse(value.record))
        return {
          id: record.id,
          source: record.source,
          kind: record.kind,
          version: record.version,
          updatedAt: record.updatedAt,
          ownerBox: record.ownerBox,
        }
      })
  }
  save(owner: string, expectedVersion: number, input: ShareRecord) {
    const record = decode(shareRecordSchema, input)
    if (
      new Set(record.grants.map((grant) => grant.id)).size !== record.grants.length ||
      record.grants.some((grant) =>
        grant.userId
          ? !!grant.tokenHash || !!grant.expiresAt
          : !grant.tokenHash ||
            !grant.expiresAt ||
            grant.expiresAt <= this.artifacts.now() ||
            grant.expiresAt > this.artifacts.now() + 30 * 86400000,
      )
    )
      throw new ShareError(400, 'Invalid sharing permissions')
    if (
      record.grants.filter((grant) => grant.userId).length > 100 ||
      record.grants.filter((grant) => !grant.userId).length > 10
    )
      throw new ShareError(400, 'Sharing limit reached')
    if (!verifySharePacket(record.id, record.packet, record.signingKey))
      throw new ShareError(400, 'Invalid content signature')
    const db = this.artifacts.db
    db.exec('BEGIN IMMEDIATE')
    try {
      const previous = db
        .prepare('SELECT owner,record FROM encrypted_shares WHERE id=?')
        .get(record.id)
      if (previous) {
        const saved = this.own(record.id, owner)
        if (saved.version !== expectedVersion)
          throw new ShareError(409, 'Sharing changed. Refresh before trying again')
        if (
          saved.source !== record.source ||
          saved.kind !== record.kind ||
          saved.signingKey !== record.signingKey
        )
          throw new ShareError(400, 'Sharing identity cannot change')
      } else if (expectedVersion !== 0) throw unavailable()
      if (
        db
          .prepare('SELECT id FROM encrypted_shares WHERE owner=? AND source=? AND id<>?')
          .get(owner, record.source, record.id)
      )
        throw new ShareError(409, 'Sharing changed. Refresh before trying again')
      const saved = { ...record, version: expectedVersion + 1, updatedAt: this.artifacts.now() }
      const body = JSON.stringify(saved),
        bytes = Buffer.byteLength(body)
      const ownerBytes = Number(
        db
          .prepare(
            'SELECT coalesce(sum(bytes),0) AS n FROM encrypted_shares WHERE owner=? AND id<>?',
          )
          .get(owner, record.id)?.n,
      )
      const allBytes = Number(
        db
          .prepare('SELECT coalesce(sum(bytes),0) AS n FROM encrypted_shares WHERE id<>?')
          .get(record.id)?.n,
      )
      const legacyOwner = Number(
        db.prepare('SELECT coalesce(sum(bytes),0) AS n FROM publications WHERE owner=?').get(owner)
          ?.n,
      )
      const legacyTotal = Number(
        db.prepare('SELECT coalesce(sum(bytes),0) AS n FROM publications').get()?.n,
      )
      const feedsOwner = Number(
        db
          .prepare(
            'SELECT coalesce(sum(f.bytes),0) AS n FROM feeds f JOIN publications p ON p.id=f.publication WHERE p.owner=?',
          )
          .get(owner)?.n,
      )
      const feedsTotal = Number(
        db.prepare('SELECT coalesce(sum(bytes),0) AS n FROM feeds').get()?.n,
      )
      const suggestionsOwner = Number(
        db
          .prepare(
            'SELECT coalesce(sum(length(s.body)),0) AS n FROM encrypted_suggestions s JOIN encrypted_shares p ON p.id=s.share WHERE p.owner=?',
          )
          .get(owner)?.n,
      )
      const suggestionsTotal = Number(
        db.prepare('SELECT coalesce(sum(length(body)),0) AS n FROM encrypted_suggestions').get()?.n,
      )
      const count = Number(
        db
          .prepare('SELECT count(*) AS n FROM encrypted_shares WHERE owner=? AND id<>?')
          .get(owner, record.id)?.n,
      )
      if (
        bytes > 28 * 1024 * 1024 ||
        ownerBytes + legacyOwner + feedsOwner + suggestionsOwner + bytes >
          this.artifacts.accountBytes ||
        allBytes + legacyTotal + feedsTotal + suggestionsTotal + bytes >
          this.artifacts.totalBytes ||
        count >= 100
      )
        throw new ShareError(413, 'Hosted sharing storage limit reached')
      db.prepare(
        'INSERT INTO encrypted_shares VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record,bytes=excluded.bytes',
      ).run(record.id, owner, record.source, body, bytes)
      db.exec('COMMIT')
      return saved
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  read(id: string, access: string, user?: string, token?: string) {
    const record = this.get(id).record
    const grant = record.grants.find(
      (grant) =>
        grant.id === access &&
        (grant.userId
          ? grant.userId === user
          : !!token &&
            grant.tokenHash === digest(token) &&
            (grant.expiresAt ?? 0) > this.artifacts.now()),
    )
    if (!grant) throw unavailable()
    return {
      id,
      kind: record.kind,
      version: record.version,
      updatedAt: record.updatedAt,
      paused: record.paused,
      packet: record.packet,
      box: grant.box,
    }
  }
  writer(id: string, token: string) {
    const saved = this.get(id)
    if (
      !saved.record.writerHash ||
      saved.record.writerHash !== digest(token) ||
      saved.record.paused
    )
      throw new ShareError(401, 'Sharing updates are paused or revoked')
    return saved
  }
  update(id: string, token: string, expectedVersion: number, packet: SharePacket) {
    const saved = this.writer(id, token)
    if (packet.generation !== saved.record.packet.generation)
      throw new ShareError(409, 'Sharing keys changed')
    return this.save(saved.owner, expectedVersion, { ...saved.record, packet })
  }
  suggest(id: string, value: EncryptedSuggestion) {
    const { record, owner } = this.get(id)
    if (record.kind !== 'thread') throw new ShareError(400, 'Only threads accept suggestions')
    const input = decode(encryptedSuggestionSchema, value)
    const body = JSON.stringify(input)
    if (Buffer.byteLength(body) > 100000) throw new ShareError(413, 'Suggestion is too large')
    const previous = this.artifacts.db
      .prepare('SELECT body FROM encrypted_suggestions WHERE share=? AND id=?')
      .get(id, input.id)
    if (previous) {
      if (previous.body !== body) throw new ShareError(409, 'Suggestion already exists')
      return
    }
    const count = Number(
      this.artifacts.db
        .prepare('SELECT count(*) AS n FROM encrypted_suggestions WHERE share=?')
        .get(id)?.n,
    )
    if (count >= 100) throw new ShareError(429, 'The suggestion inbox is full')
    const legacyOwner = Number(
      this.artifacts.db
        .prepare('SELECT coalesce(sum(bytes),0) AS n FROM publications WHERE owner=?')
        .get(owner)?.n,
    )
    const legacyTotal = Number(
      this.artifacts.db.prepare('SELECT coalesce(sum(bytes),0) AS n FROM publications').get()?.n,
    )
    const feedsOwner = Number(
      this.artifacts.db
        .prepare(
          'SELECT coalesce(sum(f.bytes),0) AS n FROM feeds f JOIN publications p ON p.id=f.publication WHERE p.owner=?',
        )
        .get(owner)?.n,
    )
    const feedsTotal = Number(
      this.artifacts.db.prepare('SELECT coalesce(sum(bytes),0) AS n FROM feeds').get()?.n,
    )
    if (
      legacyOwner + feedsOwner + this.artifacts.encryptedBytes(owner) + Buffer.byteLength(body) >
        this.artifacts.accountBytes ||
      legacyTotal + feedsTotal + this.artifacts.encryptedBytes() + Buffer.byteLength(body) >
        this.artifacts.totalBytes
    )
      throw new ShareError(413, 'Hosted sharing storage limit reached')
    this.artifacts.db
      .prepare('INSERT INTO encrypted_suggestions VALUES(?,?,?,?)')
      .run(id, input.id, body, this.artifacts.now())
  }
  suggestions(id: string, owner: string) {
    this.own(id, owner)
    return this.artifacts.db
      .prepare('SELECT body FROM encrypted_suggestions WHERE share=? ORDER BY created')
      .all(id)
      .map((row) =>
        decode(
          encryptedSuggestionSchema,
          JSON.parse(decode(Schema.Struct({ body: Schema.String }), row).body),
        ),
      )
  }
  dismiss(id: string, owner: string, suggestion: string) {
    this.own(id, owner)
    this.artifacts.db
      .prepare('DELETE FROM encrypted_suggestions WHERE share=? AND id=?')
      .run(id, suggestion)
  }
  remove(id: string, owner: string) {
    this.own(id, owner)
    this.artifacts.db.prepare('DELETE FROM encrypted_shares WHERE id=?').run(id)
  }
  owners() {
    return this.artifacts.db
      .prepare('SELECT DISTINCT owner FROM encrypted_shares')
      .all()
      .map((row) => String(row.owner))
  }
  removeOwner(owner: string) {
    this.artifacts.db.prepare('DELETE FROM encrypted_shares WHERE owner=?').run(owner)
  }
}
