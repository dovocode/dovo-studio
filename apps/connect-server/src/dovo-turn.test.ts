import { expect, it } from 'vite-plus/test'
import { createHmac } from 'node:crypto'
import { dovoTurn } from './dovo-turn.js'

it('issues coturn REST credentials that expire without disclosing the shared secret', async () => {
  const secret = 'private-shared-turn-secret-only-on-backend'
  const urls = [
    'turn:turn.example.com:3478?transport=udp',
    'turns:turn.example.com:443?transport=tcp',
  ]
  const issue = dovoTurn({ secret, urls, now: () => 1000000 })
  const grant = await issue('paired-room', 'ip')
  expect(grant.provider).toBe('dovo')
  expect(grant.expiresAt).toBe(1600000)
  const server = grant.iceServers[0]!
  expect(server.username).toMatch(/^1600:dovo-[a-f0-9]{32}$/)
  expect(server.credential).toBe(
    createHmac('sha1', secret).update(server.username).digest('base64'),
  )
  expect(server.urls).toEqual(urls)
  expect(JSON.stringify(grant)).not.toContain(secret)
  expect(await issue('paired-room', 'ip')).toEqual(grant)
  expect((await issue('other-room', 'ip')).iceServers[0]?.credential).not.toBe(server.credential)
})
it('rejects incomplete setup and bounds new grants even when no provider API is involved', async () => {
  const secret = 'a'.repeat(43),
    urls = ['turns:turn.example.com:443?transport=tcp']
  expect(() => dovoTurn({ secret: 'short', urls })).toThrow('shared secret')
  expect(() => dovoTurn({ secret, urls: [] })).toThrow('TURN URLs')
  expect(() => dovoTurn({ secret, urls: ['https://example.com'] })).toThrow('TURN URLs')
  const issue = dovoTurn({ secret, urls, hourlyLimit: 1 })
  await issue('a', 'ip')
  await expect(issue('b', 'other')).rejects.toThrow('busy')
})
it.each([
  'turn:turn.example.com:0?transport=udp',
  'turn:turn.example.com:65536?transport=tcp',
  'turns:turn.example.com:443?transport=udp',
  'turn:turn..example.com:3478?transport=udp',
  'turn:-invalid.example.com:3478?transport=udp',
  'turn:TURN.example.com:3478?transport=udp',
])('rejects unusable TURN endpoints at startup: %s', (url) => {
  expect(() => dovoTurn({ secret: 'a'.repeat(43), urls: [url] })).toThrow('TURN URLs')
})
it('rejects more TURN endpoints than clients can accept', () => {
  expect(() =>
    dovoTurn({
      secret: 'a'.repeat(43),
      urls: Array(9).fill('turn:turn.example.com:3478?transport=udp'),
    }),
  ).toThrow('TURN URLs')
})
it('refreshes cached grants before the client expiry margin, including subsecond rounding', async () => {
  let time = 1000500
  const issue = dovoTurn({
    secret: 'local-test-only-secret-at-least-32-chars',
    urls: ['turn:turn.example.com:3478?transport=udp'],
    now: () => time,
  })
  const grant = await issue('room', 'ip')
  time = grant.expiresAt - 60000
  const next = await issue('room', 'ip')
  expect(next.iceServers[0]?.credential).not.toBe(grant.iceServers[0]?.credential)
  expect(next.expiresAt).toBeGreaterThan(time + 60000)
})
it('shares a short-lived grant across an approved installation and attributes it without storing the public key in TURN logs', async () => {
  let time = 1000000
  const issue = dovoTurn({
    secret: 'local-test-only-secret-at-least-32-chars',
    urls: ['turn:turn.example.com:3478?transport=udp'],
    now: () => time,
  })
  const grant = await issue('room-one', 'phone-ip-one', 'installation-public-key')
  expect(await issue('room-two', 'phone-ip-two', 'installation-public-key')).toEqual(grant)
  expect(grant.iceServers[0]?.username).toMatch(/^1600:dovo-[a-f0-9]{16}-[a-f0-9]{32}$/)
  expect(JSON.stringify(grant)).not.toContain('installation-public-key')
  time += 300000
  const renewed = await issue('room-three', 'phone-ip-three', 'installation-public-key')
  expect(renewed.expiresAt).toBe(1900000)
  expect(renewed.iceServers[0]?.credential).not.toBe(grant.iceServers[0]?.credential)
})
