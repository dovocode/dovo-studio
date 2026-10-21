import { afterEach, expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { createServer as tcpServer, type Socket } from 'node:net'
import { once } from 'node:events'
import { randomBytes } from 'node:crypto'
import { WebSocket } from 'ws'
import { RTCPeerConnection } from 'werift'
import {
  AccountClient,
  createPeerPipe,
  decode,
  peerSocketUrl,
  peerRoom,
  peerCapability,
  peerDigest,
  signPeerSignal,
  peerSignalSchema,
  syncTicketSchema,
  verifyPeerSignal,
  type PeerConfig,
} from '@dovo/protocol'
import { AccountStore } from '../../../../apps/connect-server/src/store.js'
import { InternetStore } from '../../../../apps/connect-server/src/internet-store.js'
import { internetApi } from '../../../../apps/connect-server/src/internet-api.js'
import { accountApi } from '../../../../apps/connect-server/src/account-api.js'
import { attachPeerSignaling } from '../../../../apps/connect-server/src/peer-signaling.js'
import { RequestError } from '../../../../apps/connect-server/src/http.js'
import { startRuntime } from '../index.js'
const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
async function fixture(persistent = false) {
  const accounts = new AccountStore(':memory:')
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
  handler = internetApi(internet)
  directory = accountApi(accounts, origin, undefined, internet)
  attachPeerSignaling(
    broker,
    [],
    {},
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
  vi.stubEnv('DOVO_CONNECT_ORIGIN', origin)
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
    accounts.approve(login, { id: 'same-account', name: 'Dominic' })
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
  return {
    get runtime() {
      return runtime
    },
    accounts,
    internet,
    owner,
    phone,
    client,
    request,
    restart: async () => {
      await runtime.close()
      runtime = await startRuntime(options)
    },
  }
}
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
    }),
  )
  await joined
  await pc.setLocalDescription(await pc.createOffer())
  const sdp = pc.localDescription!.sdp,
    answered = once(signaling, 'message')
  signaling.send(
    JSON.stringify(signPeerSignal(config, { session, role: 'offer', offer: peerDigest(sdp), sdp })),
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
