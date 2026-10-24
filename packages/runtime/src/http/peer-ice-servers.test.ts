import { expect, it } from 'vite-plus/test'
import { peerRelayServers } from './peer-ice-servers.js'

it('tries every transport even when many TLS URLs precede UDP, bounds allocations and preserves credentials', () => {
  const tls = Array.from({ length: 8 }, (_, i) => `turns:relay.test:${443 + i}?transport=tcp`)
  const servers = peerRelayServers([
    { urls: tls, username: 'tls-user', credential: 'tls-secret' },
    {
      urls: ['turn:other.test:3478?transport=udp', 'turn:other.test:3478?transport=tcp'],
      username: 'other-user',
      credential: 'other-secret',
    },
  ])
  expect(servers).toEqual([
    {
      urls: 'turn:other.test:3478?transport=udp',
      username: 'other-user',
      credential: 'other-secret',
    },
    {
      urls: 'turn:other.test:3478?transport=tcp',
      username: 'other-user',
      credential: 'other-secret',
    },
    { urls: tls[0], username: 'tls-user', credential: 'tls-secret' },
    { urls: tls[1], username: 'tls-user', credential: 'tls-secret' },
  ])
})

it('deduplicates identical allocations and keeps direct connections relay-free', () => {
  const server = { urls: ['turn:relay.test:3478'], username: 'user', credential: 'secret' }
  expect(peerRelayServers([server, server])).toEqual([{ ...server, urls: server.urls[0] }])
  expect(peerRelayServers()).toEqual([])
})
