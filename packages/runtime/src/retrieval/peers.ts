import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import { decode, mutableArray, mutableStruct, studioPeerRegistrationSchema } from '@dovo/protocol'
import type { Devices } from '../auth/devices.js'
import { HttpError } from '../errors.js'

const rows = mutableArray(mutableStruct({ device: Schema.String, value: Schema.String }))
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
    return { ok: true }
  }
  list() {
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
        continue
      }
      const registration = decode(studioPeerRegistrationSchema, JSON.parse(row.value))
      for (const peer of registration.peers) peers.set(peer.connection.runtimeId ?? peer.id, peer)
    }
    return [...peers.values()]
  }
}
