import type Database from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { Schema } from 'effect'
import { decode, mutableArray, mutableStruct, studioPeerRegistrationSchema } from '@dovo/protocol'
import type { Devices } from '../auth/devices.js'
import { HttpError } from '../errors.js'

const rows = mutableArray(mutableStruct({ device: Schema.String, value: Schema.String }))
const peerKey = (peer: (typeof studioPeerRegistrationSchema.Type.peers)[number]) =>
  createHash('sha256')
    .update(JSON.stringify([peer.id, peer.connection]))
    .digest('hex')
/** Runtime-private pairing credentials, retained for always-on work after Studio disconnects.
 * Removing a pairing from Studio replaces its registration; revoking its registering device
 * removes the entire contribution. These credentials are never returned by an endpoint. */
export class RetrievalPeers {
  constructor(
    private db: Database.Database,
    private devices: Devices,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS retrieval_peers (device TEXT PRIMARY KEY, value TEXT NOT NULL)',
    )
    // Grants contain fingerprints only; credentials stay in the existing pairing registry.
    db.exec(
      'CREATE TABLE IF NOT EXISTS studio_peer_grants (device TEXT PRIMARY KEY, value TEXT NOT NULL)',
    )
  }
  registerStudio(device: string, value: unknown) {
    const input = decode(studioPeerRegistrationSchema, value)
    return this.db.transaction(() => {
      this.register(device, input)
      this.db
        .prepare('INSERT OR REPLACE INTO studio_peer_grants VALUES (?,?)')
        .run(device, JSON.stringify(input.peers.map(peerKey)))
      return { ok: true }
    })()
  }
  register(device: string, value: unknown) {
    const input = decode(studioPeerRegistrationSchema, value)
    if (
      new Set(input.peers.map((peer) => peer.id)).size !== input.peers.length ||
      input.peers.some((peer) => peer.id === 'local')
    )
      throw new HttpError(400, 'Paired computer IDs must be unique and cannot be local')
    this.list()
    const count = this.db.prepare('SELECT COUNT(*) FROM retrieval_peers').pluck().get()
    if (
      typeof count === 'number' &&
      count >= 32 &&
      !this.db.prepare('SELECT device FROM retrieval_peers WHERE device=?').get(device)
    )
      throw new HttpError(429, 'Too many retrieval pairing registrations')
    const serialized = JSON.stringify(input)
    const previous = this.db
      .prepare('SELECT value FROM retrieval_peers WHERE device=?')
      .pluck()
      .get(device)
    if (previous !== serialized)
      this.db.prepare('INSERT OR REPLACE INTO retrieval_peers VALUES (?,?)').run(device, serialized)
    const grant = this.studioGrant(device)
    if (grant) {
      const current = new Set(input.peers.map(peerKey))
      this.db
        .prepare('UPDATE studio_peer_grants SET value=? WHERE device=?')
        .run(JSON.stringify(grant.filter((key) => current.has(key))), device)
    }
    return { ok: true }
  }
  private studioGrant(device: string) {
    const value = this.db
      .prepare('SELECT value FROM studio_peer_grants WHERE device=?')
      .pluck()
      .get(device)
    return typeof value === 'string'
      ? decode(Schema.Array(Schema.String), JSON.parse(value))
      : undefined
  }
  list(studioOnly = false) {
    const valid = new Set([
      'owner',
      ...this.devices
        .list()
        .filter((device) => !device.revokedAt)
        .map((device) => device.id),
    ])
    const peers = new Map<string, (typeof studioPeerRegistrationSchema.Type.peers)[number]>()
    for (const row of decode(
      rows,
      this.db.prepare('SELECT device,value FROM retrieval_peers ORDER BY device').all(),
    )) {
      if (!valid.has(row.device)) {
        this.db.prepare('DELETE FROM retrieval_peers WHERE device=?').run(row.device)
        this.db.prepare('DELETE FROM studio_peer_grants WHERE device=?').run(row.device)
        continue
      }
      const registration = decode(studioPeerRegistrationSchema, JSON.parse(row.value))
      const grant = studioOnly ? new Set(this.studioGrant(row.device) ?? []) : undefined
      for (const peer of registration.peers)
        if (!grant || grant.has(peerKey(peer)))
          peers.set(peer.connection.runtimeId ?? peer.id, peer)
    }
    return [...peers.values()]
  }
}
