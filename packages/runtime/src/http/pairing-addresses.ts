import { networkInterfaces } from 'node:os'
import type { AddressInfo } from 'node:net'
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
            (wildcard || entry.address === listener.address),
        )
        .map((entry) => ({ name, address: `http://${entry.address}:${listener.port}` })),
    )
    .filter((entry, i, all) => all.findIndex((other) => other.address === entry.address) === i)
}
