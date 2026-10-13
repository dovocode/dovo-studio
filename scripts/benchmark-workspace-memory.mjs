// Build @dovo/runtime and dependencies first. Run the measured read in a fresh GC-enabled process.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { openDatabase } from '../packages/runtime/dist/storage/database.js'
import { WorkspaceStore } from '../packages/runtime/dist/storage/workspace.js'

if (process.argv[2] === '--read') {
  const db = openDatabase(process.argv[3])
  try {
    global.gc()
    const before = process.memoryUsage().heapUsed
    const start = performance.now()
    const store = new WorkspaceStore(db)
    const openMs = performance.now() - start
    global.gc()
    const idleHeapBytes = process.memoryUsage().heapUsed - before
    assert.equal(store.get().tasks.length, 400)
    assert.equal(store.retainedHistories().tasks.length, 0)
    const editStart = performance.now()
    store.updateTask('task-3', (task) => ({ ...task, title: 'Renamed' }))
    const metadataEditMs = performance.now() - editStart
    assert.equal(store.retainedHistories().tasks.length, 0)
    const loadStart = performance.now()
    const selected = store.task('task-3')
    const selectedLoadMs = performance.now() - loadStart
    assert.equal(selected.messages.length, 250)
    assert.equal(selected.turns.length, 125)
    assert.deepEqual(store.retainedHistories().tasks, ['task-3'])
    for (let index = 0; index < 40; index++) store.task(`task-${index}`)
    assert.ok(store.retainedHistories().tasks.length <= 32)
    console.log(
      JSON.stringify(
        {
          scope: 'Fresh process, 400 tasks / 100,000 messages / 50,000 checkpointed turns',
          openMs: Number(openMs.toFixed(2)),
          idleHeapMiB: Number((idleHeapBytes / 1024 / 1024).toFixed(2)),
          metadataEditMs: Number(metadataEditMs.toFixed(2)),
          selectedLoadMs: Number(selectedLoadMs.toFixed(2)),
          retainedAfterFortyReads: store.retainedHistories(),
        },
        null,
        2,
      ),
    )
  } finally {
    db.close()
  }
} else {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-workspace-benchmark-'))
  const path = join(directory, 'runtime.db')
  try {
    const db = openDatabase(path)
    try {
      const store = new WorkspaceStore(db)
      const tasks = Array.from({ length: 400 }, (_, index) => ({
        id: `task-${index}`,
        title: `Task ${index}`,
        agentId: '',
        repositoryId: '',
        status: 'review',
        createdAt: '2026-01-01T00:00:00Z',
        draft: '',
        example: false,
        files: [],
        messages: Array.from({ length: 250 }, (_, ordinal) => ({
          id: `m-${index}-${ordinal}`,
          role: ordinal % 2 ? 'assistant' : 'user',
          text: `message ${ordinal} `.repeat(40),
          ...(ordinal % 2 ? { turnId: `turn-${index}-${(ordinal - 1) / 2}` } : {}),
        })),
        turns: Array.from({ length: 125 }, (_, ordinal) => ({
          id: `turn-${index}-${ordinal}`,
          assistantId: `m-${index}-${ordinal * 2 + 1}`,
          agentId: 'agent',
          provider: 'codex',
          model: 'model',
          status: 'completed',
          tokens: 1000,
          startedAt: '2026-01-01T00:00:00Z',
          finishedAt: '2026-01-01T00:01:00Z',
          checkpoint: {
            before: 'before',
            after: 'after',
            omitted: [],
            files: [
              { path: 'a.ts', before: 'x'.repeat(200), after: 'y'.repeat(200), viewed: false },
            ],
          },
        })),
      }))
      store.update((workspace) => ({ ...workspace, tasks }))
    } finally {
      db.close()
    }
    process.stdout.write(
      execFileSync(
        process.execPath,
        ['--expose-gc', fileURLToPath(import.meta.url), '--read', path],
        { encoding: 'utf8' },
      ),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
