import { createDemoServer } from './server.js'
const server = createDemoServer({
  origin: process.env.DOVO_DEMO_ORIGIN ?? '',
  password: process.env.DOVO_DEMO_PASSWORD ?? '',
})
server.requestTimeout = 15_000
server.headersTimeout = 10_000
server.listen(Number(process.env.PORT ?? 8080), '0.0.0.0')
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.close())
