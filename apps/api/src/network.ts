import { execFile } from 'node:child_process'
import { networkInterfaces } from 'node:os'
import { isIP } from 'node:net'
import { promisify } from 'node:util'
const execute = promisify(execFile)
export type NetworkAddress = {
  network: 'local' | 'tailscale' | 'netbird'
  host: string
  name: string
}
export async function discoverNetworks(): Promise<NetworkAddress[]> {
  const interfaces = Object.entries(networkInterfaces())
    .flatMap(([name, entries]) =>
      (entries ?? [])
        .filter((entry) => !entry.internal && entry.family === 'IPv4')
        .map((entry) => ({ name, host: entry.address })),
    )
    .filter((entry, index, all) => all.findIndex((other) => other.host === entry.host) === index)
  const results = await Promise.allSettled([
    execute('tailscale', ['ip', '-4'], { encoding: 'utf8', timeout: 3000 }),
    execute('netbird', ['status', '--json'], { encoding: 'utf8', timeout: 3000 }),
  ])
  const networks: NetworkAddress[] = []
  const tailscale = results[0]
  if (tailscale.status === 'fulfilled') {
    const host = tailscale.value.stdout.trim()
    if (isIP(host) === 4 && interfaces.some((entry) => entry.host === host))
      networks.push({ network: 'tailscale', host, name: 'Tailscale' })
  }
  const netbird = results[1]
  if (netbird.status === 'fulfilled') {
    let value: unknown
    try {
      value = JSON.parse(netbird.value.stdout)
    } catch {
      // An optional VPN client's output must not prevent pairing over other networks.
      console.warn('Could not read NetBird status. Use its IP or hostname with --public-address.')
    }
    if (
      value &&
      typeof value === 'object' &&
      'netbirdIp' in value &&
      typeof value.netbirdIp === 'string'
    ) {
      const host = value.netbirdIp.split('/')[0]
      if (isIP(host) === 4 && interfaces.some((entry) => entry.host === host))
        networks.push({ network: 'netbird', host, name: 'NetBird' })
    }
  }
  return [
    ...networks,
    ...interfaces
      .filter((entry) => !networks.some((network) => network.host === entry.host))
      .map((entry) => ({ ...entry, network: 'local' as const })),
  ]
}
export function resolveBindHost(host: string, networks: NetworkAddress[]) {
  if (!['local', 'tailscale', 'netbird'].includes(host)) return host
  const matches = networks.filter((entry) => entry.network === host)
  if (matches.length !== 1)
    throw new Error(
      matches.length
        ? `Multiple ${host} addresses: ${matches.map((entry) => entry.host).join(', ')}. Set DOVO_HOST to an IP or 0.0.0.0.`
        : `No ${host} address found. Connect the network client and ensure its CLI is on PATH, or set DOVO_HOST to an IP.`,
    )
  return matches[0].host
}
export function networkUrls(bindHost: string, port: string, networks: NetworkAddress[]) {
  return networks
    .filter((entry) => ['0.0.0.0', '::'].includes(bindHost) || entry.host === bindHost)
    .map((entry) => ({ ...entry, address: `http://${entry.host}:${port}` }))
}
