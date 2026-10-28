import { expect, it } from 'vite-plus/test'
import { pairingAddresses } from './pairing-addresses'
import type { NetworkInterfaceInfo } from 'node:os'
const entry = (address: string, internal = false): NetworkInterfaceInfo => ({
  address,
  internal,
  family: 'IPv4',
  netmask: '255.255.255.0',
  mac: '00:00:00:00:00:00',
  cidr: `${address}/24`,
})
const interfaces = {
  lo: [entry('127.0.0.1', true)],
  en0: [entry('192.168.1.5')],
  vpn: [entry('100.90.80.70')],
}
it('advertises only reachable listener interfaces, retaining HTTP for VPN', () => {
  expect(
    pairingAddresses({ address: '127.0.0.1', family: 'IPv4', port: 8787 }, interfaces),
  ).toEqual([])
  expect(
    pairingAddresses({ address: '100.90.80.70', family: 'IPv4', port: 8787 }, interfaces),
  ).toEqual([{ name: 'vpn', address: 'http://100.90.80.70:8787' }])
  expect(
    pairingAddresses({ address: '0.0.0.0', family: 'IPv4', port: 8787 }, interfaces),
  ).toHaveLength(2)
})

it('excludes bridge subnet and broadcast addresses without rejecting valid VPN hosts', () => {
  const interfaces = {
    bridge: [entry('192.168.97.0'), entry('192.168.97.255')],
    vpn: [
      { ...entry('100.101.60.0'), netmask: '255.0.0.0' },
      { ...entry('10.0.0.0'), netmask: '255.255.255.254' },
      { ...entry('10.0.1.0'), netmask: '255.255.255.255' },
    ],
  }
  expect(pairingAddresses({ address: '0.0.0.0', family: 'IPv4', port: 8787 }, interfaces)).toEqual([
    { name: 'vpn', address: 'http://100.101.60.0:8787' },
    { name: 'vpn', address: 'http://10.0.0.0:8787' },
    { name: 'vpn', address: 'http://10.0.1.0:8787' },
  ])
})
