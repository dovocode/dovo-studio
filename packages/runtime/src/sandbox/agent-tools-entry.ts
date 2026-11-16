// Entry for the agent-tools MCP server inside a sandbox container. On Linux hosts the runtime
// is reachable through a Unix socket in the thread's mounted state directory, which also works
// without container network access. This process exposes that socket on a loopback TCP port, so
// the server keeps its normal HTTP and WebSocket client.
import { connect, createServer } from 'node:net'

const socket = process.env.DOVO_TASK_SOCKET
if (socket) {
  const bridge = createServer((client) => {
    const upstream = connect(socket)
    client.pipe(upstream).pipe(client)
    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
  })
  await new Promise<void>((resolve, reject) => {
    bridge.once('error', reject)
    bridge.listen(0, '127.0.0.1', resolve)
  })
  bridge.unref()
  const address = bridge.address()
  if (!address || typeof address === 'string') throw new Error('Dovo tools bridge has no port')
  process.env.DOVO_TASK_URL = `http://127.0.0.1:${address.port}`
}
await import('../agent-tools/server.js')
