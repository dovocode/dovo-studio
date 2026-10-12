import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'
const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const require = createRequire(root + '/apps/desktop/package.json')
const directory = await mkdtemp(join(tmpdir(), 'dovo-shared-connections-'))
const html = join(directory, 'fixture.html'),
  entry = join(directory, 'main.cjs')
const token = 'shared-desktop-native-fixture-token-at-least-32-characters'
let tickets = 0,
  reads = 0
const server = createServer((request, response) => {
  if (request.headers.authorization !== 'Bearer ' + token) {
    response.writeHead(401)
    response.end('{}')
    return
  }
  const url = new URL(request.url, 'http://fixture')
  if (url.pathname === '/api/sync/ticket') {
    tickets++
    response.writeHead(404)
    response.end('{}')
    return
  }
  if (url.pathname !== '/api/snapshot') {
    response.writeHead(404)
    response.end('{}')
    return
  }
  reads++
  const tasks = url.searchParams.getAll('task')
  response.setHeader('Content-Type', 'application/json')
  response.end(
    JSON.stringify({
      revision: reads,
      owner: false,
      detailTaskIds: tasks,
      workspace: {
        version: 1,
        runtimeAddress: '',
        agents: [],
        repositories: [],
        automations: [],
        tasks: tasks.map((id) => ({
          id,
          title: id,
          agentId: '',
          repositoryId: '',
          status: 'draft',
          createdAt: '2026-10-12',
          messages: [],
          files: [],
          draft: '',
          example: false,
        })),
      },
      approvals: [],
      questions: [],
      terminals: [],
      runs: [],
      devices: [],
      pendingDevices: [],
    }),
  )
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address !== 'string')
let app
try {
  await writeFile(html, '<html><body>Shared connection fixture</body></html>')
  await build({
    stdin: {
      loader: 'ts',
      resolveDir: root + '/apps/desktop',
      contents: `
import {app,BrowserWindow} from 'electron';import {registerRuntimeSync} from './electron/runtime-sync';
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
app.whenReady().then(()=>{const owner=registerRuntimeSync(${JSON.stringify(html)});app.once('will-quit',()=>owner.dispose());for(const name of ['Main','Popout']){const window=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:${JSON.stringify(root + '/apps/desktop/dist-electron/preload.mjs')}}});window.loadFile(${JSON.stringify(html)});}});`,
    },
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    alias: { '@dovo/protocol': root + '/packages/protocol/src/index.ts' },
  })
  app = await electron.launch({
    executablePath: require('electron'),
    args: ['--no-sandbox', entry],
  })
  await app.firstWindow()
  await app.evaluate(async ({ BrowserWindow }) => {
    while (BrowserWindow.getAllWindows().length < 2)
      await new Promise((resolve) => setTimeout(resolve, 10))
  })
  const [main, popout] = app.windows()
  const input = (id) => ({
    id,
    connection: { address: `http://127.0.0.1:${address.port}`, token },
    tasks: [id],
    scopes: [],
    detailScopes: [],
  })
  for (const [page, id] of [
    [main, 'author'],
    [popout, 'reviewer'],
  ]) {
    await page.waitForFunction(() => window.dovo?.runtimeSync)
    await page.evaluate((input) => {
      window.updates = []
      window.stop = window.dovo.runtimeSync.subscribe(input, (event) => window.updates.push(event))
    }, input(id))
    if (id === 'author')
      await page.waitForFunction(() =>
        window.updates.some((event) => event.type === 'status' && event.status === 'unsupported'),
      )
  }
  await popout.waitForFunction(() =>
    window.updates.some(
      (event) => event.type === 'snapshot' && event.snapshot.detailTaskIds.includes('reviewer'),
    ),
  )
  assert.equal(tickets, 1)
  const before = reads
  await popout.waitForFunction(
    () => window.updates.filter((event) => event.type === 'snapshot').length >= 3,
  )
  assert.ok(reads - before <= 3, 'Both windows must share the fallback poller')
  await main.close()
  const last = await popout.evaluate(
    () => window.updates.filter((event) => event.type === 'snapshot').at(-1).snapshot.revision,
  )
  await popout.waitForFunction(
    (last) =>
      window.updates.some((event) => event.type === 'snapshot' && event.snapshot.revision > last),
    last,
  )
  assert.equal(tickets, 1)
  console.log(
    'Native Electron: real preload/IPC, one shared HTTP fallback, main closure and surviving popout passed',
  )
} finally {
  await app?.close()
  await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
