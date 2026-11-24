import { connect, createServer } from 'node:net'

/** Cut HTTP and live streams while the fixture client uses its saved proxy address. */
export async function startMobileRecoveryNetwork(runtimePort, host, services) {
  let online = true
  const clients = new Set()
  const server = createServer((client) => {
    if (!online) {
      client.destroy()
      return
    }
    const upstream = connect(runtimePort, host)
    clients.add(client)
    client.on('error', () => client.destroy())
    upstream.on('error', () => upstream.destroy())
    client.on('close', () => {
      clients.delete(client)
      upstream.destroy()
    })
    upstream.on('close', () => client.destroy())
    client.pipe(upstream).pipe(client)
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, host, resolve)
  })
  // The paired client learns alternate routes from snapshots and verifies them via /health.
  // Advertising the upstream port lets it bypass the outage the fixture just introduced.
  const runtimeAddresses = services.runtimeAddresses
  services.runtimeAddresses = () => []
  function setOnline(value) {
    online = value
    if (!online) for (const client of clients) client.destroy()
  }
  return {
    port: server.address().port,
    setOnline,
    async close() {
      setOnline(false)
      try {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        )
      } finally {
        services.runtimeAddresses = runtimeAddresses
      }
    },
  }
}
