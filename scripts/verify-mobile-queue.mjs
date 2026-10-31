import assert from 'node:assert/strict'
import { startRuntime } from '../packages/runtime/dist/index.js'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir, networkInterfaces } from 'node:os'
import { randomBytes } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

import { setTimeout as delay } from 'node:timers/promises'

const execute = promisify(execFile)

const device = process.argv[2]
if (!device) throw new Error('Pass an isolated iOS simulator UUID with the native app installed')
const fixtureHost = Object.values(networkInterfaces())
  .flat()
  .find((entry) => entry?.family === 'IPv4' && !entry.internal)?.address
if (!fixtureHost) throw new Error('Native verification requires a LAN or VPN IPv4 address')
const directory = await mkdtemp(join(tmpdir(), 'dovo-mobile-queue-'))
const runtime = await startRuntime({
  databasePath: ':memory:',
  ownerToken: randomBytes(32).toString('base64url'),
  host: fixtureHost,
  port: 0,
})
const taskTestId =
  `Task ${JSON.stringify([`http://${fixtureHost}:${runtime.port}`, 'mobile-task'])}`.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&',
  )
const ids = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth']
runtime.services.store.update((workspace) => ({
  ...workspace,
  repositories: [{ id: 'queue-project', name: 'Queue fixture', path: directory, branch: 'main' }],
  tasks: [
    {
      id: 'mobile-task',
      title: 'Native queue reorder',
      repositoryId: 'queue-project',
      agentId: workspace.agents[0]?.id ?? '',
      status: 'review',
      createdAt: new Date().toISOString(),
      messages: [{ id: 'response', role: 'assistant', text: 'Reorder the paused queue.' }],
      queuePaused: true,
      queue: ids.map((id) => ({
        id,
        role: 'user',
        text: `${id} queued prompt`,
        createdAt: new Date().toISOString(),
      })),
      files: [],
      draft: '',
      example: false,
    },
  ],
}))
const approve = setInterval(() => {
  for (const request of runtime.services.pairing.pending())
    runtime.services.pairing.approve(request.id, true)
}, 100)
async function flow(name, text) {
  const path = join(directory, `${name}.yaml`)
  await writeFile(path, text)
  const child = spawn('maestro', ['--device', device, 'test', path], { stdio: 'inherit' })
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (code !== 0) throw new Error(`Native queue flow failed: ${name}`)
}
async function nodes() {
  const tree = JSON.parse(
    (
      await execute('maestro', ['--device', device, 'hierarchy', '--no-ansi'], {
        encoding: 'utf8',
        maxBuffer: 8 * 1024 * 1024,
        timeout: 60000,
      })
    ).stdout,
  )
  const result = []
  const visit = (node) => {
    if (node.attributes) result.push(node.attributes)
    for (const child of node.children ?? []) visit(child)
  }
  visit(tree)
  return result
}
function bounds(attributes, label) {
  const node = attributes.find((node) => node['resource-id'] === label || node.text === label)
  const match = node?.bounds?.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)
  if (!match) throw new Error(`Missing native bounds: ${label}`)
  const [, left, top, right, bottom] = match.map(Number)
  return { x: (left + right) / 2, y: (top + bottom) / 2, top, bottom }
}
async function expectOrder(expected) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      JSON.stringify(
        runtime.services.store.task('mobile-task').queue.map((message) => message.id),
      ) === JSON.stringify(expected)
    )
      break
    await delay(100)
  }
  const task = runtime.services.store.task('mobile-task')
  assert.deepEqual(
    task.queue.map((message) => message.id),
    expected,
    'Native dragging must persist the queue order',
  )
  assert.equal(task.queuePaused, true, 'Reordering must not start the queue')
}
try {
  const code = runtime.services.pairing.createCode(true)
  const link = new URL('dovo://settings/devices')
  link.searchParams.set('address', `http://${fixtureHost}:${runtime.port}`)
  link.searchParams.set('code', code.code)
  link.searchParams.set('expiresAt', code.expiresAt)
  await execute('xcrun', ['simctl', 'openurl', device, link.href])
  await flow(
    'pair',
    `appId: com.dovo.studio
---
- runFlow:
    when:
      visible: 'Use this code.*'
    commands:
      - scrollUntilVisible:
          element:
            text: Add a new computer
          direction: DOWN
          centerElement: true
      - tapOn: Add a new computer
- tapOn:
    id: Connect
- extendedWaitUntil:
    notVisible:
      id: Connect
    timeout: 20000
`,
  )
  await execute('xcrun', ['simctl', 'openurl', device, 'dovo://'])
  await flow(
    'open-queue',
    `appId: com.dovo.studio
---
- extendedWaitUntil:
    visible:
      id: '${taskTestId}'
    timeout: 20000
- tapOn:
    id: '${taskTestId}'
- extendedWaitUntil:
    visible: '.*third queued prompt.*'
    timeout: 15000
`,
  )
  const attributes = await nodes()
  const source = bounds(attributes, 'Drag queued message 3')
  const target = bounds(attributes, 'Drag queued message 1')
  await flow(
    'drag-third-first',
    `appId: com.dovo.studio
---
- swipe:
    start: ${source.x}, ${source.y}
    end: ${target.x}, ${target.top + 2}
    duration: 1000
- waitForAnimationToEnd
- takeScreenshot: native-queue-reordered
`,
  )
  await expectOrder(['third', 'first', 'second', ...ids.slice(3)])
  const reordered = await nodes()
  const first = bounds(reordered, 'Drag queued message 1')
  const last = bounds(reordered, 'Drag queued message 3')
  await flow(
    'drag-first-last',
    `appId: com.dovo.studio
---
- swipe:
    start: ${first.x}, ${first.y}
    end: ${last.x}, ${last.bottom - 2}
    duration: 1000
- waitForAnimationToEnd
`,
  )
  await expectOrder(ids)
  console.log(
    'Native iOS drag handle persists upward and downward queue moves without starting it.',
  )
} finally {
  clearInterval(approve)
  await runtime.close()
  await rm(directory, { recursive: true, force: true })
}
