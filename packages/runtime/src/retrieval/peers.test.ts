import { expect, it } from 'vite-plus/test'
import { openDatabase } from '../storage/database.js'
import { Devices } from '../auth/devices.js'
import { RetrievalPeers } from './peers.js'

it('retains pairings without a Studio session and removes revoked registrations and forgotten peers', () => {
  const db = openDatabase(':memory:')
  try {
    const devices = new Devices(db, 'owner')
    const id = devices.add('Studio', 'paired-token')
    const peers = new RetrievalPeers(db, devices)
    const input = {
      sessionId: 'session',
      peers: [
        {
          id: 'server',
          name: 'Server',
          connection: {
            address: 'http://100.64.0.2:4317',
            token: 'paired-computer-token-at-least-20-characters',
          },
        },
      ],
    }
    peers.register(id, input)
    expect(new RetrievalPeers(db, devices).list()).toHaveLength(1)
    peers.register(id, { ...input, peers: [] })
    expect(peers.list()).toEqual([])
    peers.register(id, input)
    devices.revoke(id)
    expect(peers.list()).toEqual([])
    expect(db.prepare('SELECT COUNT(*) FROM retrieval_peers').pluck().get()).toBe(0)
  } finally {
    db.close()
  }
})

it('persists local Studio grants without allowing retrieval registrations to grant or restore control', () => {
  const db = openDatabase(':memory:')
  try {
    const devices = new Devices(db, 'owner')
    const device = devices.add('Studio', 'device-token')
    const peers = new RetrievalPeers(db, devices)
    const peer = {
      id: 'server',
      name: 'Server',
      connection: {
        address: 'http://server:4317',
        token: 'private-paired-token-at-least-20-characters',
      },
    }
    const registration = { sessionId: 'desktop', peers: [peer] }
    peers.register(device, registration)
    expect(peers.list(true)).toEqual([])
    peers.registerStudio(device, registration)
    expect(new RetrievalPeers(db, devices).list(true)).toEqual([peer])
    expect(JSON.stringify(db.prepare('SELECT * FROM studio_peer_grants').all())).not.toContain(
      peer.connection.token,
    )
    peers.register(device, { ...registration, sessionId: 'refresh' })
    expect(peers.list(true)).toEqual([peer])
    const changed = {
      ...peer,
      connection: { ...peer.connection, token: 'different-private-token-at-least-20-characters' },
    }
    peers.register(device, { ...registration, peers: [changed] })
    expect(peers.list(true)).toEqual([])
    peers.register(device, registration)
    expect(peers.list(true)).toEqual([])
    peers.registerStudio(device, registration)
    peers.register(device, { ...registration, peers: [] })
    peers.register(device, registration)
    expect(peers.list(true)).toEqual([])
    peers.registerStudio(device, registration)
    devices.revoke(device)
    expect(peers.list(true)).toEqual([])
    expect(db.prepare('SELECT COUNT(*) FROM studio_peer_grants').pluck().get()).toBe(0)
  } finally {
    db.close()
  }
})
