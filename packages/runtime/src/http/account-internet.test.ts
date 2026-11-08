import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createServer as tcpServer, type Socket } from 'node:net'
import { once } from 'node:events'
import { randomBytes, createHash } from 'node:crypto'
import { WebSocket } from 'ws'
import { RTCPeerConnection } from 'werift'
import {
  AccountClient,
  internetPublicKey,
  createPeerPipe,
  decode,
  peerSocketUrl,
  peerRoom,
  peerCapability,
  peerDigest,
  signPeerSignal,
  peerSignalSchema,
  peerReadySchema,
  validPeerRelay,
  syncTicketSchema,
  responses,
  verifyPeerSignal,
  type PeerConfig,
} from '@dovo/protocol'
import { AccountStore } from '../../../../apps/connect-server/src/store.js'
import { InternetStore } from '../../../../apps/connect-server/src/internet-store.js'
import { internetApi } from '../../../../apps/connect-server/src/internet-api.js'
import { accountApi } from '../../../../apps/connect-server/src/account-api.js'
import { attachPeerSignaling } from '../../../../apps/connect-server/src/peer-signaling.js'
import { dovoTurn } from '../../../../apps/connect-server/src/dovo-turn.js'
import type { PeerRelayIssuer } from '../../../../apps/connect-server/src/relay-credentials.js'
import { RequestError } from '../../../../apps/connect-server/src/http.js'
import {
  organizations,
  organizationRelay,
} from '../../../../apps/connect-server/src/organizations.js'
import { startRuntime } from '../index.js'
const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function fixture(
  persistent = false,
  issueRelay?: PeerRelayIssuer,
  organization = false,
  configuredInSettings = false,
) {
  const accounts = new AccountStore(':memory:')
  const configs = organization
    ? organizations(
        [
          {
            id: 'company',
            name: 'Company',
            issuer: 'https://sso.example.com/tenant',
            clientId: 'dovo',
            relay: {
              urls: ['turn:relay.company.example:3478?transport=udp'],
              secret: 'organization-test-master-secret-1234567890',
            },
          },
        ],
        'https://connect.test',
      )
    : []
  accounts.configureOrganizations(new Map(configs.map((config) => [config.id, config.policy])))
  cleanup.push(() => accounts.db.close())
  let handler: ReturnType<typeof internetApi> | undefined
  let directory: ReturnType<typeof accountApi> | undefined
  const broker = createServer((req, res) => {
    void (async () => {
      if (req.url?.startsWith('/v1/internet/')) await handler?.(req, res, new URL(req.url, origin))
      else await directory?.(req, res, new URL(req.url ?? '/', origin))
    })().catch((error) => {
      res.writeHead(error instanceof RequestError ? error.status : 500).end('{}')
    })
  })
  broker.listen(0, '127.0.0.1')
  await once(broker, 'listening')
  const bound = broker.address()
  if (!bound || typeof bound === 'string') throw new Error('No broker')
  const origin = `http://127.0.0.1:${bound.port}`
  const internet = new InternetStore(accounts, origin)
  handler = internetApi(internet, (host) => organizationRelay(configs, accounts, host))
  directory = accountApi(accounts, origin, undefined, internet)
  attachPeerSignaling(
    broker,
    [],
    { dovo: issueRelay },
    undefined,
    origin,
    (grant, identity) => internet.host(grant)?.identity === identity,
  )
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        broker.close(() => resolve())
        broker.closeAllConnections()
      }),
  )
  vi.stubEnv('DOVO_CONNECT_ORIGIN', configuredInSettings ? undefined : origin)
  const folder = await mkdtemp(join(tmpdir(), 'dovo-account-internet-'))
  cleanup.push(() => rm(folder, { recursive: true, force: true }))
  const options = {
    databasePath: persistent ? join(folder, 'runtime.sqlite') : ':memory:',
    ownerToken: 'runtime-owner-token-for-test',
    port: 0,
  }
  let runtime = await startRuntime(options)
  cleanup.push(() => runtime.close())
  const signIn = () => {
    const { login, token } = accounts.createLogin()
    const config = configs[0]
    accounts.approve(login, {
      id: 'same-account',
      name: 'Dominic',
      ...(config
        ? {
            organization: { id: config.id, name: config.name, policy: config.policy },
            sessionExpiresAt: Date.now() + 3600_000,
          }
        : {}),
    })
    return token
  }
  const owner = signIn(),
    phone = signIn()
  const request = (body: object, token = 'runtime-owner-token-for-test') =>
    fetch(`http://127.0.0.1:${runtime.port}` + '/api/runtime/internet', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const client = new AccountClient(
    { read: async () => phone, write: async () => {} },
    async () => {},
    origin,
  )
  const call = (path: string, input: object, token: string, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(input),
    })
  return {
    get runtime() {
      return runtime
    },
    accounts,
    internet,
    owner,
    phone,
    client,
    origin,
    request,
    call,
    restart: async () => {
      await runtime.close()
      runtime = await startRuntime(options)
    },
  }
}
it('uses and persists the Connect URL chosen in Settings without an environment override', async () => {
  const f = await fixture(true, undefined, false, true)
  expect(f.runtime.services.peers.internet.origin).toBe('https://connect.dovo.studio')
  const enabled = await f.request({ enabled: true, accountToken: f.owner, origin: f.origin })
  expect(enabled.status).toBe(200)
  await f.restart()
  expect(f.runtime.services.peers.internet.origin).toBe(f.origin)
  await vi.waitFor(() => expect(f.runtime.services.peers.internet.status().connected).toBe(true))
  const changed = await f.request({
    enabled: true,
    accountToken: f.owner,
    origin: 'https://another.test',
  })
  expect(changed.status).toBe(409)
  expect(f.runtime.services.peers.internet.origin).toBe(f.origin)
})
it('binds paired setup proofs and peer connections to the custom Connect URL', async () => {
  const f = await fixture(false, undefined, false, true)
  const token = 'paired-custom-server-with-at-least-32-characters'
  f.runtime.services.devices.add('Phone', token)
  await f.client.load()
  await f.client.enablePairedInternet(
    f.runtime.services.runtimeId,
    async (session) => {
      const response = await f.call(
        '/api/runtime/internet/setup',
        { session, consent: true, relay: 'dovo', origin: f.origin },
        token,
      )
      expect(response.status).toBe(200)
      return decode(responses.internetSetup, await response.json())
    },
    async (id, grant) => {
      const response = await f.call('/api/runtime/internet/complete', { id, grant }, token)
      expect(response.status).toBe(200)
    },
  )
  expect(f.runtime.services.peers.internet.origin).toBe(f.origin)
  await vi.waitFor(() => expect(f.runtime.services.peers.internet.status().connected).toBe(true))
})
async function tunnel(config: PeerConfig) {
  const pc = new RTCPeerConnection({ iceServers: [], iceUseIpv6: false })
  cleanup.push(() => pc.close())
  const ready = pc.createDataChannel('dovo-ready-v1')
  const connected = new Promise<void>((resolve) =>
    ready.stateChange.subscribe((state) => {
      if (state === 'open') resolve()
    }),
  )
  const signaling = new WebSocket(peerSocketUrl(config))
  cleanup.push(() => signaling.terminate())
  await once(signaling, 'open')
  const session = randomBytes(32).toString('hex'),
    joined = once(signaling, 'message')
  signaling.send(
    JSON.stringify({
      type: 'client',
      room: peerRoom(config),
      key: peerCapability(config, 'client'),
      session,
      relay: config.relay,
    }),
  )
  const relay = decode(peerReadySchema, JSON.parse(String((await joined)[0]))).relay?.provider
  await pc.setLocalDescription(await pc.createOffer())
  const sdp = pc.localDescription!.sdp,
    answered = once(signaling, 'message')
  signaling.send(
    JSON.stringify(
      signPeerSignal(config, { session, role: 'offer', offer: peerDigest(sdp), sdp, relay }),
    ),
  )
  const answer = decode(peerSignalSchema, JSON.parse(String((await answered)[0])))
  expect(verifyPeerSignal(config, answer)).toBe(true)
  await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp })
  await connected
  signaling.close()
  const sockets = new Set<Socket>()
  const proxy = tcpServer({ allowHalfOpen: true, pauseOnConnect: true }, (socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    const channel = pc.createDataChannel('dovo-tcp-v1')
    const pipe = createPeerPipe({
      stream: {
        onData: (f) => {
          socket.on('data', f)
        },
        onEnd: (f) => {
          socket.on('end', f)
        },
        onClose: (f) => {
          socket.on('close', f)
        },
        onError: (f) => {
          socket.on('error', f)
        },
        write: (bytes, done) => {
          socket.write(bytes, done)
        },
        pause: () => {
          socket.pause()
        },
        resume: () => {
          socket.resume()
        },
        end: () => {
          socket.end()
        },
        destroy: () => {
          socket.destroy()
        },
      },
      send: (value) => channel.send(typeof value === 'string' ? value : Buffer.from(value)),
      close: () => channel.close(),
    })
    channel.onMessage.subscribe((value) => pipe.receive(value))
    channel.stateChange.subscribe((state) => {
      if (state === 'open') pipe.ready()
      if (state === 'closed') pipe.stop()
    })
  })
  proxy.listen(0, '127.0.0.1')
  await once(proxy, 'listening')
  cleanup.push(
    () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        proxy.close(() => resolve())
      }),
  )
  const local = proxy.address()
  if (!local || typeof local === 'string') throw new Error('No proxy')
  return { address: `http://127.0.0.1:${local.port}`, pc, ready }
}
it('automatically receives organization policy, preserves manual overrides and stops issuance after account revocation', async () => {
  const f = await fixture(false, undefined, true)
  expect((await f.request({ enabled: true, accountToken: f.owner })).status).toBe(200)
  await vi.waitFor(() =>
    expect(f.runtime.services.peers.relay.status()).toMatchObject({
      mode: 'organization',
      organization: 'Company',
      configured: true,
    }),
  )
  const policy = f.runtime.services.peers.relay.issue()
  expect(policy?.provider).toBe('custom')
  expect(JSON.stringify(policy)).not.toContain('organization-test-master-secret')
  await f.client.load()
  const connection = await f.client.connectInternet(
    f.client.snapshot().directory!.servers[0],
    randomBytes(32),
    AbortSignal.timeout(20_000),
  )
  const accountTunnel = await tunnel(connection.peer!)
  const attempted = await fetch(accountTunnel.address + '/api/runtime/relay', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent: true, config: null }),
  })
  expect(attempted.status).toBe(403)
  const modeAttempt = await fetch(accountTunnel.address + '/api/runtime/connection-mode', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ consent: true, mode: 'lan' }),
  })
  expect(modeAttempt.status).toBe(403)
  const pairedToken = 'separate-paired-human-token'
  f.runtime.services.devices.add('Paired human', pairedToken)
  const localConfig = {
    urls: ['turn:10.0.0.1'],
    username: 'local-user',
    credential: 'local-password',
  }
  expect(
    (await f.call('/api/runtime/relay', { consent: true, config: localConfig }, pairedToken))
      .status,
  ).toBe(200)
  expect(f.runtime.services.peers.relay.status().mode).toBe('custom')
  expect(
    (await f.call('/api/runtime/relay', { consent: true, config: null }, pairedToken)).status,
  ).toBe(200)
  expect(f.runtime.services.peers.relay.status().mode).toBe('organization')
  f.accounts.revoke(f.owner)
  await vi.waitFor(() => expect(f.runtime.services.peers.internet.status().enabled).toBe(false), {
    timeout: 5000,
  })
  expect(f.runtime.services.peers.relay.issue()).toBeUndefined()
  expect(
    (
      await fetch(`http://127.0.0.1:${f.runtime.port}/api/snapshot`, {
        headers: { Authorization: 'Bearer ' + pairedToken },
      })
    ).status,
  ).toBe(200)
}, 30_000)
it('connects same-account phones without pairing, isolates LAN credentials, and closes access on phone signout', async () => {
  const f = await fixture()
  const enable = await f.request({ enabled: true, accountToken: f.owner })
  expect(enable.status).toBe(200)
  await vi.waitFor(() => expect(f.runtime.services.peers.internet.status().connected).toBe(true), {
    timeout: 5000,
  })
  await f.client.load()
  const computer = f.client.snapshot().directory!.servers[0]
  expect(computer.internet?.online).toBe(true)
  const connection = await f.client.connectInternet(
    computer,
    randomBytes(32),
    AbortSignal.timeout(20000),
  )
  expect(f.runtime.services.pairing.pending()).toEqual([])
  expect(f.runtime.services.devices.list().filter((item) => !item.revokedAt)).toHaveLength(1)
  expect(
    (
      await fetch(`http://127.0.0.1:${f.runtime.port}` + '/api/snapshot', {
        headers: { Authorization: 'Bearer ' + connection.token },
      })
    ).status,
  ).toBe(403)
  const peer = await tunnel(connection.peer!)
  const snapshot = await fetch(peer.address + '/api/snapshot', {
    headers: { Authorization: 'Bearer ' + connection.token },
  })
  expect(snapshot.status).toBe(200)
  expect(await snapshot.json()).toMatchObject({ runtimeId: connection.runtimeId, owner: false })
  expect((await f.request({ enabled: false }, connection.token)).status).toBe(403)
  const otherDevice = f.runtime.services.devices.add(
    'Separately paired',
    'separate-paired-device-token',
  )
  expect(otherDevice).toBeTruthy()
  expect(
    (
      await fetch(peer.address + '/api/snapshot', {
        headers: { Authorization: 'Bearer separate-paired-device-token' },
      })
    ).status,
  ).toBe(403)
  const ticket = async () =>
    decode(
      syncTicketSchema,
      await (
        await fetch(peer.address + '/api/sync/ticket', {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + connection.token,
            'Content-Type': 'application/json',
          },
          body: '{}',
        })
      ).json(),
    )
  const firstTicket = await ticket()
  const wrongTransport = new WebSocket(
    `ws://127.0.0.1:${f.runtime.port}/ws/sync?ticket=${firstTicket.ticket}`,
  )
  cleanup.push(() => wrongTransport.terminate())
  wrongTransport.on('error', () => {})
  const rejected = await new Promise<number>((resolve) =>
    wrongTransport.once('unexpected-response', (_request, response) => {
      resolve(response.statusCode ?? 0)
      response.destroy()
    }),
  )
  expect(rejected).toBe(401)
  const liveTicket = await ticket()
  const live = new WebSocket(
    peer.address.replace('http:', 'ws:') + '/ws/sync?ticket=' + liveTicket.ticket,
  )
  cleanup.push(() => live.terminate())
  await once(live, 'open')
  const liveClosed = once(live, 'close')
  f.accounts.revoke(f.phone)
  await liveClosed

  await vi.waitFor(
    () =>
      expect(
        f.runtime.services.devices
          .list()
          .filter((item) => item.name === 'Dovo Connect' && !item.revokedAt),
      ).toHaveLength(0),
    { timeout: 6000 },
  )
  await vi.waitFor(() => expect(peer.ready.readyState).toBe('closed'), { timeout: 5000 })
  expect(
    JSON.stringify(f.accounts.db.prepare('SELECT * FROM internet_requests').all()),
  ).not.toContain(connection.token)
}, 35000)
it('refuses non-owner enablement, and disabling internet preserves a separate LAN pairing', async () => {
  const f = await fixture()
  const paired = 'separate-paired-token-for-test'
  f.runtime.services.devices.add('LAN paired', paired)
  expect((await f.request({ enabled: true, accountToken: f.owner }, paired)).status).toBe(403)
  expect((await f.request({ enabled: true, accountToken: f.owner })).status).toBe(200)
  await vi.waitFor(() => expect(f.runtime.services.peers.internet.status().connected).toBe(true))
  await f.client.load()
  const connection = await f.client.connectInternet(
    f.client.snapshot().directory!.servers[0],
    randomBytes(32),
    AbortSignal.timeout(20000),
  )
  expect((await f.request({ enabled: false })).status).toBe(200)
  expect(f.runtime.services.peers.internet.status().enabled).toBe(false)
  expect(() => f.runtime.services.devices.authenticate(connection.token)).toThrow(
    'Device authentication required',
  )
  expect(
    (
      await fetch(`http://127.0.0.1:${f.runtime.port}` + '/api/snapshot', {
        headers: { Authorization: 'Bearer ' + paired },
      })
    ).status,
  ).toBe(200)
}, 25000)

it('restores account access only after renewed authorization and revokes it when the host signs out', async () => {
  const f = await fixture(true)
  expect((await f.request({ enabled: true, accountToken: f.owner })).status).toBe(200)
  await vi.waitFor(() => expect(f.runtime.services.peers.internet.status().connected).toBe(true))
  await f.client.load()
  const connection = await f.client.connectInternet(
    f.client.snapshot().directory!.servers[0],
    randomBytes(32),
    AbortSignal.timeout(20000),
  )
  const device = f.runtime.services.devices.authenticate(connection.token).id
  await f.restart()
  await vi.waitFor(
    () => {
      expect(f.runtime.services.peers.internet.status().connected).toBe(true)
      expect(f.runtime.services.peers.enabled(device)).toBe(true)
    },
    { timeout: 5000 },
  )
  const peer = await tunnel(connection.peer!)
  expect(
    (
      await fetch(peer.address + '/api/snapshot', {
        headers: { Authorization: 'Bearer ' + connection.token },
      })
    ).status,
  ).toBe(200)
  f.accounts.revoke(f.owner)
  await vi.waitFor(() => expect(f.runtime.services.peers.internet.status().enabled).toBe(false), {
    timeout: 6000,
  })
  await vi.waitFor(() => expect(peer.ready.readyState).toBe('closed'), { timeout: 5000 })
}, 30000)

it('fails closed when the authorization lease expires during a Connect outage', async () => {
  const f = await fixture()
  expect((await f.request({ enabled: true, accountToken: f.owner })).status).toBe(200)
  await vi.waitFor(() => expect(f.runtime.services.peers.internet.status().connected).toBe(true))
  await f.client.load()
  const connection = await f.client.connectInternet(
    f.client.snapshot().directory!.servers[0],
    randomBytes(32),
    AbortSignal.timeout(20000),
  )
  const device = f.runtime.services.devices.authenticate(connection.token).id
  const fetchBeforeOutage = fetch
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, options) => {
      const path = new URL(url instanceof Request ? url.url : url).pathname
      return path.startsWith('/v1/internet/')
        ? Response.json({}, { status: 503 })
        : fetchBeforeOutage(url, options)
    }),
  )
  const beforeOutage = Date.now
  vi.spyOn(Date, 'now').mockImplementation(() => beforeOutage() + 13000)
  expect(f.runtime.services.peers.internet.authorized(device)).toBe(false)
  await vi.waitFor(() => expect(f.runtime.services.peers.enabled(device)).toBe(false), {
    timeout: 3000,
  })
  expect(f.runtime.services.peers.internet.status()).toMatchObject({
    enabled: true,
    connected: false,
  })
  expect(
    (
      await fetch(`http://127.0.0.1:${f.runtime.port}/api/snapshot`, {
        headers: { Authorization: 'Bearer ' + connection.token },
      })
    ).status,
  ).toBe(403)
}, 20000)

it('automatically authorizes Dovo TURN with the account grant and installation proof, including after restart', async () => {
  const issue = vi.fn<PeerRelayIssuer>(
    dovoTurn({
      urls: ['turn:turn.dovo.studio:3478?transport=udp'],
      secret: 'account-internet-test-turn-secret-1234567890',
    }),
  )
  // No legacy operator admission callback or approved installation list.
  const f = await fixture(true, issue)
  expect((await f.request({ enabled: true, accountToken: f.owner })).status).toBe(200)
  await f.client.load()
  const connection = await f.client.connectInternet(
    f.client.snapshot().directory!.servers[0],
    randomBytes(32),
    AbortSignal.timeout(20000),
  )
  const config = connection.peer!
  expect(config.relay).toBe('dovo')
  expect(f.runtime.services.pairing.pending()).toEqual([])
  const join = async () => {
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
        relay: config.relay,
      }),
    )
    const result = decode(peerReadySchema, JSON.parse(String((await ready)[0])))
    expect(result.relayUnavailable).toBeUndefined()
    expect(validPeerRelay(result.relay!, 'dovo')).toBe(true)
    return socket
  }
  const first = await join()
  expect(issue).toHaveBeenLastCalledWith(
    peerRoom(config),
    '127.0.0.1',
    f.runtime.services.peers.relayIdentity().publicKey,
  )
  const device = f.runtime.services.devices.authenticate(connection.token).id
  const disconnected = once(first, 'close')
  await f.restart()
  await disconnected
  await vi.waitFor(
    () => {
      expect(f.runtime.services.peers.internet.status().connected).toBe(true)
      expect(f.runtime.services.peers.enabled(device)).toBe(true)
    },
    { timeout: 5000 },
  )
  const restored = await join()
  expect(issue).toHaveBeenCalledTimes(2)
  const revoked = once(restored, 'close')
  f.accounts.revoke(f.owner)
  await revoked
  await vi.waitFor(() => expect(f.runtime.services.peers.internet.status().enabled).toBe(false), {
    timeout: 6000,
  })
  const denied = new WebSocket(peerSocketUrl(config))
  cleanup.push(() => denied.terminate())
  await once(denied, 'open')
  const closed = once(denied, 'close')
  denied.send(
    JSON.stringify({
      type: 'client',
      room: peerRoom(config),
      key: peerCapability(config, 'client'),
      session: randomBytes(32).toString('hex'),
      relay: config.relay,
    }),
  )
  expect((await closed)[0]).toBe(1008)
  expect(issue).toHaveBeenCalledTimes(2)
}, 30000)

it('enables account access and TURN from a confirmed separate pairing without sending its account session to the runtime', async () => {
  const issue = vi.fn<PeerRelayIssuer>(
    dovoTurn({
      urls: ['turn:turn.test:3478?transport=udp'],
      secret: 'remote-setup-turn-secret-1234567890',
    }),
  )
  const f = await fixture(false, issue)
  const paired = 'paired-human-device-for-remote-setup'
  f.runtime.services.devices.add('Desktop or mobile', paired)
  await f.client.load()
  const inputs: object[] = []
  await f.client.enablePairedInternet(
    f.runtime.services.runtimeId,
    async (session) => {
      const input = { session, consent: true, relay: 'dovo' }
      inputs.push(input)
      const response = await f.call('/api/runtime/internet/setup', input, paired)
      expect(response.status).toBe(200)
      return decode(responses.internetSetup, await response.json())
    },
    async (id, grant) => {
      inputs.push({ id, grant })
      const response = await f.call('/api/runtime/internet/complete', { id, grant }, paired)
      expect(response.status).toBe(200)
      return decode(responses.internetStatus, await response.json())
    },
  )
  expect(JSON.stringify(inputs)).not.toContain(f.phone)
  expect(JSON.stringify(inputs)).not.toContain(paired)
  await vi.waitFor(() => expect(f.runtime.services.peers.internet.status().connected).toBe(true))
  const connection = await f.client.connectInternet(
    f.client.snapshot().directory!.servers[0],
    randomBytes(32),
    AbortSignal.timeout(20000),
  )
  expect(connection.peer?.relay).toBe('dovo')
  const signaling = new WebSocket(peerSocketUrl(connection.peer!))
  cleanup.push(() => signaling.terminate())
  await once(signaling, 'open')
  const issued = once(signaling, 'message')
  signaling.send(
    JSON.stringify({
      type: 'client',
      room: peerRoom(connection.peer!),
      key: peerCapability(connection.peer!, 'client'),
      session: randomBytes(32).toString('hex'),
      relay: 'dovo',
    }),
  )
  expect(decode(peerReadySchema, JSON.parse(String((await issued)[0]))).relay?.provider).toBe(
    'dovo',
  )
  expect(issue).toHaveBeenCalled()
  const closed = once(signaling, 'close')
  signaling.close()
  await closed
  const token = f.runtime.services.devices.authenticate(paired)
  expect(token.owner).toBe(false)
  const snapshot = await fetch(`http://127.0.0.1:${f.runtime.port}/api/snapshot?scope=overview`, {
    headers: { Authorization: 'Bearer ' + paired },
  }).then((r) => r.json())
  expect(snapshot).toMatchObject({
    internetSetupSupported: true,
    internet: { enabled: true, connected: true },
  })
  const peer = await tunnel({ ...connection.peer!, relay: undefined })
  const denied = await fetch(peer.address + '/api/runtime/internet/setup', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ session: 'a'.repeat(43), consent: true, relay: 'dovo' }),
  })
  expect(denied.status).toBe(403)
  await f.client.signOut()
  await vi.waitFor(() => expect(f.runtime.services.peers.internet.status().enabled).toBe(false), {
    timeout: 6000,
  })
  expect(f.runtime.services.devices.authenticate(paired)).toEqual(token)
}, 25000)

it('requires human authentication and explicit consent and binds single-use setup to the requesting device', async () => {
  const f = await fixture()
  const paired = 'remote-setup-paired-device'
  f.runtime.services.devices.add('Paired', paired)
  const other = 'another-paired-device-token'
  f.runtime.services.devices.add('Other device', other)
  const session = createHash('sha256').update(f.phone).digest('base64url')
  const input = { session, consent: true, relay: 'dovo' }
  expect((await f.call('/api/runtime/internet/setup', input, 'unknown')).status).toBe(401)
  expect((await f.call('/api/runtime/internet/setup', { session }, paired)).status).toBe(400)
  expect(
    (await f.call('/api/runtime/internet/setup', { ...input, consent: false }, paired)).status,
  ).toBe(400)
  expect(
    (await f.call('/api/runtime/internet/setup', input, paired, { 'x-dovo-agent-access': '1' }))
      .status,
  ).toBe(403)
  const setup = decode(
    responses.internetSetup,
    await (await f.call('/api/runtime/internet/setup', input, paired)).json(),
  )
  expect(await (await f.call('/api/runtime/internet/setup', input, paired)).json()).toEqual(setup)
  expect((await f.call('/api/runtime/internet/setup', input, other)).status).toBe(409)
  const { grant } = f.internet.register(f.phone, setup.registration)
  expect(
    (await f.call('/api/runtime/internet/complete', { id: setup.id, grant }, other)).status,
  ).toBe(404)
  expect(
    (await f.call('/api/runtime/internet/complete', { id: setup.id, grant }, paired)).status,
  ).toBe(200)
  expect(
    (await f.call('/api/runtime/internet/complete', { id: setup.id, grant }, paired)).status,
  ).toBe(404)
})

it('rejects expired, cancelled and mismatched installation or session grants', async () => {
  const f = await fixture()
  const paired = 'remote-setup-paired-device'
  const deviceId = f.runtime.services.devices.add('Paired', paired)
  const session = createHash('sha256').update(f.phone).digest('base64url')
  const make = async () =>
    decode(
      responses.internetSetup,
      await (
        await f.call(
          '/api/runtime/internet/setup',
          { session, consent: true, relay: 'dovo' },
          paired,
        )
      ).json(),
    )
  const complete = (id: string, grant: string) =>
    f.call('/api/runtime/internet/complete', { id, grant }, paired)
  let setup = await make()
  let grant = f.internet.register(f.phone, setup.registration).grant
  const now = Date.now()
  vi.spyOn(Date, 'now').mockReturnValue(now + 61000)
  expect((await complete(setup.id, grant)).status).toBe(404)
  vi.restoreAllMocks()
  setup = await make()
  grant = f.internet.register(f.phone, setup.registration).grant
  await f.request({ enabled: false })
  expect((await complete(setup.id, grant)).status).toBe(404)
  const originalFetch = fetch
  for (const mismatch of [
    { id: 'different-runtime' },
    { identity: 'different-installation' },
    { publicKey: 'f'.repeat(64) },
    { session: 'different-session' },
  ]) {
    setup = await make()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (url, options) => {
        if (new URL(url instanceof Request ? url.url : url).pathname === '/v1/internet/host')
          return Response.json({
            host: {
              id: setup.registration.id,
              identity: setup.registration.identity,
              publicKey: setup.registration.publicKey,
              session,
              ...mismatch,
            },
          })
        return originalFetch(url, options)
      }),
    )
    expect((await complete(setup.id, grant)).status).toBe(403)
    expect(f.runtime.services.peers.internet.status().enabled).toBe(false)
    vi.unstubAllGlobals()
  }
  setup = await make()
  grant = f.internet.register(f.phone, setup.registration).grant
  let entered!: () => void
  let release!: () => void
  const waiting = new Promise<void>((resolve) => {
    entered = resolve
  })
  const paused = new Promise<void>((resolve) => {
    release = resolve
  })
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(async (url, options) => {
      const result = await originalFetch(url, options)
      if (new URL(url instanceof Request ? url.url : url).pathname === '/v1/internet/host') {
        entered()
        await paused
      }
      return result
    }),
  )
  const result = complete(setup.id, grant)
  await waiting
  f.runtime.services.devices.revoke(deviceId)
  release()
  expect((await result).status).toBe(401)
  expect(f.runtime.services.peers.internet.status().enabled).toBe(false)
})

it.each([
  ['provisioning', 503],
  ['answer', 503],
  ['provisioning', 401],
] as const)(
  'renews authorization while %s is stalled, then fails closed on HTTP %s',
  async (phase, failureStatus) => {
    const f = await fixture()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    cleanup.push(() => {
      vi.useRealTimers()
    })
    expect((await f.request({ enabled: true, accountToken: f.owner })).status).toBe(200)
    await vi.waitFor(() => expect(f.runtime.services.peers.internet.status().connected).toBe(true))
    const { login, token } = f.accounts.createLogin()
    f.accounts.approve(login, { id: 'same-account', name: 'Second phone' })
    f.internet.request(token, f.runtime.services.runtimeId, internetPublicKey(randomBytes(32)))
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    let stalled = 0
    let reads = 0
    let outage = false
    const originalFetch = fetch
    const enable = f.runtime.services.peers.enable.bind(f.runtime.services.peers)
    if (phase === 'provisioning')
      vi.spyOn(f.runtime.services.peers, 'enable').mockImplementation(async (...args) => {
        stalled++
        await pending
        return enable(...args)
      })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (url, options) => {
        const address = new URL(url instanceof Request ? url.url : url)
        if (address.origin === f.origin && address.pathname === '/v1/internet/host') {
          if (!options?.method || options.method === 'GET') {
            if (outage) {
              reads++
              return Response.json({}, { status: failureStatus })
            }
            const response = await originalFetch(url, options)
            const body: unknown = await response.json()
            reads++
            return Response.json(body, { status: response.status })
          }
          if (phase === 'answer' && options?.method === 'POST') {
            stalled++
            await pending
          }
        }
        return originalFetch(url, options)
      }),
    )
    try {
      await vi.advanceTimersByTimeAsync(3000)
      await vi.waitFor(() => expect(stalled).toBe(1))
      const device = f.runtime.services.devices
        .list()
        .find((item) => item.name === 'Dovo Connect')!.id
      // Cross the entire 12-second lease while the same pass remains blocked.
      for (let tick = 0; tick < 5; tick++) {
        const before = reads
        await vi.advanceTimersByTimeAsync(3000)
        await vi.waitFor(() => expect(reads).toBeGreaterThan(before))
        await vi.waitFor(() =>
          expect(f.runtime.services.peers.internet.status().connected).toBe(true),
        )
        expect(f.runtime.services.peers.internet.authorized(device)).toBe(true)
      }
      expect(stalled).toBe(1) // no overlapping provisioning / mutation replay
      outage = true
      for (let tick = 0; tick < 5; tick++) {
        await vi.advanceTimersByTimeAsync(3000)
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      await vi.waitFor(() =>
        expect({
          enabled: f.runtime.services.peers.internet.status().enabled,
          connected: f.runtime.services.peers.internet.status().connected,
          accessRevoked:
            failureStatus === 401
              ? !!f.runtime.services.devices.list().find((item) => item.id === device)?.revokedAt
              : !f.runtime.services.peers.internet.authorized(device),
        }).toEqual({ enabled: failureStatus !== 401, connected: false, accessRevoked: true }),
      )
      release()
    } finally {
      release()
      vi.useRealTimers()
    }
  },
  30000,
)

it('stops restoring devices when the lease expires during enable and denies the existing tunnel', async () => {
  const f = await fixture()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  cleanup.push(() => {
    vi.useRealTimers()
  })
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  cleanup.push(() => {
    release()
  })
  try {
    expect((await f.request({ enabled: true, accountToken: f.owner })).status).toBe(200)
    const peers = f.runtime.services.peers
    await vi.waitFor(() => expect(peers.internet.status().connected).toBe(true))
    // Seed two previously answered devices so this pass exercises only room restoration.
    const other = f.accounts.createLogin()
    f.accounts.approve(other.login, { id: 'same-account', name: 'Other phone' })
    const tokens = ['first-restored-account-device', 'second-restored-account-device']
    const deviceIds = [f.phone, other.token].map((session, index) => {
      const { id } = f.internet.request(
        session,
        f.runtime.services.runtimeId,
        internetPublicKey(randomBytes(32)),
      )
      f.accounts.db.prepare("UPDATE internet_requests SET answer='{}' WHERE id=?").run(id)
      const device = f.runtime.services.devices.add('Restored account phone', tokens[index]!)
      f.runtime.services.db
        .prepare('INSERT INTO account_internet_devices VALUES(?,?,?,?)')
        .run(id, device, '{}', createHash('sha256').update(session).digest('base64url'))
      return device
    })
    let config: PeerConfig | undefined
    const enable = peers.enable.bind(peers)
    const restoring = vi.spyOn(peers, 'enable').mockImplementation(async (...args) => {
      config = await enable(...args)
      await pending
      return config
    })
    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() => expect(config).toBeDefined())
    if (!config) throw new Error('First device did not reach signaling readiness')
    const peer = await tunnel(config)
    const request = () =>
      fetch(peer.address + '/api/snapshot', {
        headers: { Authorization: 'Bearer ' + tokens[0]! },
      })
    expect((await request()).status).toBe(200)
    const internals = peers as unknown as {
      rooms: Map<string, { origin: { readonly active: boolean } }>
      timer?: ReturnType<typeof setInterval>
    }
    const origin = internals.rooms.get(peerRoom(config))!.origin
    expect(origin.active).toBe(true)
    // Isolate per-request authorization from eventual room cleanup, even on a slow CI host.
    clearInterval(internals.timer)
    // Move the lease clock without running another inbox poll.
    vi.setSystemTime(Date.now() + 13000)
    expect(peers.internet.authorized(deviceIds[0]!)).toBe(false)
    expect(origin.active).toBe(false)
    expect((await request()).status).toBe(403)
    release()
    await peers.internet.drain()
    expect(restoring).toHaveBeenCalledTimes(1)
    expect(peers.enabled(deviceIds[1]!)).toBe(false)
  } finally {
    release()
    vi.useRealTimers()
  }
}, 15000)

it('does not publish credentials from provisioning withdrawn by a newer inbox', async () => {
  const f = await fixture()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  cleanup.push(() => {
    vi.useRealTimers()
  })
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const enable = f.runtime.services.peers.enable.bind(f.runtime.services.peers)
  const provisioning = vi
    .spyOn(f.runtime.services.peers, 'enable')
    .mockImplementation(async (...args) => {
      await pending
      return enable(...args)
    })
  try {
    expect((await f.request({ enabled: true, accountToken: f.owner })).status).toBe(200)
    await vi.waitFor(() => expect(f.runtime.services.peers.internet.status().connected).toBe(true))
    const { id } = f.internet.request(
      f.phone,
      f.runtime.services.runtimeId,
      internetPublicKey(randomBytes(32)),
    )
    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() => expect(provisioning).toHaveBeenCalledTimes(1))
    f.accounts.revoke(f.phone)
    await vi.advanceTimersByTimeAsync(3500)
    await vi.waitFor(() =>
      expect(
        f.runtime.services.devices
          .list()
          .filter((item) => item.name === 'Dovo Connect' && !item.revokedAt),
      ).toEqual([]),
    )
    release()
    await vi.waitFor(() => expect(provisioning.mock.settledResults[0]?.type).toBe('rejected'))
    expect(
      f.accounts.db.prepare('SELECT id FROM internet_requests WHERE id=?').get(id),
    ).toBeUndefined()
    expect(f.runtime.services.peers.diagnostics().active).toBe(0)
  } finally {
    release()
    vi.useRealTimers()
  }
}, 15000)

it.each(['resolve', 'reject'] as const)(
  'drains deferred provisioning before SQLite closes when enable later %ss',
  async (outcome) => {
    const f = await fixture()
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    cleanup.push(() => {
      vi.useRealTimers()
    })
    let release!: () => void
    let reject!: (error: Error) => void
    const pending = new Promise<void>((resolve, fail) => {
      release = resolve
      reject = fail
    })
    cleanup.push(() => {
      release()
    })
    const peers = f.runtime.services.peers
    const enable = peers.enable.bind(peers)
    let deferred = false
    vi.spyOn(peers, 'enable').mockImplementation(async (...args) => {
      const config = await enable(...args)
      deferred = true
      await pending
      return config
    })
    const drain = vi.spyOn(peers.internet, 'drain')
    const revoke = vi.spyOn(f.runtime.services.devices, 'revoke')
    const closeDatabase = vi.spyOn(f.runtime.services.db, 'close')
    let closing: Promise<void> | undefined
    let closed = false
    try {
      expect((await f.request({ enabled: true, accountToken: f.owner })).status).toBe(200)
      await vi.waitFor(() => expect(peers.internet.status().connected).toBe(true))
      f.internet.request(f.phone, f.runtime.services.runtimeId, internetPublicKey(randomBytes(32)))
      await vi.advanceTimersByTimeAsync(3000)
      await vi.waitFor(() => expect(deferred).toBe(true))
      vi.useRealTimers()
      closing = f.runtime.close().then(() => {
        closed = true
      })
      await vi.waitFor(() => expect(drain).toHaveBeenCalledTimes(1))
      expect(closed).toBe(false)
      expect(closeDatabase).not.toHaveBeenCalled()
      expect(f.runtime.services.db.open).toBe(true)
      if (outcome === 'resolve') release()
      else reject(new Error('Deferred native signaling failed during shutdown'))
      await closing
      expect(f.runtime.services.db.open).toBe(false)
      expect(revoke).toHaveBeenCalled()
      expect(revoke.mock.invocationCallOrder.at(-1)).toBeLessThan(
        closeDatabase.mock.invocationCallOrder[0]!,
      )
    } finally {
      release()
      vi.useRealTimers()
      await closing
    }
  },
  15000,
)

it('finishes old-generation cleanup before provisioning a re-enabled account', async () => {
  const f = await fixture()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  cleanup.push(() => {
    vi.useRealTimers()
  })
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  cleanup.push(() => {
    release()
  })
  const peers = f.runtime.services.peers
  const enable = peers.enable.bind(peers)
  let deferred = false
  let concurrent = 0
  let maximum = 0
  const provisioning = vi.spyOn(peers, 'enable').mockImplementation(async (...args) => {
    concurrent++
    maximum = Math.max(maximum, concurrent)
    try {
      const config = await enable(...args)
      if (!deferred) {
        deferred = true
        await pending
      }
      return config
    } finally {
      concurrent--
    }
  })
  try {
    expect((await f.request({ enabled: true, accountToken: f.owner })).status).toBe(200)
    await vi.waitFor(() => expect(peers.internet.status().connected).toBe(true))
    f.internet.request(f.phone, f.runtime.services.runtimeId, internetPublicKey(randomBytes(32)))
    await vi.advanceTimersByTimeAsync(3000)
    await vi.waitFor(() => expect(deferred).toBe(true))
    const oldDevice = provisioning.mock.calls[0]![0]
    vi.useRealTimers()
    await peers.internet.disable()
    expect((await f.request({ enabled: true, accountToken: f.owner })).status).toBe(200)
    await vi.waitFor(() => expect(peers.internet.status().connected).toBe(true))
    const { id } = f.internet.request(
      f.phone,
      f.runtime.services.runtimeId,
      internetPublicKey(randomBytes(32)),
    )
    // Let the replacement generation renew and encounter its new request while the old
    // native completion is still deferred. It must not start a second provisioning pass.
    await new Promise<void>((resolve) => setTimeout(resolve, 3500))
    expect(peers.internet.status().connected).toBe(true)
    expect(provisioning).toHaveBeenCalledTimes(1)
    release()
    await vi.waitFor(() => expect(concurrent).toBe(0))
    await vi.waitFor(() => expect(provisioning.mock.calls.length).toBeGreaterThan(1), {
      timeout: 6000,
    })
    await vi.waitFor(() =>
      expect(
        f.accounts.db
          .prepare('SELECT answer FROM internet_requests WHERE id=? AND answer IS NOT NULL')
          .get(id),
      ).toBeDefined(),
    )
    const device = provisioning.mock.calls[1]![0]
    expect(device).not.toBe(oldDevice)
    expect(maximum).toBe(1)
    expect(
      f.runtime.services.devices.list().find((item) => item.id === oldDevice)?.revokedAt,
    ).toBeTruthy()
    expect(peers.internet.contains(device)).toBe(true)
    expect(peers.enabled(device)).toBe(true)
  } finally {
    release()
    vi.useRealTimers()
  }
}, 15000)
