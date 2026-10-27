import { afterEach, expect, it, vi } from 'vite-plus/test'
import { StudioPeers } from './peers.js'
const peer = {
  id: 'remote',
  name: 'Remote',
  connection: {
    address: 'http://remote.lan:8787',
    token: 'private-paired-token-at-least-32-chars',
  },
}
afterEach(() => vi.useRealTimers())
it('expires disconnected pairings, drops revoked clients and rejects session hijacking', () => {
  vi.useFakeTimers()
  const peers = new StudioPeers()
  let allowed = true
  const authorize = () => {
    if (!allowed) throw new Error('Revoked')
  }
  peers.register('device', { sessionId: 'session', peers: [peer] }, authorize)
  expect(peers.list()).toEqual([peer])
  expect(() =>
    peers.register('other-device', { sessionId: 'session', peers: [] }, () => {}),
  ).toThrow('another device')
  vi.advanceTimersByTime(45001)
  expect(peers.list()).toEqual([])
  peers.register('device', { sessionId: 'session', peers: [peer] }, authorize)
  allowed = false
  expect(peers.list()).toEqual([])
})
it('keeps the same profile ID from separate Studio sessions visible for ambiguity checks', () => {
  const peers = new StudioPeers()
  const first = { ...peer, connection: { ...peer.connection, runtimeId: 'first-runtime' } }
  const second = { ...peer, connection: { ...peer.connection, runtimeId: 'second-runtime' } }
  peers.register('desktop', { sessionId: 'desktop-session', peers: [first] }, () => {})
  peers.register('browser', { sessionId: 'browser-session', peers: [second] }, () => {})
  expect(peers.list()).toEqual([first, second])
})
it('rejects ambiguous computer IDs and updates pairings without retaining removed credentials', () => {
  const peers = new StudioPeers()
  expect(() =>
    peers.register('device', { sessionId: 'session', peers: [peer, peer] }, () => {}),
  ).toThrow('unique')
  expect(() =>
    peers.register('device', { sessionId: 'session', peers: [{ ...peer, id: 'local' }] }, () => {}),
  ).toThrow('cannot be local')
  peers.register('device', { sessionId: 'session', peers: [peer] }, () => {})
  const updated = {
    ...peer,
    connection: { ...peer.connection, token: 'replacement-paired-token-at-least-32-chars' },
  }
  peers.register('device', { sessionId: 'session', peers: [updated] }, () => {})
  expect(peers.list()).toEqual([updated])
  // A reload gets a new session ID; its complete registry supersedes the old lease.
  peers.register('device', { sessionId: 'reloaded-session', peers: [] }, () => {})
  expect(peers.list()).toEqual([])
})
