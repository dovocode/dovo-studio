import { createRelay } from './server.js'
import { createDelivery } from './delivery.js'
const port = Number(process.env.PORT || 8080)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set a valid PORT')
const delivery = createDelivery()
const server = createRelay({ token: process.env.DOVO_RELAY_TOKEN ?? '', ...delivery })
server.listen(port, '0.0.0.0', () => console.log(`Dovo notification relay listening on ${port}`))
for (const signal of ['SIGTERM', 'SIGINT'] as const)
  process.once(signal, () => {
    server.close()
    server.closeIdleConnections()
  })
