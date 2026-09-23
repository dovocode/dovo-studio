import { expect, it } from 'vitest'
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
