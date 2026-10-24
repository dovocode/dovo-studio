import { afterEach, expect, it } from 'vite-plus/test'
import {
  Candidate,
  CandidatePairState,
  Connection,
  RTCPeerConnection,
  parseIceServers,
} from 'werift'

const connections: Connection[] = []
afterEach(async () => {
  for (const connection of connections.splice(0)) await connection.close()
})

it('preserves all TURN URL transports and their credentials through configuration updates', async () => {
  const servers = [
    {
      urls: ['turn:one.test:3478?transport=udp', 'turns:one.test:443?transport=tcp'],
      username: 'one',
      credential: 'first',
    },
    { urls: 'turn:two.test:3478?transport=tcp', username: 'two', credential: 'second' },
  ]
  const expected = [
    { address: ['one.test', 3478], transport: 'udp', username: 'one', password: 'first' },
    { address: ['one.test', 443], transport: 'tls', username: 'one', password: 'first' },
    { address: ['two.test', 3478], transport: 'tcp', username: 'two', password: 'second' },
  ]
  expect(parseIceServers(servers).turnServers).toEqual(expected)
  const pc = new RTCPeerConnection({ iceServers: [] })
  try {
    pc.createDataChannel('configuration-test')
    pc.setConfiguration({ iceServers: servers })
    expect(pc.iceTransports[0]?.connection.options.turnServers).toEqual(expected)
    pc.setConfiguration({ iceServers: [] })
    expect(pc.iceTransports[0]?.connection.options.turnServers).toBeUndefined()
    expect(pc.iceTransports[0]?.connection.turnServer).toBeUndefined()
  } finally {
    await pc.close()
  }
})

it('finishes failed ICE checks when the last candidate arrives after the failed pairs', async () => {
  const connection = new Connection(true, { useIpv4: true, useIpv6: false, stunServer: undefined })
  connections.push(connection)
  await connection.gatherCandidates()
  connection.remoteUsername = 'remote'
  connection.remotePassword = 'remote-password'
  await connection.addRemoteCandidate(Candidate.fromSdp('1 1 udp 1 192.0.2.1 1234 typ host'))
  expect(connection.checkList.length).toBeGreaterThan(0)
  // Failed pairs with no more checks must wait for late candidates, then fail
  // exactly once when gathering ends rather than hang on an empty result queue.
  for (const pair of connection.checkList) pair.updateState(CandidatePairState.FAILED)
  let settled = false
  const result = connection.connect().then(
    () => {
      settled = true
      return null
    },
    (error: unknown) => {
      settled = true
      return error
    },
  )
  await Promise.resolve()
  expect(settled).toBe(false)
  await connection.addRemoteCandidate(undefined)
  expect(await result).toEqual(new Error('ICE negotiation failed'))
})

it('closes a peer during gathering without resurrecting its ICE state or advertising late candidates', async () => {
  const connection = new Connection(true, { useIpv4: true, useIpv6: false, stunServer: undefined })
  connections.push(connection)
  const candidates: Candidate[] = []
  connection.onIceCandidate.subscribe((candidate) => candidates.push(candidate))
  const gathering = connection.gatherCandidates()
  await connection.close()
  await gathering
  expect(connection.state).toBe('closed')
  expect(connection.localCandidates).toEqual([])
  expect(candidates).toEqual([])
})
