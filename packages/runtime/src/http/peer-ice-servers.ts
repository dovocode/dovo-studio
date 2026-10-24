import type { PeerRelay } from '@dovo/protocol'

/** Try UDP, TCP and TLS together without allocating a relay for every supplied URL.
 * Keep credentials attached to their server; a fourth endpoint permits host redundancy. */
export function peerRelayServers(servers: PeerRelay['iceServers'] = []) {
  const candidates = servers.flatMap((server) =>
    server.urls.map((url) => ({
      urls: url,
      username: server.username,
      credential: server.credential,
    })),
  )
  const transport = (url: string) =>
    url.startsWith('turns:') ? 'tls' : url.endsWith('transport=tcp') ? 'tcp' : 'udp'
  const preferred = ['udp', 'tcp', 'tls'].flatMap((mode) => {
    const candidate = candidates.find((server) => transport(server.urls) === mode)
    return candidate ? [candidate] : []
  })
  const seen = new Set<string>()
  return [...preferred, ...candidates].filter((server) => {
    const id = JSON.stringify([server.urls, server.username, server.credential])
    if (seen.has(id) || seen.size >= 4) return false
    seen.add(id)
    return true
  })
}
