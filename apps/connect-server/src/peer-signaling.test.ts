import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { WebSocket } from 'ws'
import { generateKeyPairSync, sign } from 'node:crypto'
import {
  peerRoom,
  peerCapability,
  peerDigest,
  signPeerSignal,
  peerRelayAdmissionPayload,
} from '@dovo/protocol'
import { attachPeerSignaling } from './peer-signaling.js'
import type { PeerRelayIssuer } from './relay-credentials.js'
import { approvedRelayInstallations } from './relay-admission.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})
async function fixture(issueRelay?: PeerRelayIssuer, approved = true) {
  const server = createServer()
  const identity = generateKeyPairSync('ed25519')
  const publicKey = identity.publicKey.export({ format: 'der', type: 'spki' }).toString('base64url')
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanup.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  const port = server.address()
  if (!port || typeof port === 'string') throw new Error('No signaling port')
  attachPeerSignaling(
    server,
    [],
    { cloudflare: issueRelay },
    approvedRelayInstallations(approved ? [publicKey] : []),
    `http://127.0.0.1:${port.port}`,
  )
  const open = async (hello: object, prove = true) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port.port}/v1/peer`)
    cleanup.push(() => {
      socket.terminate()
    })
    await once(socket, 'open')
    const reply = once(socket, 'message').then(async (messages) => {
      const value = JSON.parse(String(messages[0]))
      if (!prove || value.type !== 'relay-challenge') return messages
      const ready = once(socket, 'message')
      socket.send(JSON.stringify(proof(value.challenge)))
      return ready
    })
    socket.send(JSON.stringify(hello))
    return { socket, reply }
  }
  const config = { origin: `http://127.0.0.1:${port.port}`, secret: 'a'.repeat(64) }
  const hostHello = {
    type: 'host',
    room: peerRoom(config),
    key: peerCapability(config, 'host'),
    clientKey: peerCapability(config, 'client'),
    relayIdentity: publicKey,
    relayAllowed: true,
  }
  const clientHello = {
    type: 'client',
    room: peerRoom(config),
    key: peerCapability(config, 'client'),
    session: 'b'.repeat(64),
  }
  const proof = (challenge: string, host = hostHello) => ({
    type: 'relay-proof',
    signature: sign(
      null,
      Buffer.from(
        peerRelayAdmissionPayload(
          challenge,
          host.room,
          host.key,
          host.clientKey,
          host.relayAllowed,
          config.origin,
        ),
      ),
      identity.privateKey,
    ).toString('base64url'),
  })
  return { open, config, hostHello, clientHello, proof }
}
it('exchanges one authenticated offer/answer without any account, HTTP traffic or bearer token', async () => {
  const f = await fixture(),
    host = await f.open(f.hostHello)
  await host.reply
  const client = await f.open(f.clientHello)
  await client.reply
  const sdp = 'v=0\r\na=fingerprint:sha-256 AA:BB\r\n'
  const offer = signPeerSignal(f.config, {
    session: f.clientHello.session,
    role: 'offer',
    offer: peerDigest(sdp),
    sdp,
  })
  const received = once(host.socket, 'message')
  client.socket.send(JSON.stringify(offer))
  expect(JSON.parse(String((await received)[0]))).toEqual({ type: 'offer', signal: offer })
  const answered = once(client.socket, 'message')
  const answer = signPeerSignal(f.config, { ...offer, role: 'answer' })
  host.socket.send(JSON.stringify(answer))
  expect(JSON.parse(String((await answered)[0]))).toEqual(answer)
  const closed = once(client.socket, 'close')
  client.socket.send(JSON.stringify(offer))
  expect((await closed)[0]).toBe(1008)
})
it('issues relay credentials only after a valid room join and sends the same ICE configuration to both peers', async () => {
  const relay = {
    provider: 'cloudflare' as const,
    expiresAt: Date.now() + 86400000,
    iceServers: [
      {
        urls: ['turn:turn.cloudflare.com:3478?transport=udp'],
        username: 'temporary',
        credential: 'short-lived',
      },
    ],
  }
  const issue = vi.fn<PeerRelayIssuer>(async () => relay)
  const f = await fixture(issue),
    host = await f.open(f.hostHello)
  await host.reply
  expect(issue).not.toHaveBeenCalled()
  const invalid = await f.open({ ...f.clientHello, key: '0'.repeat(64) })
  void invalid.reply.catch(() => {})
  await once(invalid.socket, 'close')
  expect(issue).not.toHaveBeenCalled()
  const client = await f.open({ ...f.clientHello, relay: 'cloudflare' })
  expect(JSON.parse(String((await client.reply)[0]))).toEqual({ type: 'ready', relay })
  const sdp = 'v=0\r\na=fingerprint:sha-256 AA:BB\r\n'
  const signal = signPeerSignal(f.config, {
    session: f.clientHello.session,
    role: 'offer',
    offer: peerDigest(sdp),
    sdp,
    relay: 'cloudflare',
  })
  const received = once(host.socket, 'message')
  client.socket.send(JSON.stringify(signal))
  expect(JSON.parse(String((await received)[0]))).toEqual({ type: 'offer', signal, relay })
  expect(issue).toHaveBeenCalledOnce()
})
it('keeps direct signaling working when the relay provider fails or hits its limit', async () => {
  const f = await fixture(async () => {
    throw new Error('Provider secret must not escape')
  })
  const host = await f.open(f.hostHello)
  await host.reply
  const client = await f.open({ ...f.clientHello, relay: 'cloudflare' })
  expect(JSON.parse(String((await client.reply)[0]))).toEqual({
    type: 'ready',
    relayUnavailable: 'cloudflare',
  })
})
it('never issues relay credentials without explicit consent, even when a provider is configured', async () => {
  const issue = vi.fn<PeerRelayIssuer>(async () => {
    throw new Error('Should never be called')
  })
  const f = await fixture(issue),
    host = await f.open(f.hostHello)
  await host.reply
  const client = await f.open(f.clientHello)
  expect(JSON.parse(String((await client.reply)[0]))).toEqual({ type: 'ready' })
  expect(issue).not.toHaveBeenCalled()
})
it('denies relay grants to self-created rooms and installations without operator approval', async () => {
  for (const identity of [true, false]) {
    const issue = vi.fn<PeerRelayIssuer>()
    const f = await fixture(issue, false)
    const { relayIdentity, ...anonymous } = f.hostHello
    expect(relayIdentity).toBeTruthy()
    const host = await f.open(identity ? f.hostHello : anonymous)
    await host.reply
    const client = await f.open({ ...f.clientHello, relay: 'cloudflare' })
    expect(JSON.parse(String((await client.reply)[0]))).toEqual({
      type: 'ready',
      relayUnavailable: 'cloudflare',
    })
    expect(issue).not.toHaveBeenCalled()
  }
})
it('requires a fresh, socket-bound signature before issuing any relay credentials', async () => {
  const issue = vi.fn<PeerRelayIssuer>()
  const f = await fixture(issue)
  const first = await f.open(f.hostHello, false)
  const challenge = JSON.parse(String((await first.reply)[0])).challenge
  const oldProof = f.proof(challenge)
  const gone = once(first.socket, 'close')
  first.socket.close()
  await gone
  const replacement = await f.open(f.hostHello, false)
  const fresh = JSON.parse(String((await replacement.reply)[0])).challenge
  expect(fresh).not.toBe(challenge)
  const ready = once(replacement.socket, 'message')
  replacement.socket.send(JSON.stringify(oldProof))
  expect(JSON.parse(String((await ready)[0]))).toEqual({ type: 'ready', relayApproved: false })
  const client = await f.open({ ...f.clientHello, relay: 'cloudflare' })
  expect(JSON.parse(String((await client.reply)[0])).relayUnavailable).toBe('cloudflare')
  expect(issue).not.toHaveBeenCalled()
})
it('waits for host admission when a phone joins during the challenge', async () => {
  const relay = {
    provider: 'dovo' as const,
    expiresAt: Date.now() + 600000,
    iceServers: [
      { urls: ['turn:turn.dovo.studio:3478?transport=udp'], username: 'test', credential: 'test' },
    ],
  }
  const issue = vi.fn<PeerRelayIssuer>(async () => relay)
  const f = await fixture(issue)
  const host = await f.open(f.hostHello, false)
  const challenge = JSON.parse(String((await host.reply)[0])).challenge
  const client = await f.open({ ...f.clientHello, relay: 'cloudflare' })
  host.socket.send(JSON.stringify(f.proof(challenge)))
  expect(JSON.parse(String((await client.reply)[0]))).toEqual({ type: 'ready', relay })
  expect(issue).toHaveBeenCalledOnce()
})
it('requires host relay consent even for an approved installation', async () => {
  const issue = vi.fn<PeerRelayIssuer>()
  const f = await fixture(issue)
  const hello = { ...f.hostHello, relayAllowed: false }
  const host = await f.open(hello, false)
  const challenge = JSON.parse(String((await host.reply)[0])).challenge
  const ready = once(host.socket, 'message')
  host.socket.send(JSON.stringify(f.proof(challenge, hello)))
  expect(JSON.parse(String((await ready)[0])).relayApproved).toBe(true)
  const client = await f.open({ ...f.clientHello, relay: 'cloudflare' })
  expect(JSON.parse(String((await client.reply)[0])).relayUnavailable).toBe('cloudflare')
  expect(issue).not.toHaveBeenCalled()
})
it('binds approval to the room and both signaling capabilities', async () => {
  for (const change of [
    { room: 'c'.repeat(64) },
    { key: 'c'.repeat(64) },
    { clientKey: 'c'.repeat(64) },
    { relayAllowed: false },
  ]) {
    const issue = vi.fn<PeerRelayIssuer>()
    const f = await fixture(issue)
    const host = await f.open(f.hostHello, false)
    const challenge = JSON.parse(String((await host.reply)[0])).challenge
    const ready = once(host.socket, 'message')
    host.socket.send(JSON.stringify(f.proof(challenge, { ...f.hostHello, ...change })))
    expect(JSON.parse(String((await ready)[0])).relayApproved).toBe(false)
    const client = await f.open({ ...f.clientHello, relay: 'cloudflare' })
    expect(JSON.parse(String((await client.reply)[0])).relayUnavailable).toBe('cloudflare')
    expect(issue).not.toHaveBeenCalled()
  }
})
it('rejects other room capabilities, duplicate hosts, binary and application messages', async () => {
  const f = await fixture(),
    host = await f.open(f.hostHello)
  await host.reply
  for (const hello of [
    f.hostHello,
    { ...f.clientHello, key: 'c'.repeat(64) },
    { ...f.clientHello, room: 'c'.repeat(64) },
  ]) {
    // Invalid hello closes without a reply; avoid an unobserved message waiter.
    const attempt = await f.open(hello)
    void attempt.reply.catch(() => {})
    expect((await once(attempt.socket, 'close'))[0]).toBe(1008)
  }
  for (const body of [
    JSON.stringify({ type: 'http', token: 'must-never-forward', body: 'user content' }),
    Buffer.from('binary-content'),
  ]) {
    const client = await f.open(f.clientHello)
    await client.reply
    const closed = once(client.socket, 'close')
    client.socket.send(body)
    expect((await closed)[0]).toBe(1008)
  }
})
it('closes pending joins when the computer disconnects and permits clean reconnection', async () => {
  const f = await fixture(),
    host = await f.open(f.hostHello)
  await host.reply
  const client = await f.open(f.clientHello)
  await client.reply
  const gone = once(client.socket, 'close')
  host.socket.close()
  expect((await gone)[0]).toBe(1012)
  const replacement = await f.open(f.hostHello)
  expect(JSON.parse(String((await replacement.reply)[0]))).toEqual({ type: 'ready' })
})
