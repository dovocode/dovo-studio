import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createServer as httpServer } from 'node:http'
import { connect, createServer, type Socket } from 'node:net'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WebSocket, WebSocketServer } from 'ws'
import { RTCPeerConnection } from 'werift'
import {
  peerRoom,
  peerCapability,
  peerSocketUrl,
  peerDigest,
  signPeerSignal,
  verifyPeerSignal,
  peerSignalSchema,
  decode,
  createPeerPipe,
  peerConfigSchema,
  peerRelayAdmissionPayload,
  PEER_RELAY_MAX_TTL_MS,
  PEER_DISCONNECT_GRACE_MS,
  type PeerConfig,
  type PeerRelay,
  type PeerSignal,
} from '@dovo/protocol'
import { attachPeerSignaling } from '../../../../apps/connect-server/src/peer-signaling.js'
import { approvedRelayInstallations } from '../../../../apps/connect-server/src/relay-admission.js'
import type { PeerRelayIssuer } from '../../../../apps/connect-server/src/relay-credentials.js'
import { startRuntime } from '../index.js'
import { acceptableOffer } from './peer-connections.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
const ownerToken = 'test-owner-token-not-sent-to-connect'
/** An HTTP/1.1 keep-alive socket, held open after its response like an idle client pool. */
async function keepAlive(address: string) {
  const { hostname, port } = new URL(address)
  const socket = connect({ host: hostname, port: Number(port) })
  cleanup.push(() => {
    socket.destroy()
  })
  await once(socket, 'connect')
  const closed = once(socket, 'close').then(() => true)
  const response = new Promise<string>((resolve) => {
    let text = ''
    socket.on('data', (chunk) => {
      text += String(chunk)
      if (text.includes('\r\n\r\n') && text.includes('"ok"')) resolve(text)
    })
  })
  socket.write('GET /health HTTP/1.1\r\nHost: runtime\r\nConnection: keep-alive\r\n\r\n')
  return { response, closed, socket }
}
/** Resolves with the HTTP status a WebSocket upgrade was refused with, or 101. */
async function upgrade(url: string) {
  const socket = new WebSocket(url)
  cleanup.push(() => socket.terminate())
  return new Promise<number>((resolve) => {
    socket.once('open', () => resolve(101))
    socket.once('unexpected-response', (_, response) => resolve(response.statusCode ?? 0))
    socket.once('error', () => resolve(0))
  })
}
async function fixture(persistent = false) {
  const broker = httpServer()
  attachPeerSignaling(broker)
  broker.listen(0, '127.0.0.1')
  await once(broker, 'listening')
  cleanup.push(() => new Promise<void>((resolve) => broker.close(() => resolve())))
  const port = broker.address()
  if (!port || typeof port === 'string') throw new Error('No signaling port')
  vi.stubEnv('DOVO_CONNECT_ORIGIN', `http://127.0.0.1:${port.port}`)
  const directory = await mkdtemp(join(tmpdir(), 'dovo-peer-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  const options = {
    databasePath: persistent ? join(directory, 'runtime.sqlite') : ':memory:',
    ownerToken,
    port: 0,
  }
  let runtime = await startRuntime(options)
  cleanup.push(() => runtime.close())
  const restart = async () => {
    await runtime.close()
    runtime = await startRuntime(options)
    return runtime
  }
  const tunnel = async (config: PeerConfig) => {
    const pc = new RTCPeerConnection({ iceServers: [], iceUseIpv6: false })
    cleanup.push(() => pc.close())
    const ready = pc.createDataChannel('dovo-ready-v1')
    const connected = new Promise<void>((resolve) =>
      ready.stateChange.subscribe((state) => {
        if (state === 'open') resolve()
      }),
    )
    const socket = new WebSocket(peerSocketUrl(config))
    cleanup.push(() => socket.terminate())
    await once(socket, 'open')
    const joined = once(socket, 'message')
    const session = randomBytes(32).toString('hex')
    socket.send(
      JSON.stringify({
        type: 'client',
        room: peerRoom(config),
        key: peerCapability(config, 'client'),
        session,
      }),
    )
    await joined
    await pc.setLocalDescription(await pc.createOffer())
    const sdp = pc.localDescription!.sdp
    const offer = signPeerSignal(config, { session, role: 'offer', offer: peerDigest(sdp), sdp })
    const answered = once(socket, 'message')
    socket.send(JSON.stringify(offer))
    const answer = decode(peerSignalSchema, JSON.parse(String((await answered)[0])))
    expect(answer.session).toBe(session)
    expect(answer.offer).toBe(peerDigest(sdp))
    expect(verifyPeerSignal(config, answer)).toBe(true)
    await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
    await connected
    socket.close()
    const connections = new Set<Socket>()
    const proxy = createServer({ allowHalfOpen: true, pauseOnConnect: true }, (tcp) => {
      connections.add(tcp)
      tcp.once('close', () => connections.delete(tcp))
      const channel = pc.createDataChannel('dovo-tcp-v1')
      const pipe = createPeerPipe({
        stream: {
          onData: (f) => {
            tcp.on('data', f)
          },
          onEnd: (f) => {
            tcp.on('end', f)
          },
          onClose: (f) => {
            tcp.on('close', f)
          },
          onError: (f) => {
            tcp.on('error', f)
          },
          write: (bytes, done) => {
            tcp.write(bytes, done)
          },
          pause: () => {
            tcp.pause()
          },
          resume: () => {
            tcp.resume()
          },
          end: () => {
            tcp.end()
          },
          destroy: () => {
            tcp.destroy()
          },
        },
        send: (v) => channel.send(typeof v === 'string' ? v : Buffer.from(v)),
        close: () => channel.close(),
      })
      channel.stateChange.subscribe((state) => {
        if (state === 'open') pipe.ready()
        if (state === 'closed') pipe.stop()
      })
      channel.onMessage.subscribe((v) => pipe.receive(v))
    })
    cleanup.push(
      () =>
        new Promise<void>((resolve) => {
          for (const tcp of connections) tcp.destroy()
          proxy.close(() => resolve())
        }),
    )
    proxy.listen(0, '127.0.0.1')
    await once(proxy, 'listening')
    const local = proxy.address()
    if (!local || typeof local === 'string') throw new Error('No tunnel listener')
    const address = `http://127.0.0.1:${local.port}`
    const request = async (path: string, body?: object, token?: string) =>
      fetch(address + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(15000),
      })
    return { request, address, pc, socket, answered, ready }
  }
  return { runtime, tunnel, directory, restart }
}

it('pairs remotely, carries authenticated HTTP and live WebSockets, then revokes all peer access', async () => {
  const { runtime, tunnel } = await fixture()
  const code = runtime.services.pairing.createCode()
  const invite = await runtime.services.peers.invitation(code.expiresAt, 'dovo')
  const bootstrap = await tunnel(invite)
  if (!bootstrap.request) throw new Error('No bootstrap tunnel')
  // A bootstrap invitation is pairing-only, before and after a credential exists.
  expect((await bootstrap.request('/api/snapshot')).status).toBe(403)
  const requested = await bootstrap.request('/api/pair/request', {
    protocolVersion: 2,
    code: code.code,
    name: 'Remote phone',
  })
  expect(requested.status).toBe(200)
  const proof: { id: string; secret: string; expiresAt: string } = await requested.json()
  runtime.services.pairing.approve(proof.id, true)
  const claimed = await bootstrap.request('/api/pair/claim', proof)
  const claim: { token: string } = await claimed.json()
  expect(claim.token).toBeTruthy()
  const enabled = await bootstrap.request('/api/runtime/peer/enable', {}, claim.token)
  expect(enabled.status).toBe(200)
  const config: PeerConfig = await enabled.json()
  expect(config.secret).not.toBe(invite.secret)
  // The computer's relay consent for this pairing carries over to the device's own room.
  expect(config.relay).toBe('dovo')
  const peer = await tunnel(config)
  if (!peer.request || !peer.address) throw new Error('No permanent tunnel')
  // The phone durably stages the permanent capability before confirming pairing through it.
  expect((await peer.request('/api/pair/confirm', proof)).status).toBe(200)
  const snapshot = await peer.request('/api/snapshot', undefined, claim.token)
  expect(snapshot.status).toBe(200)
  expect((await snapshot.json()).runtimeId).toBe(runtime.services.runtimeId)

  // The bootstrap tunnel never becomes a general device connection.
  expect((await bootstrap.request('/api/snapshot', undefined, claim.token)).status).toBe(403)
  const other = 'another-paired-device-token'
  runtime.services.devices.add('Other phone', other)
  expect((await bootstrap.request('/api/runtime/peer/enable', {}, other)).status).toBe(403)
  const bootstrapTicket: { ticket: string } = await (
    await peer.request('/api/sync/ticket?format=2', {}, claim.token)
  ).json()
  expect(
    await upgrade(
      bootstrap.address.replace('http:', 'ws:') + '/ws/sync?ticket=' + bootstrapTicket.ticket,
    ),
  ).toBe(401)

  // Tunneled sockets arrive from loopback, but must not satisfy local-only Studio UI checks.
  const local = `http://127.0.0.1:${runtime.port}`
  for (const [path, input] of [
    ['/api/studio/peers', {}],
    ['/api/studio/session', {}],
    ['/api/studio/tools', { taskId: 'task', part: 'ui', command: {} }],
  ] as const) {
    const remote = await peer.request(path, input, claim.token)
    expect(remote.status).toBe(403)
    expect((await remote.json()).error).toContain('only on this machine')
    // A genuine loopback client keeps access; it fails later, on the empty request body.
    const genuine = await fetch(local + path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${claim.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    expect((await genuine.json()).error ?? '').not.toContain('only on this machine')
  }
  // Forwarding headers cannot claim local provenance either.
  const forged = await fetch(peer.address + '/api/studio/session', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${claim.token}`,
      'Content-Type': 'application/json',
      'X-Forwarded-For': '127.0.0.1',
      'X-Real-IP': '127.0.0.1',
      Forwarded: 'for=127.0.0.1',
    },
    body: '{}',
  })
  expect(forged.status).toBe(403)

  // One device's room does not carry another device's or the host's bearer credential.
  expect((await peer.request('/api/snapshot', undefined, other)).status).toBe(403)
  expect((await peer.request('/api/snapshot', undefined, ownerToken)).status).toBe(403)
  const foreign: { ticket: string } = await (
    await fetch(local + '/api/sync/ticket?format=2', {
      method: 'POST',
      headers: { Authorization: `Bearer ${other}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
  ).json()
  expect(
    await upgrade(peer.address.replace('http:', 'ws:') + '/ws/sync?ticket=' + foreign.ticket),
  ).toBe(401)
  const issued = await peer.request('/api/sync/ticket?format=2', {}, claim.token)
  const ticket: { ticket: string } = await issued.json()
  const live = new WebSocket(
    peer.address.replace('http:', 'ws:') + '/ws/sync?ticket=' + ticket.ticket,
  )
  cleanup.push(() => live.terminate())
  const frame = once(live, 'message')
  await once(live, 'open')
  live.send(JSON.stringify({ type: 'resume' }))
  expect(JSON.parse(String((await frame)[0])).type).toBe('snapshot')
  const directory = await mkdtemp(join(tmpdir(), 'dovo-peer-files-'))
  cleanup.push(() => rm(directory, { recursive: true, force: true }))
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: [
      {
        id: 'peer-file',
        title: 'Peer file',
        agentId: '',
        repositoryId: '',
        status: 'draft',
        createdAt: new Date().toISOString(),
        messages: [],
        files: [],
        draft: '',
        example: false,
      },
    ],
  }))
  vi.spyOn(runtime.services.checkouts, 'fileDirectory').mockResolvedValue(directory)
  const bytes = randomBytes(2 * 1024 * 1024 + 17)
  await writeFile(join(directory, 'binary.bin'), bytes)
  const shared = await peer.request(
    '/api/tasks/files/share',
    { taskId: 'peer-file', path: 'binary.bin' },
    claim.token,
  )
  expect(shared.status).toBe(200)
  const file: { url: string } = await shared.json()
  const download = await peer.request(file.url + '?download=1')
  expect(download.status).toBe(200)
  expect(Buffer.from(await download.arrayBuffer())).toEqual(bytes)
  // Revocation tears down idle keep-alive HTTP connections and live WebSockets on the tunnel.
  const idle = await keepAlive(peer.address)
  expect(await idle.response).toContain('200 OK')
  const liveClosed = once(live, 'close').then(() => true)
  const device = runtime.services.devices.authenticate(claim.token)
  runtime.services.devices.revoke(device.id)
  expect(await idle.closed).toBe(true)
  expect(await liveClosed).toBe(true)
  await expect
    .poll(() => runtime.services.db.prepare('SELECT * FROM peer_connections').all())
    .toHaveLength(0)
}, 60000)

it('restores per-device capabilities after restarting the runtime and expires bootstrap rooms', async () => {
  const f = await fixture(true)
  const token = 'persisted-phone-token'
  const deviceId = f.runtime.services.devices.add('Phone', token)
  const config = await f.runtime.services.peers.enable(deviceId)
  expect(config.relay).toBeUndefined()
  const identity = f.runtime.services.peers.relayIdentity()
  const restarted = await f.restart()
  expect(await restarted.services.peers.enable(deviceId)).toEqual(config)
  // The approval key survives restarts; only its public half is ever returned.
  const read = (bearer: string) =>
    fetch(`http://127.0.0.1:${restarted.port}/api/runtime/peer/identity`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
  const owned = await read(ownerToken)
  expect(owned.status).toBe(200)
  expect(await owned.json()).toEqual(identity)
  expect((await read(token)).status).toBe(403)
  const peer = await f.tunnel(config)
  expect((await peer.request('/api/snapshot', undefined, token)).status).toBe(200)
  expect((await peer.request('/api/runtime/peer/identity', {}, ownerToken)).status).toBe(403)
  const invite = await restarted.services.peers.invitation(
    new Date(Date.now() + 120000).toISOString(),
  )
  const temporary = await f.tunnel(invite)
  const idle = await keepAlive(temporary.address)
  expect(await idle.response).toContain('200 OK')
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 121000)
  await expect.poll(() => temporary.ready.readyState).toBe('closed')
  // Expiry closes the bootstrap's established pipes, not only its signaling and ICE session.
  expect(await idle.closed).toBe(true)
  expect((await peer.request('/api/snapshot', undefined, token)).status).toBe(200)
}, 45000)

it('refuses connections to the tunnel listener that did not arrive through a tunnel', async () => {
  const f = await fixture()
  const port = (f.runtime.services.peers as unknown as { port?: number }).port
  if (!port) throw new Error('No internet listener')
  // A local process can dial the dedicated listener, but has no tunnel provenance.
  const response = await fetch(`http://127.0.0.1:${port}/health`)
  expect(response.status).toBe(403)
  expect(await upgrade(`ws://127.0.0.1:${port}/ws/sync?ticket=none`)).toBe(401)
})

it('upgrades an existing pairing only after owner approval, preserving identity and private request details', async () => {
  const { runtime, tunnel } = await fixture()
  const token = 'existing-paired-phone-token'
  const id = runtime.services.devices.add('Existing phone', token)
  const otherToken = 'other-paired-phone-token'
  runtime.services.devices.add('Other phone', otherToken)
  const call = (path: string, credential = token, input?: object) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: input ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      ...(input ? { body: JSON.stringify(input) } : {}),
    })
  expect((await call('/api/runtime/peer/enable', token, {})).status).toBe(403)
  const requested = await call('/api/runtime/peer/upgrade/request', token, {})
  expect(requested.status).toBe(200)
  const request: { id: string } = await requested.json()
  const pending = await call('/api/runtime/peer/upgrade/claim', token, request).then((r) =>
    r.json(),
  )
  expect(pending.status).toBe('pending')
  expect(pending.peer).toBeUndefined()
  expect(runtime.services.peers.enabled(id)).toBe(false)
  for (const credential of [token, otherToken]) {
    const view = await call('/api/snapshot', credential).then((r) => r.json())
    expect(view.pendingPeerUpgrades).toEqual([])
    expect(
      (await call('/api/runtime/peer/upgrade/approve', credential, { ...request, allow: true }))
        .status,
    ).toBe(403)
  }
  const view = await call('/api/snapshot', ownerToken).then((r) => r.json())
  expect(view.pendingPeerUpgrades).toMatchObject([{ id: request.id, name: 'Existing phone' }])
  expect((await call('/api/runtime/peer/upgrade/claim', otherToken, request)).status).toBe(404)
  expect(
    (await call('/api/runtime/peer/upgrade/approve', ownerToken, { ...request, allow: true }))
      .status,
  ).toBe(200)
  const claimed = await call('/api/runtime/peer/upgrade/claim', token, request).then((r) =>
    r.json(),
  )
  const config = decode(peerConfigSchema, claimed.peer)
  expect(config.relay).toBeUndefined()
  const peer = await tunnel(config)
  expect((await peer.request('/api/snapshot', undefined, token)).status).toBe(200)
  expect(runtime.services.devices.authenticate(token).id).toBe(id)
  expect(runtime.services.devices.list()).toHaveLength(2)
  // Approval never grants capabilities to another paired device.
  expect((await peer.request('/api/snapshot', undefined, otherToken)).status).toBe(403)
  expect((await call('/api/runtime/peer/upgrade/cancel', token, request)).status).toBe(200)
  expect(runtime.services.peers.enabled(id)).toBe(false)
}, 45000)

it('requires desktop internet consent and binds provenance to the live socket endpoints', async () => {
  const f = await fixture()
  const token = 'consent-phone-token'
  const id = f.runtime.services.devices.add('Phone', token)
  const request = () =>
    fetch(`http://127.0.0.1:${f.runtime.port}/api/runtime/peer/enable`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: '{}',
    })
  expect((await request()).status).toBe(403)
  expect(f.runtime.services.peers.enabled(id)).toBe(false)
  const config = await f.runtime.services.peers.enable(id)
  // A phone cannot upgrade an existing Direct-only capability even through a consenting invite.
  expect((await f.runtime.services.peers.enable(id, 'dovo')).relay).toBeUndefined()
  expect((await request()).status).toBe(200)
  const resolve = vi.spyOn(f.runtime.services.peers, 'origin')
  const tunnel = await f.tunnel(config)
  expect((await tunnel.request('/api/snapshot', undefined, token)).status).toBe(200)
  const accepted = resolve.mock.calls[0]?.[0]
  if (!accepted) throw new Error('No tunneled HTTP connection')
  const endpoint = {
    remoteAddress: accepted.remoteAddress,
    remotePort: accepted.remotePort,
    localAddress: accepted.localAddress,
    localPort: accepted.localPort,
  }
  expect(f.runtime.services.peers.origin(endpoint)?.deviceId).toBe(id)
  expect(f.runtime.services.peers.origin({ ...endpoint, localPort: 1 })).toBeUndefined()
  expect(
    f.runtime.services.peers.origin({ ...endpoint, localAddress: '127.0.0.2' }),
  ).toBeUndefined()
  f.runtime.services.devices.revoke(id)
  // The revoke callback invalidates rooms synchronously; it does not wait for a polling sweep.
  expect(f.runtime.services.peers.enabled(id)).toBe(false)
  expect(f.runtime.services.peers.origin(endpoint)).toBeUndefined()
}, 30000)

it('closes a device room revoked while its permanent capability is being issued', async () => {
  const f = await fixture()
  const token = 'racing-phone-token'
  const deviceId = f.runtime.services.devices.add('Phone', token)
  const enabling = f.runtime.services.peers.enable(deviceId)
  f.runtime.services.devices.revoke(deviceId)
  await expect(enabling).rejects.toThrow(/no longer paired|signaling disconnected/)
  expect(f.runtime.services.db.prepare('SELECT * FROM peer_connections').all()).toHaveLength(0)
  await expect(f.runtime.services.peers.enable(deviceId)).rejects.toThrow(
    'Enable internet access from a paired phone',
  )
  expect((f.runtime.services.peers as unknown as { rooms: Map<string, unknown> }).rooms.size).toBe(
    0,
  )
}, 20000)

const relayAt = (
  expiresAt: number,
  url = 'turn:turn.dovo.studio:3478?transport=udp',
): PeerRelay => ({
  provider: 'dovo',
  expiresAt,
  iceServers: [{ urls: [url], username: 'user', credential: 'credential' }],
})

it('accepts a broker relay only for the phone-signed provider, pinned hosts and a short lifetime', () => {
  const now = 1_800_000_000_000
  const config = decode(peerConfigSchema, {
    origin: 'https://connect.example',
    secret: randomBytes(32).toString('hex'),
    relay: 'dovo',
  })
  const sdp = 'v=0\r\na=fingerprint:sha-256 00:11\r\n'
  const signal = (relay?: 'dovo' | 'cloudflare') =>
    signPeerSignal(config, {
      session: randomBytes(32).toString('hex'),
      role: 'offer',
      offer: peerDigest(sdp),
      sdp,
      ...(relay ? { relay } : {}),
    })
  const offer = (signed: ReturnType<typeof signal>, relay?: PeerRelay) => ({
    type: 'offer' as const,
    signal: signed,
    ...(relay ? { relay } : {}),
  })
  const valid = relayAt(now + PEER_RELAY_MAX_TTL_MS)
  expect(acceptableOffer(config, offer(signal()), now)).toBe(true)
  expect(acceptableOffer(config, offer(signal('dovo'), valid), now)).toBe(true)
  expect(acceptableOffer({ ...config, relay: undefined }, offer(signal('dovo'), valid), now)).toBe(
    false,
  )
  // The broker cannot add a relay the phone did not request, or withhold the one it did.
  expect(acceptableOffer(config, offer(signal(), valid), now)).toBe(false)
  expect(acceptableOffer(config, offer(signal('dovo')), now)).toBe(false)
  expect(acceptableOffer(config, offer(signal('cloudflare'), valid), now)).toBe(false)
  // Nor relabel the signed provider: the relay choice is part of the phone's MAC.
  expect(acceptableOffer(config, offer({ ...signal(), relay: 'dovo' }, valid), now)).toBe(false)
  for (const expiresAt of [now - 1, now + 60000, now + PEER_RELAY_MAX_TTL_MS + 1])
    expect(acceptableOffer(config, offer(signal('dovo'), relayAt(expiresAt)), now)).toBe(false)
  for (const url of [
    'turn:127.0.0.1:3478?transport=udp',
    'turn:turn.dovo.studio.evil.example:3478?transport=udp',
    'turns:turn.dovo.studio:443?transport=udp',
  ])
    expect(acceptableOffer(config, offer(signal('dovo'), relayAt(now + 300000, url)), now)).toBe(
      false,
    )
  // Only hosts the computer pinned out-of-band replace the default relay host.
  const local = relayAt(now + 300000, 'turn:127.0.0.1:3478?transport=udp')
  expect(acceptableOffer(config, offer(signal('dovo'), local), now)).toBe(false)
  expect(
    acceptableOffer({ ...config, relayHosts: ['127.0.0.1'] }, offer(signal('dovo'), local), now),
  ).toBe(true)
})

type Internals = {
  rooms: Map<string, { sessions: Set<string>; peers: Map<RTCPeerConnection, () => void> }>
  origins: Map<number, unknown>
}
it('preserves live runtime sockets during a transient disconnect and bounds persistent outages', async () => {
  const f = await fixture()
  const deviceId = f.runtime.services.devices.add('Network handover phone', 'handover-token')
  const config = await f.runtime.services.peers.enable(deviceId)
  const tunnel = await f.tunnel(config)
  const idle = await keepAlive(tunnel.address)
  expect(await idle.response).toContain('200 OK')
  const internals = f.runtime.services.peers as unknown as Internals
  const peers = internals.rooms.get(peerRoom(config))!.peers
  const pc = [...peers.keys()][0]!
  vi.useFakeTimers()
  try {
    pc.connectionStateChange.execute('disconnected')
    await vi.advanceTimersByTimeAsync(PEER_DISCONNECT_GRACE_MS - 1)
    expect(peers.size).toBe(1)
    expect(internals.origins.size).toBe(1)
    pc.connectionStateChange.execute('connected')
    await vi.advanceTimersByTimeAsync(PEER_DISCONNECT_GRACE_MS)
    expect(peers.size).toBe(1)
    pc.connectionStateChange.execute('disconnected')
    await vi.advanceTimersByTimeAsync(PEER_DISCONNECT_GRACE_MS - 1)
    pc.connectionStateChange.execute('disconnected')
    await vi.advanceTimersByTimeAsync(1)
    expect(peers.size).toBe(0)
  } finally {
    vi.useRealTimers()
  }
  expect(await idle.closed).toBe(true)
}, 30000)

it('closes runtime keep-alive sockets when the peer readiness channel closes', async () => {
  const f = await fixture()
  const deviceId = f.runtime.services.devices.add('Readiness phone', 'readiness-token')
  const config = await f.runtime.services.peers.enable(deviceId)
  const tunnel = await f.tunnel(config)
  const idle = await keepAlive(tunnel.address)
  expect(await idle.response).toContain('200 OK')
  tunnel.ready.close()
  expect(await idle.closed).toBe(true)
}, 30000)
/** A hostile broker: it admits the computer, then forwards whatever offers the test chooses
 * and records the computer's answers. */
async function hostileBroker() {
  const broker = httpServer()
  const sockets = new WebSocketServer({ server: broker })
  let host: WebSocket | undefined
  const answers: PeerSignal[] = []
  sockets.on('connection', (socket) => {
    host = socket
    socket.once('message', () => socket.send(JSON.stringify({ type: 'ready' })))
    socket.on('message', (raw) => {
      const value: unknown = JSON.parse(Buffer.from(raw as Buffer).toString())
      if (value && typeof value === 'object' && 'role' in value && value.role === 'answer')
        answers.push(decode(peerSignalSchema, value))
    })
  })
  broker.listen(0, '127.0.0.1')
  await once(broker, 'listening')
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        for (const client of sockets.clients) client.terminate()
        sockets.close()
        broker.close(() => resolve())
      }),
  )
  const address = broker.address()
  if (!address || typeof address === 'string') throw new Error('No broker port')
  vi.stubEnv('DOVO_CONNECT_ORIGIN', `http://127.0.0.1:${address.port}`)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  cleanup.push(() => runtime.close())
  const config = await runtime.services.peers.invitation(
    new Date(Date.now() + 120000).toISOString(),
    'dovo',
  )
  const internals = runtime.services.peers as unknown as Internals
  const offer = async () => {
    const pc = new RTCPeerConnection({ iceServers: [], iceUseIpv6: false })
    cleanup.push(() => pc.close())
    const ready = pc.createDataChannel('dovo-ready-v1')
    await pc.setLocalDescription(await pc.createOffer())
    return { pc, ready, sdp: pc.localDescription!.sdp }
  }
  const forward = (value: object) => host!.send(JSON.stringify(value))
  const sign = (
    sdp: string,
    extra: Partial<Omit<PeerSignal, 'mac'>> = {},
    secret: PeerConfig = config,
  ) =>
    signPeerSignal(secret, {
      session: randomBytes(32).toString('hex'),
      role: 'offer',
      offer: peerDigest(sdp),
      sdp,
      ...extra,
    })
  const answered = async (session: string) => {
    await expect
      .poll(() => answers.find((answer) => answer.session === session), { timeout: 15000 })
      .toBeDefined()
    return answers.find((answer) => answer.session === session)!
  }
  return { runtime, config, internals, answers, offer, forward, sign, answered }
}

it('does not negotiate offers whose broker-supplied relay fails validation', async () => {
  const f = await hostileBroker()
  const { sdp } = await f.offer()
  const send = (relay: PeerRelay | undefined, signed?: 'dovo') => {
    const signal = f.sign(sdp, signed ? { relay: signed } : {})
    f.forward({ type: 'offer', signal, ...(relay ? { relay } : {}) })
    return signal.session
  }
  const rejected = [
    send(relayAt(Date.now() + 300000)),
    send(relayAt(Date.now() + 30000), 'dovo'),
    send(relayAt(Date.now() + 3600000), 'dovo'),
    send(relayAt(Date.now() + 300000, 'turn:10.0.0.1:3478?transport=udp'), 'dovo'),
  ]
  // A direct offer proves the broker path works, so the missing answers are refusals.
  await f.answered(send(undefined))
  expect(f.answers.filter(({ session }) => rejected.includes(session))).toEqual([])
  for (const room of f.internals.rooms.values())
    for (const session of rejected) expect(room.sessions.has(session)).toBe(false)
}, 30000)

it('ignores forged, cross-room and replayed offers', async () => {
  const f = await hostileBroker()
  const { sdp } = await f.offer()
  const other = decode(peerConfigSchema, {
    origin: f.config.origin,
    secret: randomBytes(32).toString('hex'),
  })
  const genuine = f.sign(sdp)
  const tampered = sdp.replace(/a=fingerprint:sha-256 \S+/, 'a=fingerprint:sha-256 00:11')
  const unfingerprinted = sdp.replace(/a=fingerprint:[^\r\n]*\r?\n/g, '')
  const forged = [
    // SDP edited after the phone signed it.
    { ...f.sign(sdp), sdp: tampered },
    // Signed by a capability for another room, e.g. a stale bootstrap or another phone.
    f.sign(sdp, {}, other),
    // Digest of a different offer than the SDP carried.
    f.sign(sdp, { offer: peerDigest(tampered) }),
    // An answer reflected back as if it were an offer.
    f.sign(sdp, { role: 'answer' }),
    // Validly signed, but without a DTLS fingerprint to authenticate the media path.
    f.sign(unfingerprinted),
  ]
  for (const signal of forged) f.forward({ type: 'offer', signal })
  f.forward({ type: 'offer', signal: genuine })
  await f.answered(genuine.session)
  // A replay of the accepted message, and of its session under a fresh SDP, starts nothing.
  f.forward({ type: 'offer', signal: genuine })
  const { sdp: fresh } = await f.offer()
  f.forward({ type: 'offer', signal: f.sign(fresh, { session: genuine.session }) })
  const control = f.sign(fresh)
  f.forward({ type: 'offer', signal: control })
  await f.answered(control.session)
  expect(f.answers.map(({ session }) => session).sort()).toEqual(
    [genuine.session, control.session].sort(),
  )
  const peers = [...f.internals.rooms.values()].reduce((count, room) => count + room.peers.size, 0)
  expect(peers).toBe(2)
}, 30000)

it('never opens a channel or the runtime listener when the signed DTLS fingerprint is wrong', async () => {
  const f = await hostileBroker()
  const connect = async (substitute: boolean) => {
    const client = await f.offer()
    // A real, reachable ICE endpoint whose signed fingerprint names someone else's certificate,
    // as a party that controls signaling but not the phone's DTLS key would have to present.
    const fingerprint = [...randomBytes(32)]
      .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
      .join(':')
    const sdp = substitute
      ? client.sdp.replace(/a=fingerprint:sha-256 \S+/g, `a=fingerprint:sha-256 ${fingerprint}`)
      : client.sdp
    expect(sdp !== client.sdp).toBe(substitute)
    const signal = f.sign(sdp)
    f.forward({ type: 'offer', signal })
    const answer = await f.answered(signal.session)
    let opened = false
    client.ready.stateChange.subscribe((state) => {
      if (state === 'open') opened = true
    })
    // Negotiated in the offer, like the phone's ready channel, so it opens with SCTP.
    const tcp = client.pc.createDataChannel('dovo-tcp-v1')
    let tcpOpened = false
    tcp.stateChange.subscribe((state) => {
      if (state === 'open') tcpOpened = true
    })
    await client.pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
    return { ...client, opened: () => opened, tcpOpened: () => tcpOpened }
  }
  const peers = () => [...f.internals.rooms.values()][0]?.peers.size
  // The honest offer completes DTLS and SCTP and reaches the runtime listener, so the harness
  // would observe the same through a forged fingerprint.
  const honest = await connect(false)
  await expect.poll(honest.opened, { timeout: 15000 }).toBe(true)
  await expect.poll(honest.tcpOpened, { timeout: 15000 }).toBe(true)
  await expect.poll(() => f.internals.origins.size).toBe(1)
  expect(peers()).toBe(1)

  const attack = await connect(true)
  expect(peers()).toBe(2)
  // The runtime fails the session on the fingerprint check, well before its 30 second deadline.
  await expect.poll(peers, { timeout: 15000 }).toBe(1)
  await new Promise((resolve) => setTimeout(resolve, 1000))
  expect(attack.opened()).toBe(false)
  expect(attack.tcpOpened()).toBe(false)
  // Only the honest tunnel ever reached the runtime's internet listener.
  expect(f.internals.origins.size).toBe(1)
}, 45000)

/** The real Connect broker with relay issuance and an operator allowlist read at admission. */
async function admissionBroker(approved: () => string[]) {
  const issue = vi.fn<PeerRelayIssuer>(async () => ({
    provider: 'dovo',
    expiresAt: Date.now() + 300000,
    iceServers: [
      { urls: ['turn:turn.dovo.studio:3478?transport=udp'], username: 'u', credential: 'c' },
    ],
  }))
  const broker = httpServer()
  broker.listen(0, '127.0.0.1')
  await once(broker, 'listening')
  cleanup.push(() => new Promise<void>((resolve) => broker.close(() => resolve())))
  const address = broker.address()
  if (!address || typeof address === 'string') throw new Error('No signaling port')
  const origin = `http://127.0.0.1:${address.port}`
  attachPeerSignaling(
    broker,
    [],
    { dovo: issue },
    (key, payload, signature) => approvedRelayInstallations(approved())(key, payload, signature),
    origin,
  )
  vi.stubEnv('DOVO_CONNECT_ORIGIN', origin)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  cleanup.push(() => runtime.close())
  // A phone joining the room and asking for the relay it would sign into its offer.
  const join = async (config: PeerConfig) => {
    const socket = new WebSocket(peerSocketUrl(config))
    cleanup.push(() => socket.terminate())
    await once(socket, 'open')
    const ready = once(socket, 'message')
    socket.send(
      JSON.stringify({
        type: 'client',
        room: peerRoom(config),
        key: peerCapability(config, 'client'),
        session: randomBytes(32).toString('hex'),
        relay: 'dovo',
      }),
    )
    return JSON.parse(String((await ready)[0])) as { relay?: PeerRelay; relayUnavailable?: string }
  }
  return { runtime, issue, join }
}

it('proves an operator-approved installation to Connect and receives relays only with consent', async () => {
  let approved: string[] = []
  const f = await admissionBroker(() => approved)
  const { publicKey } = f.runtime.services.peers.relayIdentity()
  approved = [publicKey]
  const expiresAt = () => new Date(Date.now() + 120000).toISOString()
  const consenting = await f.runtime.services.peers.invitation(expiresAt(), 'dovo')
  const granted = await f.join(consenting)
  expect(granted.relay?.provider).toBe('dovo')
  expect(f.issue).toHaveBeenCalledWith(peerRoom(consenting), expect.any(String), publicKey)
  // An approved installation still receives no relay for a room it did not consent to.
  f.issue.mockClear()
  const direct = await f.runtime.services.peers.invitation(expiresAt())
  expect(await f.join(direct)).toEqual({ type: 'ready', relayUnavailable: 'dovo' })
  expect(f.issue).not.toHaveBeenCalled()
})

it('stays direct-only when Connect has not approved this installation', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const f = await admissionBroker(() => [])
  const config = await f.runtime.services.peers.invitation(
    new Date(Date.now() + 120000).toISOString(),
    'dovo',
  )
  expect(await f.join(config)).toEqual({ type: 'ready', relayUnavailable: 'dovo' })
  expect(f.issue).not.toHaveBeenCalled()
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('not approved this installation'))
})

/** A broker whose admission of each host connection is scripted by the test. */
async function scriptedBroker() {
  const broker = httpServer()
  const sockets = new WebSocketServer({ server: broker })
  const closes: number[] = []
  let script: (socket: WebSocket, hello: Record<string, unknown>) => void = () => {}
  sockets.on('connection', (socket) => {
    socket.once('close', (code) => closes.push(code))
    socket.once('message', (raw) =>
      script(socket, JSON.parse(Buffer.from(raw as Buffer).toString())),
    )
  })
  broker.listen(0, '127.0.0.1')
  await once(broker, 'listening')
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        for (const client of sockets.clients) client.terminate()
        sockets.close()
        broker.close(() => resolve())
      }),
  )
  const address = broker.address()
  if (!address || typeof address === 'string') throw new Error('No broker port')
  const origin = `http://127.0.0.1:${address.port}`
  vi.stubEnv('DOVO_CONNECT_ORIGIN', origin)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken, port: 0 })
  cleanup.push(() => runtime.close())
  return {
    runtime,
    origin,
    closes,
    script: (next: typeof script) => {
      script = next
    },
    invite: () =>
      runtime.services.peers.invitation(new Date(Date.now() + 120000).toISOString(), 'dovo'),
  }
}

it('keeps direct-only rooms unlinkable through the installation key and refuses relay challenges', async () => {
  const f = await scriptedBroker()
  const hellos: Record<string, unknown>[] = []
  f.script((socket, hello) => {
    hellos.push(hello)
    socket.send(JSON.stringify({ type: 'ready' }))
  })
  await f.runtime.services.peers.invitation(new Date(Date.now() + 120000).toISOString())
  expect(hellos[0]?.relayIdentity).toBeUndefined()
  expect(hellos[0]?.relayAllowed).toBe(false)
  const proofs: unknown[] = []
  f.script((socket) => {
    socket.on('message', (raw) => proofs.push(raw))
    socket.send(
      JSON.stringify({ type: 'relay-challenge', challenge: randomBytes(32).toString('hex') }),
    )
  })
  await expect(
    f.runtime.services.peers.invitation(new Date(Date.now() + 120000).toISOString()),
  ).rejects.toThrow('signaling disconnected')
  expect(proofs).toEqual([])
})

it('becomes ready only on the ready that follows a valid admission proof', async () => {
  const f = await scriptedBroker()
  let release: (() => void) | undefined
  let proven: boolean | undefined
  f.script((socket, hello) => {
    const challenge = randomBytes(32).toString('hex')
    socket.once('message', (raw) => {
      const proof = JSON.parse(Buffer.from(raw as Buffer).toString())
      expect(Object.keys(proof).sort()).toEqual(['signature', 'type'])
      const key = String(hello.relayIdentity)
      proven = approvedRelayInstallations([key])(
        key,
        peerRelayAdmissionPayload(
          challenge,
          String(hello.room),
          String(hello.key),
          String(hello.clientKey),
          hello.relayAllowed === true,
          f.origin,
        ),
        proof.signature,
      )
      release = () => socket.send(JSON.stringify({ type: 'ready', relayApproved: true }))
    })
    socket.send(JSON.stringify({ type: 'relay-challenge', challenge }))
  })
  let ready = false
  const invited = f.invite().then((config) => {
    ready = true
    return config
  })
  await expect.poll(() => proven).toBe(true)
  // The proof alone does not admit the room; it waits for Connect's verdict.
  await new Promise((resolve) => setTimeout(resolve, 300))
  expect(ready).toBe(false)
  release!()
  expect((await invited).relay).toBe('dovo')
  // The hello carried only the public key; the private key never leaves the runtime.
  expect(f.runtime.services.peers.relayIdentity().publicKey).toMatch(/^[A-Za-z0-9_-]{59}$/)
})

it('refuses duplicate or malformed challenges and offers before admission', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const f = await scriptedBroker()
  const challenge = () =>
    JSON.stringify({ type: 'relay-challenge', challenge: randomBytes(32).toString('hex') })
  const disconnected = 'Dovo Connect signaling disconnected'
  const cases: Array<[(socket: WebSocket) => void, string]> = [
    [
      (socket) => {
        socket.send(challenge())
        socket.send(challenge())
      },
      disconnected,
    ],
    [
      (socket) => socket.send(JSON.stringify({ type: 'relay-challenge', challenge: 'not-hex' })),
      disconnected,
    ],
    [(socket) => socket.send(JSON.stringify({ type: 'offer', signal: {} })), disconnected],
    // A challenge after admission cannot reopen it; the room was already ready.
    [
      (socket) => {
        socket.send(JSON.stringify({ type: 'ready' }))
        socket.send(challenge())
      },
      'ready',
    ],
  ]
  for (const [index, [script, outcome]] of cases.entries()) {
    f.script(script)
    const invited = await f.invite().then(
      () => 'ready',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
    expect(invited).toBe(outcome)
    await expect.poll(() => f.closes.length).toBe(index + 1)
    expect(f.closes[index]).toBe(1008)
  }
})

it('pins relay hosts from DOVO_PEER_RELAY_HOSTS into new capabilities and keeps them', async () => {
  const f = await fixture(true)
  const expiresAt = () => new Date(Date.now() + 120000).toISOString()
  // Production default: nothing is pinned explicitly, so both sides pin turn.dovo.studio.
  expect((await f.runtime.services.peers.invitation(expiresAt())).relayHosts).toBeUndefined()
  vi.stubEnv('DOVO_PEER_RELAY_HOSTS', ' 127.0.0.1 , turn.example.com,, ')
  expect((await f.runtime.services.peers.invitation(expiresAt())).relayHosts).toEqual([
    '127.0.0.1',
    'turn.example.com',
  ])
  const deviceId = f.runtime.services.devices.add('Phone', 'pinned-phone-token')
  const config = await f.runtime.services.peers.enable(deviceId)
  expect(config.relayHosts).toEqual(['127.0.0.1', 'turn.example.com'])
  // A saved capability keeps the hosts the phone pinned, even if the environment changes.
  vi.stubEnv('DOVO_PEER_RELAY_HOSTS', 'turn.other.example')
  const restarted = await f.restart()
  expect(await restarted.services.peers.enable(deviceId)).toEqual(config)
  // Destinations that are not plain host names are refused rather than silently dropped.
  vi.stubEnv('DOVO_PEER_RELAY_HOSTS', 'turn:evil.example:3478')
  await expect(restarted.services.peers.invitation(expiresAt())).rejects.toThrow(/relayHosts/)
}, 30000)

it('validates broker relays against the room’s pinned hosts, not the default', async () => {
  vi.stubEnv('DOVO_PEER_RELAY_HOSTS', '127.0.0.1')
  const f = await hostileBroker()
  expect(f.config.relayHosts).toEqual(['127.0.0.1'])
  const { sdp } = await f.offer()
  const send = (...urls: string[]) => {
    const signal = f.sign(sdp, { relay: 'dovo' })
    f.forward({
      type: 'offer',
      signal,
      relay: {
        provider: 'dovo',
        expiresAt: Date.now() + 300000,
        iceServers: [{ urls, username: 'user', credential: 'credential' }],
      },
    })
    return signal.session
  }
  const sessions = () => [...f.internals.rooms.values()][0]!.sessions
  // The default host is refused once the room pins others, as is any unpinned URL in a list.
  const unpinned = send('turn:turn.dovo.studio:3478?transport=udp')
  const mixed = send('turn:127.0.0.1:3478?transport=udp', 'turn:10.0.0.1:3478?transport=udp')
  const insecure = send('turns:127.0.0.1:5349?transport=udp')
  const pinned = send('turn:127.0.0.1:3478?transport=udp', 'turns:127.0.0.1:5349?transport=tcp')
  await expect.poll(() => sessions().has(pinned)).toBe(true)
  for (const session of [unpinned, mixed, insecure]) expect(sessions().has(session)).toBe(false)
}, 30000)
