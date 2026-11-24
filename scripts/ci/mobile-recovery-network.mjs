import { connect, createServer } from 'node:net'

/** Cut both HTTP requests and live streams without disturbing the emulator's UI driver. */
export async function startMobileRecoveryNetwork(runtimePort, host = '127.0.0.1') {
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
  function setOnline(value) {
    online = value
    if (!online) for (const client of clients) client.destroy()
  }
  return {
    port: server.address().port,
    setOnline,
    close() {
      setOnline(false)
      return new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}
