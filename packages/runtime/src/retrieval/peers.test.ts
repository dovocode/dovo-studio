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
