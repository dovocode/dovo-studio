import { expect, it } from 'vite-plus/test'
import { parseListenAddress } from './listen-address.js'
it.each([
  ['http://[::1]', '::1', 80],
  ['https://host', 'host', 443],
  ['http://192.168.1.1:8787', '192.168.1.1', 8787],
])('normalizes saved address %s without upgrading HTTP', (address, host, port) => {
  expect(parseListenAddress({ address })).toMatchObject({ host, port })
})
it.each([
  'file:///tmp/runtime',
  'http://user:password@host',
  'http://host/path',
  'http://host?token=secret',
])('rejects invalid origins %s', (address) => {
  expect(() => parseListenAddress({ address })).toThrow('Invalid saved runtime listening address')
})
