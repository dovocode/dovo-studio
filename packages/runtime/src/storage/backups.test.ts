import { afterEach, expect, it, vi } from 'vite-plus/test'
import Database from 'better-sqlite3'
import { mkdtemp, readFile, rm, writeFile, open, stat, truncate, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openDatabase } from './database'
import { RuntimeBackups, restoreRuntimeBackup, verifyRuntimeBackup } from './backups'
import { acquireProcessLock } from './process-lock'
import { exportRuntimeRecovery } from './recovery'
import { rotateRuntimeLogs } from './log-rotation'
import * as backup from './backup'
const paths: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true })
})
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'dovo-backup-test-'))
  paths.push(dir)
  const path = join(dir, 'runtime.sqlite')
  return { dir, path, db: openDatabase(path), backups: new RuntimeBackups(path) }
}

it('verifies committed WAL contents, bounds retention and restores under the runtime lock', async () => {
  const f = await setup()
  f.db.prepare('INSERT INTO documents VALUES (?, ?)').run('fixture', 'original')
  const snapshot = await f.backups.create()
  verifyRuntimeBackup(snapshot.path)
  const copy = new Database(snapshot.path, { readonly: true })
  try {
    expect(copy.prepare('SELECT value FROM documents WHERE id=?').get('fixture')).toEqual({
      value: 'original',
    })
  } finally {
    copy.close()
  }
  for (let i = 0; i < 4; i++) await f.backups.create()
  f.db.prepare('UPDATE documents SET value=? WHERE id=?').run('changed', 'fixture')
  f.db.close()
  const release = acquireProcessLock(join(f.dir, 'runtime-process.lock'))
  try {
    await expect(restoreRuntimeBackup(f.path, snapshot.path)).rejects.toThrow(
      'Another runtime operation',
    )
  } finally {
    release()
  }
  await restoreRuntimeBackup(f.path, snapshot.path)
  const restored = new Database(f.path)
  try {
    expect(restored.prepare('SELECT value FROM documents WHERE id=?').get('fixture')).toEqual({
      value: 'original',
    })
  } finally {
    restored.close()
  }
  for (let i = 0; i < 7; i++) await f.backups.create()
  expect(await f.backups.list()).toHaveLength(5)
})
it('retains existing backups after a failed write and never publishes partial files', async () => {
  const f = await setup()
  try {
    const original = await f.backups.create()
    vi.spyOn(backup, 'backupRuntimeDatabase').mockRejectedValueOnce(
      new Error('SQLITE_FULL: database or disk is full'),
    )
    await expect(f.backups.create()).rejects.toThrow('disk is full')
    expect((await f.backups.status()).failure?.message).toContain('disk is full')
    expect((await new RuntimeBackups(f.path).status()).failure?.message).toContain('disk is full')
    expect((await f.backups.list()).map((item) => item.path)).toContain(original.path)
    await f.backups.create()
    expect((await f.backups.status()).failure).toBeNull()
    // Byte budget also covers pre-update backups; sparse files avoid allocating the payload.
    const huge = join(f.backups.directory, 'runtime-before-old.sqlite')
    await writeFile(huge, '')
    await truncate(huge, 513 * 1024 * 1024)
    await utimes(huge, new Date(0), new Date(0))
    await f.backups.prune()
    expect(await stat(huge).catch(() => null)).toBeNull()
  } finally {
    f.db.close()
  }
})
it('exports invalid history verbatim without hydrating or changing the original', async () => {
  const f = await setup()
  try {
    f.db.exec('CREATE TABLE conversation_items (task_id TEXT, kind TEXT, value TEXT)')
    f.db
      .prepare('INSERT INTO conversation_items VALUES (?, ?, ?)')
      .run('damaged', 'message', '{broken')
    f.db.prepare('INSERT INTO documents VALUES (?, ?)').run(
      'workspace',
      JSON.stringify({
        storageVersion: 2,
        historyCounts: { damaged: { messages: 2, turns: 0 } },
      }),
    )
    const output = join(f.dir, 'recovery')
    const report = await exportRuntimeRecovery(f.path, output)
    expect(report.conversationIssues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('expected 2 message'),
        expect.stringContaining('invalid JSON'),
      ]),
    )
    expect(report.tables.find((table) => table.table === 'conversation_items')).toMatchObject({
      records: 1,
      invalidJson: 1,
    })
    expect(
      JSON.parse((await readFile(join(output, 'conversation_items.jsonl'), 'utf8')).trim()),
    ).toEqual({ task_id: 'damaged', kind: 'message', value: '{broken' })
    expect(f.db.prepare('SELECT value FROM conversation_items').get()).toEqual({ value: '{broken' })
    await expect(exportRuntimeRecovery(f.path, output)).rejects.toThrow('EEXIST')
  } finally {
    f.db.close()
  }
})
it('rotates bounded tails while keeping an existing append descriptor usable', async () => {
  const f = await setup()
  f.db.close()
  const path = join(f.dir, 'server.log')
  const handle = await open(path, 'a')
  try {
    for (let i = 0; i < 5; i++) {
      await handle.write('old\n'.repeat(100) + `tail ${i}\n`)
      await rotateRuntimeLogs(f.dir, 100)
    }
    await handle.write('still logging\n')
    expect(await readFile(path, 'utf8')).toBe('still logging\n')
    expect(await readFile(path + '.1', 'utf8')).toContain('tail 4')
    expect((await stat(path + '.3')).size).toBeLessThanOrEqual(100)
    expect(await stat(path + '.4').catch(() => null)).toBeNull()
  } finally {
    await handle.close()
  }
})
