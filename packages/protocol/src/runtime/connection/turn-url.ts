/** RFC 7065 URLs, including IPv6. Explicitly configured private TURN hosts are supported. */
export function normalizeTurnUrl(value: string): string {
  const match = /^(turns?):([^/?#\s]+)(?:\?transport=(udp|tcp))?$/.exec(value.trim())
  if (!match) throw new Error('Use a TURN URL such as turns:relay.example.com:5349?transport=tcp')
  const address = new URL('http://' + match[2])
  if (
    address.username ||
    address.password ||
    address.pathname !== '/' ||
    address.search ||
    address.hash ||
    !address.hostname
  )
    throw new Error('TURN URLs cannot contain credentials or paths')
  if (
    !address.hostname.startsWith('[') &&
    !address.hostname
      .split('.')
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    throw new Error('Invalid TURN hostname')
  const transport = match[3] ?? (match[1] === 'turns' ? 'tcp' : 'udp')
  if (match[1] === 'turns' && transport !== 'tcp') throw new Error('TURN TLS requires TCP')
  // URL removes an explicit :80; preserve the TURN port rather than HTTP's default.
  const port = /:(\d+)$/.exec(match[2]!)?.[1] ?? (match[1] === 'turns' ? '5349' : '3478')
  if (+port < 1 || +port > 65535 || value.length > 256) throw new Error('Invalid TURN port')
  return `${match[1]}:${address.hostname}:${Number(port)}?transport=${transport}`
}
