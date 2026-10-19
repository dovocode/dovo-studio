import { expect, it } from 'vite-plus/test'
import { clientAddress } from './client-address.js'

const request = (remoteAddress: string, forwarded?: string) => ({
  socket: { remoteAddress },
  headers: forwarded ? { 'x-forwarded-for': forwarded } : {},
})

it('ignores forged forwarded headers unless the immediate peer is trusted', () => {
  expect(clientAddress([])(request('::ffff:127.0.0.1', '203.0.113.1'))).toBe('127.0.0.1')
  expect(clientAddress(['10.0.0.0/8'])(request('192.0.2.1', '203.0.113.1'))).toBe('192.0.2.1')
})

it('walks the trusted proxy chain from the right and stops at the first untrusted hop', () => {
  const address = clientAddress(['127.0.0.1', '10.0.0.0/8', '::1/128'])
  expect(address(request('127.0.0.1', '203.0.113.1, 10.1.1.1'))).toBe('203.0.113.1')
  expect(address(request('127.0.0.1', '198.51.100.2, 203.0.113.1'))).toBe('203.0.113.1')
  expect(address(request('::1', '2001:db8::1'))).toBe('2001:db8::1')
  expect(address(request('127.0.0.1', 'not-an-ip'))).toBe('127.0.0.1')
  expect(address(request('127.0.0.1', Array(21).fill('10.0.0.1').join(',')))).toBe('127.0.0.1')
})

it('rejects invalid trusted proxy configuration', () => {
  for (const value of ['*', '127.0.0.1/33', '::1/129', '127.0.0.1/8/extra'])
    expect(() => clientAddress([value])).toThrow('Invalid trusted proxy')
})
