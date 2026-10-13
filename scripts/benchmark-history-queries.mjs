// Build @dovo/runtime and dependencies first. Synthetic query costs, not application latency.
import { performance } from 'node:perf_hooks'
import assert from 'node:assert/strict'
import { conversationPage, searchTaskMessages } from '../packages/protocol/dist/index.js'
import { Conversations } from '../packages/runtime/dist/storage/conversations.js'
import { openDatabase } from '../packages/runtime/dist/storage/database.js'

function makeTask(id, count) {
  const messages = Array.from({ length: count }, (_, index) => ({
    id: `${id}-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    text: `common message ${index} ${'content '.repeat(125)}`,
  }))
  return {
    id,
    title: id,
    repositoryId: '',
    agentId: '',
    status: 'review',
    draft: '',
    files: [],
    example: false,
    createdAt: '2026-10-01T00:00:00Z',
    messages,
    turns: messages
      .filter((message) => message.role === 'assistant')
      .map((message) => ({
        id: `turn-${message.id}`,
        assistantId: message.id,
        agentId: '',
        provider: 'codex',
        model: '',
        status: 'completed',
        startedAt: '2026-10-01T00:00:00Z',
      })),
  }
}
function median(read) {
  for (let index = 0; index < 5; index++) read()
  const samples = []
  for (let index = 0; index < 21; index++) {
    const start = performance.now()
    read()
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return Number(samples[10].toFixed(3))
}
const tasks = Array.from({ length: 60 }, (_, index) => makeTask(`task-${index}`, 500))
const long = makeTask('long', 20000)
tasks.push(long)
tasks[0].messages.at(-1).text += ' rare-target-zebra'
const ids = tasks.map((task) => task.id)
const db = openDatabase(':memory:')
try {
  const history = new Conversations(db)
  const seedStart = performance.now()
  db.transaction(() => history.record(tasks, new Map(), true))()
  const seedMs = Math.round(performance.now() - seedStart)
  const search = []
  for (const query of ['rare-target-zebra', 'absent-target-zebra', 'common', 'co']) {
    const expected = searchTaskMessages(tasks, query)
    assert.deepEqual(history.search(ids, query), expected)
    search.push({
      query,
      matchingTasks: expected.taskIds.length,
      inMemoryMedianMs: median(() => searchTaskMessages(tasks, query)),
      databaseMedianMs: median(() => history.search(ids, query)),
    })
  }
  const pages = []
  for (const before of [undefined, 'long-2000']) {
    assert.deepEqual(history.page(long.id, before, undefined), conversationPage(long, before))
    pages.push({
      before: before ?? 'newest',
      inMemoryMedianMs: median(() => conversationPage(long, before)),
      databaseMedianMs: median(() => history.page(long.id, before, undefined)),
    })
  }
  console.log(
    JSON.stringify(
      {
        scope:
          'Isolated queries over 50,000 messages of approximately 1 KiB each and 25,000 turns; excludes IO/network/rendering',
        seedMs,
        search,
        pages,
      },
      null,
      2,
    ),
  )
} finally {
  db.close()
}
