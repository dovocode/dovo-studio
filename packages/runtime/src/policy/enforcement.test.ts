import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vite-plus/test'
import { startRuntime } from '../index.js'
import { PeerConnections } from '../http/peer-connections.js'
import { createRuntimeServer } from '../http/server.js'
import { ExternalListener } from '../http/external-listener.js'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import type { Services } from '../services.js'

const lan = Object.values(networkInterfaces())
  .flatMap((entries) => entries ?? [])
  .find((entry) => entry.family === 'IPv4' && !entry.internal)?.address

async function lanStatus(services: Services, path: string, origin?: string) {
  if (!lan) return undefined
  const external = createRuntimeServer(services, false, false)
  external.server.listen(0, '0.0.0.0')
  await once(external.server, 'listening')
  const address = external.server.address()
  if (!address || typeof address === 'string') throw new Error('Missing LAN listener')
  try {
    return (
      await fetch(`http://${lan}:${address.port}${path}`, {
        ...(origin ? { headers: { Origin: origin } } : {}),
      })
    ).status
  } finally {
    await external.close()
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

it('applies local-browser policy to loopback browser origins without blocking desktop or local services', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dovo-policy-origin-'))
  const path = join(dir, 'policy.json')
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      organization: 'Test',
      limits: {
        clients: ['desktop', 'remote'],
      },
    }),
  )
  vi.stubEnv('DOVO_POLICY_PATH', path)
  vi.stubEnv('DOVO_RELEASE_DISTRIBUTION', 'desktop')
  vi.stubEnv('VITE_DEV_SERVER_URL', 'http://127.0.0.1:5173/')
  const runtime = await startRuntime({
    databasePath: ':memory:',
    ownerToken: 'policy-test-owner-token-at-least-thirty-two-characters',
    port: 0,
  })
  const url = `http://127.0.0.1:${runtime.port}`
  const check = vi.spyOn(runtime.services.policy, 'requireClient')
  try {
    expect((await fetch(`${url}/health`)).status).toBe(200)
    expect((await fetch(`${url}/health`, { headers: { Origin: 'null' } })).status).toBe(200)
    expect((await fetch(`${url}/health`, { headers: { Origin: 'file://' } })).status).toBe(200)
    expect(
      (await fetch(`${url}/health`, { headers: { Origin: 'http://127.0.0.1:5173' } })).status,
    ).toBe(200)
    expect(
      (await fetch(`${url}/health`, { headers: { Origin: 'http://127.0.0.1:5174' } })).status,
    ).toBe(403)
    expect(
      (
        await fetch(`${url}/health`, {
          method: 'OPTIONS',
          headers: { Origin: 'https://browser.example' },
        })
      ).status,
    ).toBe(403)
    expect(
      (
        await fetch(`${url}/api/tasks/files/shared/test`, {
          headers: { Origin: 'https://browser.example' },
        })
      ).status,
    ).toBe(403)
    check.mockClear()
    const socket = new WebSocket(`ws://127.0.0.1:${runtime.port}/ws/sync`, {
      origin: 'https://browser.example',
    })
    socket.on('error', () => {})
    const [, response] = await once(socket, 'unexpected-response')
    expect(response.statusCode).toBe(401)
    expect(check).toHaveBeenCalledWith('local-browser')
    socket.terminate()
    check.mockClear()
    const desktopSocket = new WebSocket(`ws://127.0.0.1:${runtime.port}/ws/sync`, {
      origin: 'null',
    })
    desktopSocket.on('error', () => {})
    const [, desktopResponse] = await once(desktopSocket, 'unexpected-response')
    expect(desktopResponse.statusCode).toBe(401) // No ticket; the origin passed policy.
    expect(check).not.toHaveBeenCalled()
    desktopSocket.terminate()
    expect(await lanStatus(runtime.services, '/health', 'https://browser.example')).toBe(
      lan ? 200 : undefined,
    )
  } finally {
    await runtime.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

it('blocks restricted operations and pauses persisted publishers and Connect without deleting them', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dovo-policy-enforcement-'))
  const path = join(dir, 'policy.json')
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      organization: 'Test',
      limits: {
        sharing: false,
        connect: false,
        webhookTasks: false,
        clients: ['desktop', 'local-browser'],
        updates: { mode: 'off', allowNightly: false },
      },
    }),
  )
  vi.stubEnv('DOVO_POLICY_PATH', path)
  const token = 'policy-test-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const s = runtime.services
  const request = (path: string, value: object) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(value),
    })
  try {
    expect((await fetch(`http://127.0.0.1:${runtime.port}/health`)).status).toBe(200)
    expect((await request('/api/jobs/webhook-secret', { id: 'missing' })).status).toBe(403)
    expect((await request('/api/webhooks/missing', {})).status).toBe(403)
    expect((await request('/api/runtime/update/start', { version: '1.2.3' })).status).toBe(403)
    const tunnel = createRuntimeServer(s, false, false, () => ({
      deviceId: 'device',
      active: true,
      claim: () => {},
      claimed: () => true,
      extend: () => {},
    }))
    tunnel.server.listen(0, '127.0.0.1')
    await once(tunnel.server, 'listening')
    const address = tunnel.server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test listener')
    try {
      expect(
        (await fetch(`http://127.0.0.1:${address.port}/api/tasks/files/shared/test`)).status,
      ).toBe(403)
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws/sync`)
      socket.on('error', () => {})
      const [, response] = await once(socket, 'unexpected-response')
      expect(response.statusCode).toBe(401)
      socket.terminate()
    } finally {
      await tunnel.close()
    }
    expect(await lanStatus(s, '/health')).toBe(lan ? 403 : undefined)
    expect(await lanStatus(s, '/api/tasks/files/shared/test')).toBe(lan ? 403 : undefined)
    expect(() => s.jobs.start('missing', 'webhook:one')).toThrow(/policy/)
    expect(() => s.sharedThreads.preview('missing')).toThrow(/policy/)
    await expect(
      s.artifactFeeds.tools({ taskId: 'missing', id: 'missing', revision: 1 }, 'owner'),
    ).rejects.toThrow(/policy/)
    const network = new ExternalListener(s, '0.0.0.0', 8787)
    await expect(network.set('0.0.0.0', 8787, true)).rejects.toThrow(/policy/)
    expect(network.status().enabled).toBe(false)
    await network.close()
    await expect(s.peers.invitation(new Date(Date.now() + 10000).toISOString())).rejects.toThrow(
      /policy/,
    )
    expect(() => s.peers.internet.prepareSetup('device', 'session', 'runtime', 'name')).toThrow(
      /policy/,
    )
    expect(() => s.peers.upgrades.request('device')).toThrow(/policy/)
    const disable = vi.fn<() => void>()
    await expect(
      s.peers.upgrades.claim(
        'device',
        'id',
        async () => {
          throw new Error('unexpected enable')
        },
        disable,
      ),
    ).rejects.toThrow(/policy/)
    expect(disable).not.toHaveBeenCalled()
    const writer = '{"kept":"writer"}'
    const feed = '{"kept":"feed"}'
    s.db
      .prepare('INSERT INTO shared_thread_writers VALUES(?,?,?,?,?,?)')
      .run('w', 't', 'owner', writer, '', '')
    s.db
      .prepare('INSERT INTO artifact_feeds VALUES(?,?,?,?,?,?,?,?)')
      .run('f', 't', 'a', 1, 'owner', feed, 0, '')
    const outbound = vi.spyOn(globalThis, 'fetch')
    await s.sharedThreads.tick()
    s.artifactFeeds.tick()
    expect(outbound).not.toHaveBeenCalled()
    expect(s.db.prepare('SELECT config FROM shared_thread_writers WHERE id=?').get('w')).toEqual({
      config: writer,
    })
    expect(s.db.prepare('SELECT config FROM artifact_feeds WHERE publication=?').get('f')).toEqual({
      config: feed,
    })

    s.db
      .prepare('UPDATE account_internet SET state=? WHERE id=1')
      .run(JSON.stringify({ grant: 'saved', runtimeId: 'r', name: 'saved' }))
    s.db.prepare('INSERT INTO peer_connections VALUES (?,?)').run('saved-device', 'not-json')
    const peers = new PeerConnections(s.db, s.devices, s.policy)
    try {
      peers.start(1234)
      expect(peers.internet.status().enabled).toBe(true)
      expect(outbound).not.toHaveBeenCalled()
      expect(
        s.db.prepare('SELECT config FROM peer_connections WHERE device_id=?').get('saved-device'),
      ).toEqual({ config: 'not-json' })
    } finally {
      await peers.dispose()
    }
  } finally {
    await runtime.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

it('rejects nightly update selection while allowing stable requests through policy', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dovo-policy-updates-'))
  const path = join(dir, 'policy.json')
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      organization: 'Test',
      limits: {
        updates: { mode: 'auto', allowNightly: false },
      },
    }),
  )
  vi.stubEnv('DOVO_POLICY_PATH', path)
  const token = 'policy-test-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  const update = (version: string) =>
    fetch(`http://127.0.0.1:${runtime.port}/api/runtime/update/start`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version }),
    })
  try {
    expect((await update('1.2.3-nightly.1')).status).toBe(403)
    // A source checkout has no managed updater, but the stable request passes policy.
    expect((await update('1.2.3')).status).toBe(409)
  } finally {
    await runtime.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

it('rejects server updates when a managed feed cannot be honored', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dovo-policy-feed-'))
  const path = join(dir, 'policy.json')
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      organization: 'Test',
      limits: {
        updates: { mode: 'auto', feedUrl: 'https://updates.example.test' },
      },
    }),
  )
  vi.stubEnv('DOVO_POLICY_PATH', path)
  vi.stubEnv('DOVO_RELEASE_DISTRIBUTION', 'server')
  const token = 'policy-test-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  try {
    const response = await fetch(`http://127.0.0.1:${runtime.port}/api/runtime/update/start`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ version: '1.2.3' }),
    })
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining('managed update feed'),
    })
  } finally {
    await runtime.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
