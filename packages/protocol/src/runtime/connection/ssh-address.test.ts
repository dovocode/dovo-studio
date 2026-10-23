import { expect, it } from 'vite-plus/test'
import { decodeResult } from '../../shared/schema.js'
import { parseSshAddress, sshAddressSchema, formatSshAddress } from './ssh-address.js'

it.each([
  ['ssh://dominic@buildbox', { sshHost: 'buildbox', sshUser: 'dominic', sshPort: 22 }],
  ['ssh://dev@100.64.0.1:2222', { sshHost: '100.64.0.1', sshUser: 'dev', sshPort: 2222 }],
  ['ssh://dev@[2001:db8::1]:2222', { sshHost: '2001:db8::1', sshUser: 'dev', sshPort: 2222 }],
])('parses reusable SSH coordinates %s', (address, expected) => {
  expect(parseSshAddress(address)).toEqual(expected)
  expect(decodeResult(sshAddressSchema, address).success).toBe(true)
})
it.each([
  'https://dev@host',
  'ssh://dev:secret@host',
  'ssh://host',
  'ssh://dev@host/key',
  'ssh://dev@host?key=secret',
  'ssh://dev@host#secret',
  'ssh://-oProxyCommand@host',
  'ssh://dev@-bad',
  'ssh://dev@host:0',
  'ssh://dev@host:65536',
  'ssh://dev%20name@host',
  'ssh://dev@ho\nst',
])('rejects unsafe or incomplete SSH address %s', (address) => {
  expect(decodeResult(sshAddressSchema, address).success).toBe(false)
})
it('allows clearing the shared address', () => {
  expect(decodeResult(sshAddressSchema, '').success).toBe(true)
})

it('formats split SSH fields without losing IPv6 hosts or nonstandard ports', () => {
  expect(formatSshAddress({ sshHost: ' 2001:db8::1 ', sshUser: ' dev ', sshPort: '2222' })).toBe(
    'ssh://dev@[2001:db8::1]:2222',
  )
  expect(
    parseSshAddress(formatSshAddress({ sshHost: '[2001:db8::1]', sshUser: 'dev', sshPort: '22' })),
  ).toEqual({ sshHost: '2001:db8::1', sshUser: 'dev', sshPort: 22 })
  expect(formatSshAddress({ sshHost: '', sshUser: '', sshPort: '22' })).toBe('')
})
it.each([
  { sshHost: 'host', sshUser: '', sshPort: '22' },
  { sshHost: '', sshUser: 'dev', sshPort: '22' },
  { sshHost: 'host', sshUser: 'dev:password', sshPort: '22' },
  { sshHost: 'host', sshUser: 'dev', sshPort: '2e2' },
  { sshHost: 'host', sshUser: 'dev', sshPort: '65536' },
  { sshHost: 'host/path', sshUser: 'dev', sshPort: '22' },
])('rejects invalid split SSH fields %o', (fields) => {
  expect(() => formatSshAddress(fields)).toThrow(Error)
})
