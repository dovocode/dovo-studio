import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../packages/runtime/dist/index.js'
import { fixture } from '../packages/runtime/dist/testing/fixture.js'
import { chromium } from './browser/harness.mjs'

// Real browser/client/runtime boundary. No transport or reconciliation mocks.
const root = fileURLToPath(new URL('../', import.meta.url))
const built = await build({
  stdin: {
    resolveDir: root,
    loader: 'ts',
    contents: `
import { startRuntimeSync, watchRuntimeTask, prepareRuntimeTask } from './packages/protocol/src/runtime/connection/live-sync.ts';
window.frames=[];window.sockets=[];
const NativeSocket=window.WebSocket;
window.WebSocket=class extends NativeSocket {
  constructor(url){super(url);window.sockets.push(this);this.addEventListener('message',event=>window.frames.push(JSON.parse(event.data)));}
  send(wire){if(JSON.parse(wire).type==='watch')window.navigationWorkMs=performance.now()-window.selectionStarted;return super.send(wire);}
};
window.begin=connection=>{
  let release=watchRuntimeTask(connection,'a');
  window.select=id=>{window.selectionStarted=performance.now();release();release=watchRuntimeTask(connection,id);};
  window.prepare=id=>{window.selectionStarted=performance.now();return prepareRuntimeTask(connection,id);};
  window.mount=id=>{const next=watchRuntimeTask(connection,id);release();release=next;};
  const live=startRuntimeSync(connection,{onSnapshot:snapshot=>{window.snapshot=snapshot;window.publishedAt=performance.now();window.reopenMs=window.publishedAt-window.selectionStarted;window.reportCommit?.(snapshot.workspace.tasks.find(task=>task.id==='a')?.title);},onStatus:status=>window.status=status});
  window.stop=()=>{release();live.stop();};
};
`,
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
})
const token = 'remote-thread-sync-browser-paired-owner-token'
const project = await fixture()
const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><title>Remote thread sync fixture</title>')
})
let browser
try {
  runtime.services.store.update((workspace) => ({
    ...workspace,
    repositories: project.workspace.repositories,
    tasks: ['a', 'b'].map((id) => ({
      id,
      title: `Thread ${id}`,
      agentId: '',
      repositoryId: 'repo',
      status: 'draft',
      createdAt: '2026-11-11',
      draft: '',
      example: false,
      files: ['a.ts', 'b.ts'].map((path) => ({
        path,
        before: '',
        after: 'source\n'.repeat(10000),
        viewed: false,
      })),
      messages: [{ id: `reply-${id}`, role: 'assistant', text: `Remote ${id}\n`.repeat(10000) }],
      turns: [
        {
          id: `turn-${id}`,
          assistantId: `reply-${id}`,
          agentId: '',
          provider: 'codex',
          model: 'fixture',
          startedAt: '2026-11-11',
          status: 'completed',
          checkpoint: {
            before: 'commit',
            files: [
              { path: 'source.ts', before: '', after: 'source\n'.repeat(10000), viewed: false },
            ],
            omitted: [],
          },
        },
      ],
    })),
  }))
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  browser = await chromium.launch()
  const page = await browser.newPage()
  const errors = []
  const requests = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/')) requests.push(path)
  })
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.addScriptTag({ content: built.outputFiles[0].text })
  await page.evaluate((connection) => window.begin(connection), {
    address: `http://127.0.0.1:${runtime.port}`,
    token,
  })
  await page.waitForFunction(() => window.snapshot?.detailTaskIds?.[0] === 'a')
  await page.evaluate(() => {
    window.firstA = window.snapshot
  })
  await page.evaluate(() => window.select('b'))
  await page.waitForFunction(() => window.snapshot?.detailTaskIds?.[0] === 'b')
  runtime.services.store.updateTaskHistory('a', (task) => ({
    ...task,
    messages: task.messages.map((message) => ({
      ...message,
      text: message.text + 'Changed while away',
    })),
    turns: task.turns.map((turn) => ({ ...turn, tokens: 123 })),
  }))
  const start = await page.evaluate(() => window.frames.length)
  await page.evaluate(() => window.select('a'))
  await page.waitForFunction(
    () =>
      window.snapshot?.detailTaskIds?.[0] === 'a' &&
      window.snapshot.workspace.tasks
        .find((task) => task.id === 'a')
        ?.messages[0]?.text.endsWith('Changed while away'),
  )
  const result = await page.evaluate((start) => {
    const frames = window.frames.slice(start)
    const task = window.snapshot.workspace.tasks.find((task) => task.id === 'a')
    const before = window.firstA.workspace.tasks.find((task) => task.id === 'a')
    return {
      types: frames.map((frame) => frame.type),
      baselineBytes: new TextEncoder().encode(JSON.stringify(window.firstA)).length,
      resumeBytes: new TextEncoder().encode(JSON.stringify(frames)).length,
      tokens: task.turns[0].tokens,
      retainedCheckpoint: task.turns[0].checkpoint === before.turns[0].checkpoint,
      socketCount: window.sockets.length,
      navigationWorkMs: window.navigationWorkMs,
      warmReopenMs: window.reopenMs,
    }
  }, start)
  assert(result.types.includes('selection-resume'))
  assert(result.types.includes('delta'))
  assert(!result.types.includes('snapshot') && !result.types.includes('selection'))
  assert(result.resumeBytes < result.baselineBytes / 50)
  assert.equal(result.tokens, 123)
  assert.equal(result.retainedCheckpoint, true)
  assert.equal(result.socketCount, 1)
  assert.deepEqual(requests, ['/api/sync/ticket'])
  const reviewStart = await page.evaluate(() => {
    window.beforeReview = window.snapshot.workspace.tasks.find((task) => task.id === 'a')
    return window.frames.length
  })
  runtime.services.store.updateTaskHistory('a', (task) => ({
    ...task,
    files: task.files.map((file, index) => (index === 0 ? { ...file, viewed: true } : file)),
  }))
  await page.waitForFunction(
    () => window.snapshot.workspace.tasks.find((task) => task.id === 'a')?.files[0]?.viewed,
  )
  const review = await page.evaluate((start) => {
    const frames = window.frames.slice(start)
    const task = window.snapshot.workspace.tasks.find((task) => task.id === 'a')
    return {
      bytes: new TextEncoder().encode(JSON.stringify(frames)).length,
      changes: frames
        .filter((frame) => frame.type === 'delta')
        .flatMap((frame) => frame.delta.workspace.tasks?.changes ?? []),
      retainedFile: task.files[1] === window.beforeReview.files[1],
      retainedBody: task.files[0].after === window.beforeReview.files[0].after,
    }
  }, reviewStart)
  assert.equal(review.retainedFile, true)
  assert.equal(review.retainedBody, true)
  assert(review.bytes < 1000)
  assert.deepEqual(review.changes[0].files.changes, [
    { path: 'a.ts', fieldDelta: { values: { viewed: true }, removed: [] } },
  ])
  const reconnectStart = await page.evaluate(() => {
    window.sockets.at(-1).close()
    return window.frames.length
  })
  await page.waitForFunction(() => window.sockets.length === 2 && window.status === 'live')
  assert.equal(
    await page.evaluate(
      (start) => window.frames.slice(start).some((frame) => frame.type === 'snapshot'),
      reconnectStart,
    ),
    false,
  )
  await page.evaluate(async () => {
    for (let index = 0; index < 40; index++) {
      window.select(index % 2 ? 'a' : 'b')
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })
  await page.waitForFunction(
    () =>
      window.snapshot?.detailTaskIds?.[0] === 'a' && window.publishedAt >= window.selectionStarted,
  )
  assert.equal(await page.evaluate(() => window.sockets.length), 2)
  assert.equal(
    await page.evaluate(
      () => window.snapshot.workspace.tasks.find((task) => task.id === 'a').turns[0].tokens,
    ),
    123,
  )
  const preparedSelections = []
  for (const id of ['b', 'a']) {
    const frameStart = await page.evaluate(() => window.frames.length)
    assert.equal(await page.evaluate((id) => window.prepare(id), id), true)
    await page.waitForFunction(() => window.snapshot.detailTaskIds.length === 2)
    await page.evaluate((id) => window.mount(id), id)
    await page.waitForFunction(
      (id) => window.snapshot.detailTaskIds.length === 1 && window.snapshot.detailTaskIds[0] === id,
      id,
    )
    preparedSelections.push(
      await page.evaluate(
        ({ id, frameStart }) => ({
          id,
          bytes: new TextEncoder().encode(JSON.stringify(window.frames.slice(frameStart))).length,
          types: window.frames.slice(frameStart).map((frame) => frame.type),
        }),
        { id, frameStart },
      ),
    )
  }
  assert.equal(await page.evaluate(() => window.sockets.length), 2)
  const commitSamples = []
  let pendingCommit
  await page.exposeFunction('reportCommit', (title) => {
    if (pendingCommit?.title === title)
      pendingCommit.resolve(performance.now() - pendingCommit.started)
  })
  for (let index = 0; index < 12; index++) {
    const sample = Promise.withResolvers()
    const title = `Measured commit ${index}`
    const deadline = setTimeout(
      () => sample.reject(new Error('Commit did not reach browser')),
      10000,
    )
    pendingCommit = { title, resolve: sample.resolve, started: performance.now() }
    try {
      runtime.services.store.updateTask('a', (task) => ({ ...task, title }))
      commitSamples.push(await sample.promise)
    } finally {
      clearTimeout(deadline)
      pendingCommit = undefined
    }
  }
  commitSamples.sort((a, b) => a - b)
  await writeFile(
    join(project.directory, 'hello.txt'),
    'Background refresh reached the live thread\n',
  )
  const changesRefresh = await page.evaluate(
    async ({ address, token }) => {
      const response = await fetch(`${address}/api/scm/changes`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ repositoryId: 'repo', taskId: 'a', includeFiles: false }),
      })
      return { status: response.status, body: await response.text() }
    },
    { address: `http://127.0.0.1:${runtime.port}`, token },
  )
  assert.deepEqual(changesRefresh, { status: 200, body: '{"ok":true}' })
  await page.waitForFunction(() =>
    window.snapshot.workspace.tasks
      .find((task) => task.id === 'a')
      ?.files.some(
        (file) =>
          file.path === 'hello.txt' &&
          file.after === 'Background refresh reached the live thread\n',
      ),
  )
  assert.deepEqual(errors, [])
  await page.evaluate(() => window.stop())
  console.log(
    JSON.stringify({
      scope: 'Managed Chromium to real HTTP/WS runtime; decoded application bytes',
      ...result,
      review,
      changesRefresh,
      rapidSwitches: 40,
      preparedSelections,
      commitToBrowserMedianMs: Number(commitSamples[6].toFixed(2)),
      commitToBrowserMaxMs: Number(commitSamples[11].toFixed(2)),
    }),
  )
} finally {
  await browser?.close()
  await new Promise((resolve, reject) =>
    server.close((error) =>
      error && error.code !== 'ERR_SERVER_NOT_RUNNING' ? reject(error) : resolve(),
    ),
  )
  await runtime.close()
  await project.cleanup()
}
