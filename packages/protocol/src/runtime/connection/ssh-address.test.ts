import { expect, it } from 'vite-plus/test'
import { decodeResult } from '../../shared/schema.js'
import { parseSshAddress, sshAddressSchema } from './ssh-address.js'

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
