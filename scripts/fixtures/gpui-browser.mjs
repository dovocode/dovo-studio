// Private browser fixture: real HTTP/runtime/Chromium, no personal providers or services.
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../../packages/runtime/dist/index.js'
const root = process.env.DOVO_DATA_ROOT
if (!root) throw new Error('DOVO_DATA_ROOT is required')
const requests = []
const browserCalls = []
let writes = Promise.resolve()
function record() {
  writes = writes.then(async () => {
    await writeFile(
      join(root, 'browser-events.pending'),
      JSON.stringify({ requests, browserCalls }),
    )
    await rename(join(root, 'browser-events.pending'), join(root, 'browser-events.json'))
  })
  return writes
}
const website = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  const cookie = /(?:^|; )fixture=([^;]*)/.exec(request.headers.cookie || '')?.[1] || 'empty'
  requests.push({ path: url.pathname, cookie })
  void record()
  if (url.searchParams.has('set'))
    response.setHeader(
      'Set-Cookie',
      `fixture=${url.searchParams.get('set')}; Path=/; Max-Age=3600; SameSite=Lax`,
    )
  response.setHeader('Content-Type', 'text/html')
  response.end(
    `<title>Profile ${cookie}</title><style>body{font:24px sans-serif;padding:30px;background:#fff;color:#222}button{padding:12px}</style><h1>Private browser profile: ${cookie}</h1><button onclick="this.textContent='Native click received'">Test click</button>`,
  )
})
await new Promise((resolve) => website.listen(0, '127.0.0.1', resolve))
const token = randomBytes(32).toString('hex')
const runtime = await startRuntime({
  databasePath: join(root, 'runtime.sqlite'),
  ownerToken: token,
  host: '127.0.0.1',
  port: 0,
})
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, async () => {
    await runtime.close()
    website.close()
    await writes
    process.exit(0)
  })
const s = runtime.services
s.preferences.save({
  browserProfiles: [
    { id: 'default', name: 'Default' },
    { id: 'work', name: 'Private Work' },
  ],
})
s.store.update((workspace) => ({
  ...workspace,
  repositories: [],
  agents: [],
  tasks: [
    {
      id: 'browser-task',
      title: 'Private browser task',
      repositoryId: '',
      agentId: '',
      status: 'draft',
      createdAt: new Date().toISOString(),
      draft: '',
      messages: [],
      files: [],
      example: false,
    },
  ],
  automations: [],
}))
for (const method of ['open', 'close']) {
  const original = s.browsers[method].bind(s.browsers)
  s.browsers[method] = async (...args) => {
    browserCalls.push({ method, args })
    await record()
    return original(...args)
  }
}
await writeFile(
  join(root, 'fixture.json'),
  JSON.stringify({ taskId: 'browser-task', url: `http://127.0.0.1:${website.address().port}` }),
)
await writeFile(
  join(root, 'runtime-connection.pending'),
  JSON.stringify({ address: 'http://127.0.0.1:' + runtime.port, token }),
  { mode: 0o600 },
)
await rename(join(root, 'runtime-connection.pending'), join(root, 'runtime-connection.json'))
