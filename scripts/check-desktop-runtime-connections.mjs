import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'
const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const require = createRequire(root + '/apps/desktop/package.json')
const baselineIndex = process.argv.indexOf('--baseline-ref')
const baselineRef = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : undefined
if (baselineIndex >= 0 && !baselineRef) throw Error('--baseline-ref requires a Git reference')
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
          messages: [
            { id: id + '-reply', role: 'assistant', text: (id + ' history\n').repeat(20000) },
          ],
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
  await build({
    entryPoints: [join(root, 'apps/desktop/electron/preload.ts')],
    outfile: join(directory, 'preload.cjs'),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  })
  await build({
    stdin: {
      loader: 'ts',
      resolveDir: root,
      contents: `export {applySnapshotDelta} from './packages/protocol/src/runtime/connection/sync.ts';`,
    },
    outfile: join(directory, 'renderer.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    globalName: 'syncFixture',
  })
  await writeFile(
    html,
    '<html><body>Shared connection fixture<script src="./renderer.js"></script></body></html>',
  )
  await build({
    stdin: {
      loader: 'ts',
      resolveDir: root + '/apps/desktop',
      contents: `
import {app,BrowserWindow,ipcMain} from 'electron';import {registerRuntimeSync} from './electron/runtime-sync';
ipcMain.on('app:info',event=>{event.returnValue={version:'test',channel:'dev'}});
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
app.whenReady().then(()=>{const owner=registerRuntimeSync(${JSON.stringify(html)});app.once('will-quit',()=>owner.dispose());for(const name of ['Main','Popout']){const window=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true,preload:${JSON.stringify(join(directory, 'preload.cjs'))}}});window.loadFile(${JSON.stringify(html)});}});`,
    },
    outfile: entry,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    alias: { '@dovo/protocol': root + '/packages/protocol/src/index.ts' },
    plugins: baselineRef
      ? [
          {
            name: 'baseline-runtime-connections',
            setup(builder) {
              builder.onLoad({ filter: /\/electron\/runtime-connections\.ts$/ }, () => ({
                contents: execFileSync(
                  'git',
                  ['show', `${baselineRef}:apps/desktop/electron/runtime-connections.ts`],
                  { cwd: root, encoding: 'utf8' },
                ),
                loader: 'ts',
              }))
            },
          },
        ]
      : [],
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
      window.stop = window.dovo.runtimeSync.subscribe(input, (event) => {
        window.updates.push(event)
        if (event.type === 'snapshot') {
          window.snapshot = event.snapshot
          window.sequence = event.sequence
          window.epoch = event.epoch
        } else if (event.type === 'delta') {
          if (
            event.epoch !== window.epoch ||
            event.base !== window.sequence ||
            event.sequence !== event.base + 1
          )
            throw Error('Invalid IPC cursor')
          window.snapshot = window.syncFixture.applySnapshotDelta(window.snapshot, event.delta)
          window.sequence = event.sequence
        }
      })
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
  const firstRevision = await popout.evaluate(() => window.snapshot.revision)
  await popout.waitForFunction((revision) => window.snapshot.revision > revision + 1, firstRevision)
  assert.ok(reads - before <= 3, 'Both windows must share the fallback poller')
  await main.evaluate(
    (input) => window.dovo.runtimeSync.update({ ...input, tasks: ['author', 'reviewer'] }),
    input('author'),
  )
  await main.waitForFunction(() => window.snapshot.detailTaskIds.length === 2)
  const handoff = await main.evaluate((input) => {
    const baselineBytes = new TextEncoder().encode(JSON.stringify(window.snapshot)).length
    window.updates.length = 0
    window.dovo.runtimeSync.update({ ...input, tasks: ['reviewer'] })
    return { baselineBytes }
  }, input('author'))
  await main.waitForFunction(
    () =>
      window.snapshot.detailTaskIds.length === 1 && window.snapshot.detailTaskIds[0] === 'reviewer',
  )
  Object.assign(
    handoff,
    await main.evaluate(() => {
      const frames = window.updates.filter(
        (event) => event.type === 'snapshot' || event.type === 'delta',
      )
      return {
        types: frames.map((frame) => frame.type),
        bytes: new TextEncoder().encode(JSON.stringify(frames)).length,
      }
    }),
  )
  if (!baselineRef) {
    assert(handoff.types.every((type) => type === 'delta'))
    assert(handoff.bytes < handoff.baselineBytes / 100)
  }
  const focus = await main.evaluate((input) => {
    window.updates.length = 0
    window.dovo.runtimeSync.refresh(input.id, false, {
      epoch: window.epoch,
      sequence: window.sequence,
    })
    return { baselineBytes: new TextEncoder().encode(JSON.stringify(window.snapshot)).length }
  }, input('author'))
  await main.waitForFunction(() =>
    window.updates.some((event) => event.type === 'delta' || event.type === 'snapshot'),
  )
  Object.assign(
    focus,
    await main.evaluate(() => {
      const frames = window.updates.filter(
        (event) => event.type === 'delta' || event.type === 'snapshot',
      )
      return {
        types: frames.map((frame) => frame.type),
        bytes: new TextEncoder().encode(JSON.stringify(frames)).length,
      }
    }),
  )
  if (!baselineRef) assert(focus.types.every((type) => type === 'delta'))
  assert.equal(
    await popout.evaluate(() =>
      window.snapshot.workspace.tasks
        .find((task) => task.id === 'reviewer')
        .messages[0].text.startsWith('reviewer history'),
    ),
    true,
  )
  await main.close()
  const last = await popout.evaluate(() => window.snapshot.revision)
  await popout.waitForFunction((last) => window.snapshot.revision > last, last)
  assert.equal(tickets, 1)
  console.log(
    JSON.stringify({
      scope: 'Native Electron preload/IPC; shared HTTP fallback; surviving popout',
      baselineRef,
      handoff,
      focus,
    }),
  )
} finally {
  await app?.close()
  await new Promise((resolve) => server.close(resolve))
  await rm(directory, { recursive: true, force: true })
}
