import type { IncomingHttpHeaders } from 'node:http'
import { BlockList, isIP } from 'node:net'

const normalize = (ip: string) => ip.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1')

/** Only an explicitly trusted immediate hop can supply a forwarded client address. */
export function clientAddress(proxies: readonly string[]) {
  const trusted = new BlockList()
  for (const entry of proxies) {
    const [ip = '', prefix, extra] = entry.split('/')
    const version = isIP(ip)
    if (!version || extra !== undefined) throw new Error('Invalid trusted proxy address')
    const family = version === 4 ? 'ipv4' : 'ipv6'
    if (prefix === undefined) trusted.addAddress(ip, family)
    else {
      if (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128))
        throw new Error('Invalid trusted proxy subnet')
      trusted.addSubnet(ip, Number(prefix), family)
    }
  }
  const contains = (ip: string) => trusted.check(ip, isIP(ip) === 4 ? 'ipv4' : 'ipv6')
  return (req: { headers: IncomingHttpHeaders; socket: { remoteAddress?: string } }) => {
    const immediate = normalize(req.socket.remoteAddress ?? '')
    if (!isIP(immediate)) return 'unknown'
    if (!contains(immediate)) return immediate
    const header = req.headers['x-forwarded-for']
    if (typeof header !== 'string' || header.length > 4096) return immediate
    const hops = header.split(',').map((value) => normalize(value.trim()))
    if (hops.length > 20 || hops.some((ip) => !isIP(ip))) return immediate
    let client = immediate
    for (const hop of hops.reverse()) {
      if (!contains(client)) break
      client = hop
    }
    return client
  }
}
