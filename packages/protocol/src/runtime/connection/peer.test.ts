import { expect, it } from 'vite-plus/test'
import {
  peerAddress,
  peerConfigSchema,
  peerDigest,
  peerSignalSchema,
  signPeerSignal,
  verifyPeerSignal,
  registerPeerTransport,
  resolvePeerTransport,
  peerTransportAddress,
  validPeerRelay,
  peerRelaySchema,
} from './peer.js'
import { decode, ValidationError } from '../../shared/schema.js'
import { pairingInvitationUrl, parsePairingInvitation } from '../../auth/pairing-invitation.js'
import { learnRuntimeRoutes, resolveRuntimeEndpoint, runtimeTransportAddress } from './routes.js'
import { snapshotSchema } from './runtime.js'

const config = { origin: 'https://connect.dovo.studio', secret: 'a'.repeat(64) }
const sdp =
  'v=0\r\na=fingerprint:sha-256 AA:BB\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n'
const value = { session: 'b'.repeat(64), role: 'offer' as const, offer: peerDigest(sdp), sdp }
it('rejects invalid relay lifetimes and unapproved relay providers', () => {
  const now = 1000000
  const relay = {
    provider: 'dovo' as const,
    expiresAt: now + 600000,
    iceServers: [
      { urls: ['turn:turn.dovo.studio:3478?transport=udp'], username: 'test', credential: 'test' },
    ],
  }
  expect(validPeerRelay(relay, 'dovo', now)).toBe(true)
  for (const expiresAt of [now - 1, now + 60000, now + 600001, Infinity, NaN])
    expect(validPeerRelay({ ...relay, expiresAt }, 'dovo', now)).toBe(false)
  expect(validPeerRelay(relay, undefined, now)).toBe(false)
  expect(validPeerRelay(relay, 'cloudflare', now)).toBe(false)
  for (const url of [
    'turn:127.0.0.1:3478?transport=udp',
    'turn:evil.example:3478?transport=udp',
    'turn:turn.dovo.studio.evil.example:3478?transport=udp',
    'turns:turn.dovo.studio:5349?transport=udp',
    'turn:turn.dovo.studio:0?transport=tcp',
  ])
    expect(
      validPeerRelay(
        { ...relay, iceServers: [{ ...relay.iceServers[0]!, urls: [url] }] },
        'dovo',
        now,
      ),
    ).toBe(false)
  expect(
    validPeerRelay(
      {
        ...relay,
        iceServers: [{ ...relay.iceServers[0]!, urls: ['turn:127.0.0.1:3478?transport=udp'] }],
      },
      'dovo',
      now,
      ['127.0.0.1'],
    ),
  ).toBe(true)
  for (const expiresAt of [Infinity, NaN, -1, 1.5])
    expect(() =>
      decode(peerRelaySchema, {
        ...relay,
        expiresAt,
        iceServers: [
          { urls: ['turn:example.com:3478?transport=udp'], username: 'test', credential: 'test' },
        ],
      }),
    ).toThrow(ValidationError)
})
it('never resolves a peer transport to a network address or a credential-bearing URL', async () => {
  for (const target of [
    'https://public.example',
    'http://192.168.1.2:8787',
    'http://127.0.0.1:0',
    'http://user:password@127.0.0.1:1234',
    'http://127.0.0.1:1234/path',
  ]) {
    registerPeerTransport({ resolve: async () => target, address: () => target })
    await expect(
      resolvePeerTransport(peerAddress(config), config, new AbortController().signal),
    ).rejects.toThrow('loopback')
    expect(() => peerTransportAddress(peerAddress(config))).toThrow('loopback')
  }
})
it('authenticates the full SDP, role, session and offer binding independently of Connect', () => {
  const signal = signPeerSignal(config, value)
  expect(verifyPeerSignal(config, signal)).toBe(true)
  for (const change of [
    { sdp: sdp.replace('AA:BB', 'CC:DD') },
    { session: 'c'.repeat(64) },
    { role: 'answer' as const },
    { offer: '0'.repeat(64) },
    { mac: '0'.repeat(64) },
    { relay: 'dovo' as const },
  ])
    expect(verifyPeerSignal(config, { ...signal, ...change })).toBe(false)
  expect(verifyPeerSignal({ ...config, secret: 'b'.repeat(64) }, signal)).toBe(false)
  expect(verifyPeerSignal(config, signPeerSignal(config, { ...value, sdp: 'v=0' }))).toBe(false)
})
it('authenticates trickle and flow-control capabilities without changing legacy signatures', () => {
  const signal = signPeerSignal(config, { ...value, trickle: true, pipeWindow: 64 })
  expect(verifyPeerSignal(config, signal)).toBe(true)
  expect(verifyPeerSignal(config, { ...signal, trickle: undefined })).toBe(false)
  expect(verifyPeerSignal(config, { ...signal, pipeWindow: undefined })).toBe(false)
  expect(verifyPeerSignal(config, signPeerSignal(config, value))).toBe(true)
})
it('bounds SDP and permits only HTTPS signaling, with loopback HTTP for isolated tests', () => {
  for (const origin of [
    'http://public.example',
    'https://user:pass@example.com',
    'https://connect.example/path',
    'https://connect.example/',
  ])
    expect(() => decode(peerConfigSchema, { ...config, origin })).toThrow('origin:')
  expect(() => decode(peerConfigSchema, { ...config, secret: '1234' })).toThrow('secret:')
  expect(() =>
    decode(peerSignalSchema, signPeerSignal(config, { ...value, sdp: 'x'.repeat(65537) })),
  ).toThrow('sdp:')
})
it('roundtrips an internet invitation without a LAN/VPN address and binds its key to the identity', () => {
  const invite = {
    address: peerAddress(config),
    peer: config,
    code: '00112233',
    expiresAt: new Date(Date.now() + 120000).toISOString(),
  }
  expect(parsePairingInvitation(pairingInvitationUrl(invite))).toEqual(invite)
  expect(() => pairingInvitationUrl({ ...invite, address: 'http://other.example' })).toThrow(
    'does not match',
  )
  expect(() => pairingInvitationUrl({ ...invite, peer: undefined })).toThrow('Invalid internet')
})
it('keeps peer routes on the encrypted tunnel even when snapshots advertise LAN routes', async () => {
  const connection = {
    address: peerAddress(config),
    token: 'paired-token-never-at-broker',
    peer: config,
  }
  let calls = 0
  registerPeerTransport({
    address: () => 'http://127.0.0.1:12345',
    resolve: async (address, selected) => {
      expect(address).toBe(connection.address)
      expect(selected).toEqual(config)
      calls++
      return 'http://127.0.0.1:12345'
    },
  })
  const snapshot = decode(snapshotSchema, {
    revision: 1,
    workspace: {
      version: 1,
      runtimeAddress: 'http://localhost:8787',
      agents: [],
      repositories: [],
      tasks: [],
      automations: [],
    },
    approvals: [],
    terminals: [],
    runs: [],
    devices: [],
    pendingDevices: [],
    owner: false,
    runtimeId: 'runtime-a',
    runtimeAddresses: ['http://192.168.1.2:8787'],
  })
  const learned = learnRuntimeRoutes(connection, snapshot)
  expect(learned.alternateAddresses).toEqual([])
  expect((await resolveRuntimeEndpoint(learned, new AbortController().signal)).address).toBe(
    'http://127.0.0.1:12345',
  )
  expect(runtimeTransportAddress(learned, 'stream')).toBe('http://127.0.0.1:12345')
  expect(calls).toBe(1)
  expect(() => learnRuntimeRoutes({ ...connection, runtimeId: 'other-runtime' }, snapshot)).toThrow(
    'different runtime',
  )
})
