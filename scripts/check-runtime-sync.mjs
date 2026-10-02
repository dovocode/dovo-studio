import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createRequire } from 'node:module'
const { WebSocket } = createRequire(new URL('../packages/runtime/package.json', import.meta.url))(
  'ws',
)
import { startRuntime } from '../packages/runtime/dist/index.js'

const token = 'sync-benchmark-owner-credential-with-32-characters'
const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
const sockets = []
try {
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: Array.from({ length: 100 }, (_, index) => ({
      id: `thread-${index}`,
      title: `Thread ${index}`,
      agentId: '',
      repositoryId: '',
      status: 'draft',
      createdAt: '2026-10-02T10:00:00.000Z',
      draft: '',
      example: false,
      files: [],
      messages: Array.from({ length: 20 }, (_, message) => ({
        id: `message-${message}`,
        role: 'assistant',
        text: `Output ${index}/${message} ` + 'x'.repeat(1024),
      })),
    })),
  }))
  const address = `http://127.0.0.1:${runtime.port}`
  async function open(format, tasks = [], resume = {}) {
    const start = performance.now()
    const query = new URLSearchParams({ format: String(format) })
    for (const task of tasks) query.append('task', task)
    const ticket = await fetch(`${address}/api/sync/ticket?${query}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    }).then((response) => response.json())
    const socket = new WebSocket(`ws://127.0.0.1:${runtime.port}/ws/sync?ticket=${ticket.ticket}`)
    sockets.push(socket)
    const frames = []
    let bytes = 0
    socket.on('message', (data) => {
      bytes += data.length
      frames.push(JSON.parse(data.toString()))
    })
    await once(socket, 'open')
    socket.send(JSON.stringify({ type: 'resume', ...resume }))
    const deadline = Date.now() + 10000
    while (!frames.some((frame) => frame.type === 'heartbeat')) {
      assert(Date.now() < deadline, 'Sync handshake timed out')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return { socket, frames, bytes, ms: performance.now() - start }
  }
  const full = await open(3),
    shell = await open(4),
    detail = await open(4, ['thread-0'])
  assert(shell.bytes < full.bytes * 0.05, 'Shell should omit conversation histories')
  assert(detail.bytes < full.bytes * 0.05, 'One open thread should not download other histories')
  const baseline = detail.frames.find((frame) => frame.type === 'snapshot')
  detail.socket.close()
  await once(detail.socket, 'close')
  runtime.services.store.updateTask('thread-0', (task) => ({
    ...task,
    title: 'Changed while disconnected',
  }))
  const replay = await open(4, ['thread-0'], { epoch: baseline.epoch, sequence: baseline.sequence })
  assert(
    !replay.frames.some((frame) => frame.type === 'snapshot'),
    'Reconnect should replay without a baseline',
  )
  const reset = await open(4, ['thread-0'], {
    epoch: 'restarted-runtime',
    sequence: baseline.sequence,
  })
  assert(
    reset.frames.some((frame) => frame.type === 'snapshot'),
    'Unknown epochs must receive a scoped baseline',
  )
  const search = await fetch(`${address}/api/tasks/search`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'Output 99/19' }),
  }).then((response) => response.json())
  assert.deepEqual(search.taskIds, ['thread-99'], 'Search must find unopened conversations')
  console.log(
    JSON.stringify(
      {
        threads: 100,
        messages: 2000,
        full: { bytes: full.bytes, ms: Math.round(full.ms) },
        shell: { bytes: shell.bytes, ms: Math.round(shell.ms) },
        oneThread: { bytes: detail.bytes, ms: Math.round(detail.ms) },
        replay: { bytes: replay.bytes, ms: Math.round(replay.ms) },
        freshScopedBaseline: { bytes: reset.bytes, ms: Math.round(reset.ms) },
        reductionPercent: Math.round((1 - detail.bytes / full.bytes) * 1000) / 10,
      },
      null,
      2,
    ),
  )
} finally {
  for (const socket of sockets) socket.terminate()
  await runtime.close()
}
