import { networkInterfaces } from 'node:os'
import type { AddressInfo } from 'node:net'

function isHostAddress(address: string, netmask: string) {
  const number = (value: string) =>
    value.split('.').reduce((result, octet) => (result << 8) | Number(octet), 0) >>> 0
  const hostMask = ~number(netmask) >>> 0
  // Point-to-point (/31) and single-host VPN interfaces (/32) have no broadcast address.
  if (hostMask <= 1) return true
  const host = (number(address) & hostMask) >>> 0
  return host !== 0 && host !== hostMask
}
/** Only advertise interfaces on which this listener can accept a phone connection. */
export function pairingAddresses(
  listener: AddressInfo | string | null,
  interfaces = networkInterfaces(),
) {
  if (!listener || typeof listener === 'string') return []
  const wildcard = listener.address === '0.0.0.0' || listener.address === '::'
  return Object.entries(interfaces)
    .flatMap(([name, entries]) =>
      (entries ?? [])
        .filter(
          (entry) =>
            !entry.internal &&
            entry.family === 'IPv4' &&
            isHostAddress(entry.address, entry.netmask) &&
            (wildcard || entry.address === listener.address),
        )
        .map((entry) => ({ name, address: `http://${entry.address}:${listener.port}` })),
    )
    .filter((entry, i, all) => all.findIndex((other) => other.address === entry.address) === i)
}
