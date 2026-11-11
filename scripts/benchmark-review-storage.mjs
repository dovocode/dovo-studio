// Run with: pnpm --filter @dovo/runtime exec tsx ../../scripts/benchmark-review-storage.mjs
// Real SQLite writes, synthetic files. Excludes HTTP, transport and rendering.
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { gzipSync } from 'node:zlib'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../packages/runtime/src/storage/database.ts'
import { WorkspaceStore } from '../packages/runtime/src/storage/workspace.ts'
import { versionReviewedFiles } from '../packages/runtime/src/storage/file-review-versions.ts'
import { RuntimeDefaults } from '../packages/runtime/src/storage/runtime-defaults.ts'
import {
  changedFileFingerprint,
  decode,
  runtimeDefaultsSchema,
} from '../packages/protocol/src/index.ts'

function measure(run, count = 40) {
  for (let index = 0; index < 10; index++) run(index)
  const samples = []
  for (let index = 0; index < count; index++) {
    const start = performance.now()
    run(index)
    samples.push(performance.now() - start)
  }
  samples.sort((a, b) => a - b)
  return { medianMs: samples[Math.floor(count / 2)], p95Ms: samples[Math.floor(count * 0.95)] }
}
const source = Array.from(
  { length: 400 },
  (_, index) =>
    `export const item${index} = 'source line ${index}: preserve file bytes and review state';`,
).join('\n')
const files = Array.from({ length: 50 }, (_, index) => ({
  path: `src/file-${index}.ts`,
  before: source,
  after: source + '\n// changed\n',
  diskContents: source + '\n// changed\n',
  viewed: false,
}))
const task = {
  id: 'thread',
  title: 'Review',
  repositoryId: '',
  agentId: '',
  status: 'review',
  createdAt: '2026-11-11',
  draft: '',
  example: false,
  files,
  messages: [],
}
const directory = process.argv.includes('--disk')
  ? mkdtempSync(join(tmpdir(), 'dovo-review-storage-'))
  : undefined
const db = openDatabase(directory ? join(directory, 'runtime.db') : ':memory:')
try {
  const store = new WorkspaceStore(db)
  store.update((workspace) => ({ ...workspace, tasks: [task] }))
  const before = store.taskSummary(task.id)
  const changed = {
    ...before,
    files: before.files.map((file, index) => (index === 25 ? { ...file, viewed: true } : file)),
  }
  const updated = versionReviewedFiles(changed, before)
  assert.equal(updated.files[25].viewed, true)
  assert.equal(updated.fileReviewVersions[files[0].path], before.fileReviewVersions[files[0].path])
  const bookkeeping = measure(() => versionReviewedFiles(changed, before))
  const fingerprints = measure(() => files.map(changedFileFingerprint))
  const viewedWrite = measure(() =>
    store.updateTask(task.id, (value) => ({
      ...value,
      files: value.files.map((file, index) =>
        index === 25 ? { ...file, viewed: !file.viewed } : file,
      ),
    })),
  )
  db.pragma('wal_autocheckpoint = 0')
  db.pragma('wal_checkpoint(TRUNCATE)')
  let edit = 0
  const metadataWrite = measure(() =>
    store.updateTask(task.id, (value) => ({ ...value, title: `Title ${++edit}` })),
  )
  const metadataWalBytes = directory ? statSync(join(directory, 'runtime.db-wal')).size : undefined
  const reply = JSON.stringify({ files })
  const acknowledgement = JSON.stringify({ ok: true })
  const defaults = new RuntimeDefaults(db)
  const defaultsProjection = measure(() => {
    defaults.get()
    decode(runtimeDefaultsSchema, store.publicValue(defaults.get()))
  })
  console.log(
    JSON.stringify(
      {
        scope: `50 synthetic files; real ${directory ? 'file-backed WAL' : 'in-memory'} SQLite`,
        fileCharacters: source.length,
        filesJsonBytes: Buffer.byteLength(JSON.stringify(files)),
        bookkeeping,
        fingerprints,
        viewedWrite,
        metadataWrite,
        metadataWalBytes,
        changesReply: {
          fullJsonBytes: Buffer.byteLength(reply),
          fullGzipBytes: gzipSync(reply).length,
          ackJsonBytes: Buffer.byteLength(acknowledgement),
          ackGzipBytes: gzipSync(acknowledgement).length,
        },
        defaultSettings: {
          jsonBytes: Buffer.byteLength(JSON.stringify(defaults.get())),
          projection: defaultsProjection,
        },
      },
      null,
      2,
    ),
  )
} finally {
  db.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
}
