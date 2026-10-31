// Build @dovo/runtime and dependencies first. Isolated page cost, not app latency or energy.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { openDatabase } from '../packages/runtime/dist/storage/database.js'
import { WorkspaceStore } from '../packages/runtime/dist/storage/workspace.js'
import { Conversations } from '../packages/runtime/dist/storage/conversations.js'

const db = openDatabase(':memory:')
try {
  const store = new WorkspaceStore(db)
  const sql = new Conversations(db)
  store.update((workspace) => ({
    ...workspace,
    tasks: [
      {
        id: 'thread',
        title: 'Streaming history',
        agentId: '',
        repositoryId: '',
        status: 'review',
        draft: '',
        files: [],
        example: false,
        createdAt: '2026-10-01T00:00:00Z',
        messages: Array.from({ length: 120 }, (_, i) => ({
          id: `m${i}`,
          role: i % 2 ? 'assistant' : 'user',
          text: `Message ${i}`,
        })),
        turns: Array.from({ length: 60 }, (_, i) => ({
          id: `t${i}`,
          assistantId: `m${i * 2 + 1}`,
          agentId: '',
          provider: 'codex',
          model: '',
          status: 'completed',
          startedAt: '2026-10-01T00:00:00Z',
          finishedAt: '2026-10-01T00:01:00Z',
          checkpoint: {
            before: 'before',
            after: 'after',
            omitted: [],
            files: [
              {
                path: 'file.txt',
                before: 'a'.repeat(8192),
                after: 'b'.repeat(8192),
                viewed: false,
              },
            ],
          },
        })),
      },
    ],
  }))
  const samples = { sqlite: [], retained: [] }
  for (let frame = 0; frame < 120; frame++) {
    store.updateTaskHistory('thread', (task) => ({
      ...task,
      messages: task.messages.map((message, i) =>
        i === 119 ? { ...message, text: message.text + ' streamed' } : message,
      ),
    }))
    const reads = {
      sqlite: () => sql.page('thread', undefined, store.taskSummary('thread').historyRevision),
      retained: () => store.historyPage('thread'),
    }
    const pages = {}
    // Alternate order to reduce systematic warm-cache bias.
    for (const name of frame % 2 ? ['sqlite', 'retained'] : ['retained', 'sqlite']) {
      const start = performance.now()
      pages[name] = reads[name]()
      if (frame >= 20) samples[name].push(performance.now() - start)
    }
    assert.deepEqual(pages.retained, pages.sqlite)
  }
  const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]
  console.log(
    JSON.stringify(
      {
        scope:
          '60 turns, 120 messages, 16 KiB checkpoint text per turn; 100 measured growing-message frames after 20 warmups; excludes writes, transport and rendering',
        mismatches: 0,
        sqlitePageMedianMs: median(samples.sqlite),
        retainedPageMedianMs: median(samples.retained),
        retainedHistories: store.retainedHistories().tasks,
      },
      null,
      2,
    ),
  )
} finally {
  db.close()
}
