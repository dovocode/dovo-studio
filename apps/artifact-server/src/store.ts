import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  artifactPublicationSchema,
  artifactPublicationInputSchema,
  artifactAccessSchema,
  HOSTED_ARTIFACT_MAX_BYTES,
  type ArtifactPublicationInput,
  ARTIFACT_FEED_MAX_BYTES,
} from '@dovo/protocol'

export class ShareError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
const hash = (value: string) => createHash('sha256').update(value).digest('base64url')
const publicationRow = mutableStruct({
  owner: Schema.String,
  body: Schema.String,
  metadata: Schema.String,
})
export class ArtifactStore {
  readonly db: DatabaseSync
  constructor(
    path: string,
    readonly now = Date.now,
    readonly accountBytes = 100 * 1024 * 1024,
    readonly totalBytes = 5 * 1024 * 1024 * 1024,
  ) {
    this.db = new DatabaseSync(path)
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS publications(id TEXT PRIMARY KEY,owner TEXT NOT NULL,source TEXT NOT NULL,
      revision INTEGER NOT NULL,metadata TEXT NOT NULL,body TEXT NOT NULL,bytes INTEGER NOT NULL,
      UNIQUE(owner,source,revision));
      CREATE TABLE IF NOT EXISTS invites(publication TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      user TEXT NOT NULL,PRIMARY KEY(publication,user));
      CREATE TABLE IF NOT EXISTS links(id TEXT PRIMARY KEY,publication TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS publication_owner ON publications(owner);
      CREATE TABLE IF NOT EXISTS feeds(publication TEXT PRIMARY KEY REFERENCES publications(id) ON DELETE CASCADE,
      generation TEXT NOT NULL,writer TEXT NOT NULL,expires INTEGER NOT NULL,seconds INTEGER NOT NULL,
      data TEXT NOT NULL,bytes INTEGER NOT NULL,updated INTEGER NOT NULL);`)
  }
  /** Encrypted copies share the same disk budget as legacy documents and live feeds. */
  encryptedBytes(owner?: string) {
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='encrypted_shares'").get())
      return 0
    const scope = owner === undefined ? '' : ' WHERE owner=?'
    const content = this.db
      .prepare('SELECT coalesce(sum(bytes),0) AS n FROM encrypted_shares' + scope)
      .get(...(owner === undefined ? [] : [owner]))
    const suggestions = this.db
      .prepare(
        'SELECT coalesce(sum(length(s.body)),0) AS n FROM encrypted_suggestions s JOIN encrypted_shares p ON p.id=s.share' +
          (owner === undefined ? '' : ' WHERE p.owner=?'),
      )
      .get(...(owner === undefined ? [] : [owner]))
    return Number(content?.n) + Number(suggestions?.n)
  }
  publish(owner: string, input: ArtifactPublicationInput) {
    const body = JSON.stringify(decode(artifactPublicationInputSchema, input)),
      bytes = Buffer.byteLength(body)
    if (bytes > HOSTED_ARTIFACT_MAX_BYTES)
      throw new ShareError(413, 'Hosted artifacts are limited to 20 MB, including source files')
    return this.create(owner, input, body, bytes)
  }
  private create(owner: string, input: ArtifactPublicationInput, body: string, bytes: number) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const previous = this.db
        .prepare(
          'SELECT id,body,metadata FROM publications WHERE owner=? AND source=? AND revision=?',
        )
        .get(owner, input.sourceId, input.revision)
      if (previous) {
        if (previous.body !== body)
          throw new ShareError(
            409,
            'This saved version was already published with different content',
          )
        if (typeof previous.metadata !== 'string') throw new Error('Invalid stored publication')
        this.db.exec('COMMIT')
        return decode(artifactPublicationSchema, JSON.parse(previous.metadata))
      }
      const own = this.db
        .prepare(
          'SELECT count(*) AS count,coalesce(sum(bytes),0) AS bytes FROM publications WHERE owner=?',
        )
        .get(owner)
      const total = this.db
        .prepare('SELECT coalesce(sum(bytes),0) AS bytes FROM publications')
        .get()
      if (
        Number(own?.count) >= 100 ||
        Number(own?.bytes) + this.feedBytes(owner) + this.encryptedBytes(owner) + bytes >
          this.accountBytes ||
        Number(total?.bytes) + this.feedBytes() + this.encryptedBytes() + bytes > this.totalBytes
      )
        throw new ShareError(
          413,
          'Artifact storage quota reached. Delete a hosted copy before publishing more',
        )
      const metadata = {
        id: randomUUID(),
        title: input.title,
        format: input.format,
        revision: input.revision,
        createdAt: new Date(this.now()).toISOString(),
      }
      this.db
        .prepare('INSERT INTO publications VALUES(?,?,?,?,?,?,?)')
        .run(
          metadata.id,
          owner,
          input.sourceId,
          input.revision,
          JSON.stringify(metadata),
          body,
          bytes,
        )
      this.db.exec('COMMIT')
      return metadata
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  get(id: string) {
    const raw = this.db.prepare('SELECT owner,body,metadata FROM publications WHERE id=?').get(id)
    if (!raw) throw new ShareError(404, 'Artifact unavailable or access not granted')
    const row = decode(publicationRow, raw)
    return {
      owner: row.owner,
      publication: decode(artifactPublicationSchema, JSON.parse(row.metadata)),
      artifact: decode(artifactPublicationInputSchema, JSON.parse(row.body)),
    }
  }
  metadata(id: string) {
    const row = this.db.prepare('SELECT owner,metadata FROM publications WHERE id=?').get(id)
    if (typeof row?.owner !== 'string' || typeof row.metadata !== 'string')
      throw new ShareError(404, 'Artifact unavailable or access not granted')
    return {
      owner: row.owner,
      publication: decode(artifactPublicationSchema, JSON.parse(row.metadata)),
    }
  }
  list(owner: string) {
    return this.db
      .prepare('SELECT metadata FROM publications WHERE owner=? ORDER BY rowid DESC')
      .all(owner)
      .map((row) => {
        if (typeof row.metadata !== 'string') throw new Error('Invalid stored publication')
        return decode(artifactPublicationSchema, JSON.parse(row.metadata))
      })
  }
  sources(owner: string) {
    return this.db
      .prepare('SELECT source,metadata FROM publications WHERE owner=? ORDER BY rowid DESC')
      .all(owner)
      .map((row) => {
        const value = decode(Schema.Struct({ source: Schema.String, metadata: Schema.String }), row)
        return {
          ...decode(artifactPublicationSchema, JSON.parse(value.metadata)),
          sourceId: value.source,
        }
      })
  }
  own(id: string, user: string) {
    const publication = this.metadata(id)
    if (publication.owner !== user)
      throw new ShareError(404, 'Artifact unavailable or access not granted')
    return publication
  }
  canView(id: string, user?: string, token?: string) {
    const publication = this.metadata(id)
    return (
      publication.owner === user ||
      (!!user &&
        !!this.db.prepare('SELECT 1 FROM invites WHERE publication=? AND user=?').get(id, user)) ||
      (!!token &&
        !!this.db
          .prepare('SELECT 1 FROM links WHERE publication=? AND token=? AND expires>?')
          .get(id, hash(token), this.now()))
    )
  }
  access(id: string, user: string) {
    this.own(id, user)
    this.prune()
    return decode(artifactAccessSchema, {
      invites: this.db
        .prepare('SELECT user AS userId FROM invites WHERE publication=? ORDER BY user')
        .all(id),
      links: this.db
        .prepare('SELECT id,expires AS expiresAt FROM links WHERE publication=? ORDER BY expires')
        .all(id),
      feed: this.db
        .prepare('SELECT generation,seconds,expires AS expiresAt FROM feeds WHERE publication=?')
        .get(id),
    })
  }
  invite(id: string, owner: string, user: string) {
    this.own(id, owner)
    if (
      Number(this.db.prepare('SELECT count(*) AS n FROM invites WHERE publication=?').get(id)?.n) >=
      100
    )
      throw new ShareError(429, 'At most 100 invited accounts per artifact')
    this.db.prepare('INSERT OR IGNORE INTO invites VALUES(?,?)').run(id, user)
  }
  uninvite(id: string, owner: string, user: string) {
    this.own(id, owner)
    this.db.prepare('DELETE FROM invites WHERE publication=? AND user=?').run(id, user)
  }
  link(id: string, owner: string, seconds: number) {
    this.own(id, owner)
    this.prune()
    if (
      Number(this.db.prepare('SELECT count(*) AS n FROM links WHERE publication=?').get(id)?.n) >=
      10
    )
      throw new ShareError(429, 'Revoke an existing share link first (maximum 10)')
    const token = randomBytes(32).toString('base64url'),
      key = randomUUID(),
      expiresAt = this.now() + seconds * 1000
    this.db.prepare('INSERT INTO links VALUES(?,?,?,?)').run(key, id, hash(token), expiresAt)
    return { id: key, token, expiresAt }
  }
  unlink(id: string, owner: string, link: string) {
    this.own(id, owner)
    this.db.prepare('DELETE FROM links WHERE publication=? AND id=?').run(id, link)
  }
  remove(id: string, owner: string) {
    this.own(id, owner)
    this.db.prepare('DELETE FROM publications WHERE id=?').run(id)
  }
  removeOwner(owner: string) {
    this.db.prepare('DELETE FROM publications WHERE owner=?').run(owner)
  }
  owners() {
    return this.db
      .prepare('SELECT DISTINCT owner FROM publications')
      .all()
      .map((row) => String(row.owner))
  }
  prune() {
    this.db.prepare('DELETE FROM links WHERE expires<=?').run(this.now())
  }
  private feedBytes(owner?: string) {
    const row =
      owner === undefined
        ? this.db.prepare('SELECT coalesce(sum(bytes),0) AS n FROM feeds').get()
        : this.db
            .prepare(
              'SELECT coalesce(sum(f.bytes),0) AS n FROM feeds f JOIN publications p ON p.id=f.publication WHERE p.owner=?',
            )
            .get(owner)
    return Number(row?.n)
  }
  private feedBody(id: string, owner: string, value: unknown) {
    const data = JSON.stringify(value)
    if (data === undefined) throw new ShareError(400, 'Feed data must be JSON')
    const bytes = Buffer.byteLength(data)
    if (bytes > ARTIFACT_FEED_MAX_BYTES) throw new ShareError(413, 'Feed data is limited to 256 KB')
    const previous = Number(
      this.db.prepare('SELECT bytes FROM feeds WHERE publication=?').get(id)?.bytes ?? 0,
    )
    const own = Number(
      this.db
        .prepare('SELECT coalesce(sum(bytes),0) AS n FROM publications WHERE owner=?')
        .get(owner)?.n,
    )
    const total = Number(
      this.db.prepare('SELECT coalesce(sum(bytes),0) AS n FROM publications').get()?.n,
    )
    if (
      own + this.feedBytes(owner) + this.encryptedBytes(owner) + bytes - previous >
        this.accountBytes ||
      total + this.feedBytes() + this.encryptedBytes() + bytes - previous > this.totalBytes
    )
      throw new ShareError(413, 'Artifact storage quota reached')
    return { data, bytes }
  }
  feedSetup(
    id: string,
    owner: string,
    writer: string,
    expiresAt: number,
    seconds: number,
    value: unknown,
  ) {
    this.own(id, owner)
    const { data, bytes } = this.feedBody(id, owner, value),
      generation = randomUUID()
    this.db
      .prepare('INSERT OR REPLACE INTO feeds VALUES(?,?,?,?,?,?,?,?)')
      .run(id, generation, hash(writer), expiresAt, seconds, data, bytes, this.now())
    return { generation }
  }
  feedLease(id: string, owner: string, writer: string) {
    const saved = this.own(id, owner)
    const row = this.db
      .prepare(
        'SELECT generation,expires,seconds FROM feeds WHERE publication=? AND writer=? AND expires>?',
      )
      .get(id, hash(writer), this.now())
    if (
      typeof row?.generation !== 'string' ||
      typeof row.expires !== 'number' ||
      typeof row.seconds !== 'number'
    )
      throw new ShareError(401, 'Data feed was stopped or replaced')
    const source = this.db.prepare('SELECT source FROM publications WHERE id=?').get(id)
    if (typeof source?.source !== 'string') throw new Error('Invalid stored publication source')
    return {
      generation: row.generation,
      sourceId: source.source,
      revision: saved.publication.revision,
      seconds: row.seconds,
      expiresAt: row.expires,
    }
  }
  feedUpdate(id: string, owner: string, writer: string, generation: string, value: unknown) {
    const lease = this.feedLease(id, owner, writer)
    if (lease.generation !== generation) throw new ShareError(409, 'Data feed changed')
    const { data, bytes } = this.feedBody(id, owner, value)
    this.db
      .prepare('UPDATE feeds SET data=?,bytes=?,updated=? WHERE publication=? AND generation=?')
      .run(data, bytes, this.now(), id, generation)
  }
  feedData(id: string) {
    const row = this.db
      .prepare('SELECT data,updated,expires,seconds FROM feeds WHERE publication=?')
      .get(id)
    if (!row) return { enabled: false, data: null, updatedAt: null, expiresAt: null, seconds: 60 }
    if (
      typeof row.data !== 'string' ||
      typeof row.updated !== 'number' ||
      typeof row.expires !== 'number' ||
      typeof row.seconds !== 'number'
    )
      throw new Error('Invalid stored feed')
    return {
      enabled: row.expires > this.now(),
      data: JSON.parse(row.data) as unknown,
      updatedAt: row.updated,
      expiresAt: row.expires,
      seconds: row.seconds,
    }
  }
  feedStop(id: string, owner: string, generation: string) {
    this.own(id, owner)
    this.db.prepare('DELETE FROM feeds WHERE publication=? AND generation=?').run(id, generation)
  }
}
