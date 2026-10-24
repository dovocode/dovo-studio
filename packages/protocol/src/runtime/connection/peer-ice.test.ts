import { expect, it, vi } from 'vite-plus/test'
import {
  createPeerIce,
  signPeerIce,
  PEER_ICE_LIMIT,
  type PeerIceSignal,
  type PeerIceCandidate,
} from './peer-ice.js'

const config = { origin: 'https://connect.dovo.studio', secret: 'a'.repeat(64) }
const session = 'b'.repeat(64),
  offer = 'c'.repeat(64)
const candidate = {
  candidate: 'candidate:1 1 UDP 1 192.0.2.1 1234 typ host',
  sdpMid: '0',
  sdpMLineIndex: 0,
}
const message = (sequence = 0) =>
  signPeerIce(config, { type: 'ice', session, offer, role: 'answer', sequence, candidate })
function fixture() {
  const send = vi.fn<(value: PeerIceSignal) => void>(),
    add = vi.fn<(value: PeerIceCandidate | null) => Promise<void>>(async () => {}),
    onError = vi.fn<(error: unknown) => void>()
  const ice = createPeerIce({ config, session, offer, role: 'offer', send, add, onError })
  return { ice, send, add, onError }
}
it('holds local candidates until the signed offer is sent and remote candidates until SDP is applied', async () => {
  const f = fixture()
  f.ice.candidate(candidate)
  f.ice.candidate(null)
  expect(f.send).not.toHaveBeenCalled()
  f.ice.start()
  expect(f.send.mock.calls.map(([v]) => [v.sequence, v.candidate])).toEqual([
    [0, candidate],
    [1, null],
  ])
  f.ice.receive(message())
  f.ice.receive(signPeerIce(config, { ...message(1), candidate: null }))
  expect(f.add).not.toHaveBeenCalled()
  f.ice.ready()
  await vi.waitFor(() => expect(f.add).toHaveBeenCalledTimes(2))
  expect(f.add.mock.calls).toEqual([[candidate], [null]])
})
it('rejects tampered candidates, cross-session delivery, roles, replay and skipped sequence numbers', () => {
  for (const attack of [
    {
      ...message(),
      candidate: { ...candidate, candidate: candidate.candidate.replace('192.0.2.1', '192.0.2.2') },
    },
    signPeerIce(config, { ...message(), session: 'd'.repeat(64) }),
    signPeerIce(config, { ...message(), offer: 'd'.repeat(64) }),
    signPeerIce(config, { ...message(), role: 'offer' }),
    message(1),
    { ...message(), mac: '0'.repeat(64) },
  ]) {
    const f = fixture()
    f.ice.receive(attack)
    f.ice.ready()
    expect(f.onError).toHaveBeenCalledOnce()
    expect(f.add).not.toHaveBeenCalled()
  }
  const f = fixture()
  f.ice.receive(message())
  f.ice.receive(message())
  expect(f.onError).toHaveBeenCalledOnce()
})
it('bounds queued work, authenticates end markers and ignores delivery after teardown', () => {
  const f = fixture()
  for (let i = 0; i < PEER_ICE_LIMIT + 2; i++) f.ice.candidate(candidate)
  f.ice.candidate(null)
  f.ice.start()
  expect(f.send).toHaveBeenCalledTimes(PEER_ICE_LIMIT + 1)
  const end = signPeerIce(config, { ...message(), candidate: null })
  f.ice.receive(end)
  f.ice.receive(message(1))
  expect(f.onError).toHaveBeenCalledOnce()
  f.ice.stop()
  f.ice.receive(message())
  f.ice.candidate(candidate)
  f.ice.ready()
  expect(f.add).not.toHaveBeenCalled()
})
it('serializes native candidate application and stops queued writes on cancellation', async () => {
  const f = fixture()
  let release = () => {}
  f.add.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
  )
  f.ice.ready()
  f.ice.receive(message())
  f.ice.receive(message(1))
  expect(f.add).toHaveBeenCalledOnce()
  f.ice.stop()
  release()
  await Promise.resolve()
  expect(f.add).toHaveBeenCalledOnce()
})
it('stops all queued work after signaling or native candidate application fails', async () => {
  const sender = fixture()
  sender.send.mockImplementation(() => {
    throw new Error('Signaling closed')
  })
  sender.ice.candidate(candidate)
  sender.ice.start()
  sender.ice.candidate(candidate)
  expect(sender.onError).toHaveBeenCalledOnce()
  expect(sender.send).toHaveBeenCalledOnce()
  const receiver = fixture()
  receiver.add.mockRejectedValue(new Error('Native peer closed'))
  receiver.ice.receive(message())
  receiver.ice.receive(message(1))
  receiver.ice.ready()
  await vi.waitFor(() => expect(receiver.onError).toHaveBeenCalledOnce())
  receiver.ice.receive(message(2))
  expect(receiver.add).toHaveBeenCalledOnce()
})
