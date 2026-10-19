import { expect, it } from 'vite-plus/test'
import { accountServerAddress, accountServerAddresses } from './account.js'
it('publishes advertised LAN/VPN addresses instead of desktop loopback', () => {
  expect(
    accountServerAddresses(
      { address: 'http://127.0.0.1:51464', alternateAddresses: ['http://vpn:51464'] },
      { runtimeAddresses: ['http://192.168.1.20:51464', 'http://vpn:51464'] },
    ),
  ).toEqual(['http://192.168.1.20:51464', 'http://vpn:51464'])
  expect(accountServerAddress('http://100.64.0.1:51464/')).toBe('http://100.64.0.1:51464')
  for (const address of [
    'http://localhost:5000',
    'http://127.0.0.2',
    'http://[::1]',
    'http://0.0.0.0',
    'http://[::]',
    'http://127.1',
    'http://[::ffff:127.0.0.1]',
    'http://secret@vpn:5000',
    'file:///tmp',
  ])
    expect(() => accountServerAddress(address)).toThrow('Choose a LAN or VPN address')
})
