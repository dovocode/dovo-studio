import { decode } from '@dovo/protocol'
import { Schema } from 'effect'
import { DatabaseSync } from 'node:sqlite'
import { expect, it, vi } from 'vite-plus/test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { setupServer, writePrivateJson } from './server-config'
// Launching the bundled runtime imports native SDKs, especially on Windows runners.
vi.setConfig({ testTimeout: 30_000 })
it('runs doctor in the selected release so bundled SDK diagnostics do not use checkout versions', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-release-doctor-'))
  try {
    setupServer(directory)
    const release = join(directory, 'releases', 'selected')
    mkdirSync(release, {
      recursive: true,
    })
    writeFileSync(join(release, 'index.js'), '')
    writeFileSync(
      join(release, 'server-cli.js'),
      "console.log(JSON.stringify({release:'selected',args:process.argv.slice(2)}))",
    )
    writePrivateJson(join(directory, 'server-release.json'), {
      entrypoint: join(release, 'index.js'),
    })
    const result = await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('../dist/server-cli.js', import.meta.url)),
      'doctor',
      '--data-dir',
      directory,
      '--check-updates',
      '--json',
    ])
    expect(JSON.parse(result.stdout)).toEqual({
      release: 'selected',
      args: ['doctor', '--data-dir', directory, '--check-updates', '--json'],
    })
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})
it('keeps archive installs on their package version and directs updates to the package manager', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-package-update-'))
  try {
    const result = promisify(execFile)(
      process.execPath,
      [
        fileURLToPath(new URL('../dist/server-cli.js', import.meta.url)),
        'update',
        '--data-dir',
        directory,
      ],
      {
        env: {
          ...process.env,
          DOVO_SERVER_DISTRIBUTION: 'archive',
        },
      },
    )
    await expect(result).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining('managed by Homebrew, mise or an archive install'),
    })
  } finally {
    rmSync(directory, {
      recursive: true,
      force: true,
    })
  }
})

it('creates, lists, restores and exports backups through the CLI while preserving raw damaged records', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-cli-recovery-'))
  try {
    const config = setupServer(directory)
    const db = new DatabaseSync(config.databasePath)
    db.exec(
      'CREATE TABLE documents (id TEXT PRIMARY KEY, value TEXT); CREATE TABLE conversation_items (task_id TEXT, kind TEXT, value TEXT)',
    )
    db.prepare('INSERT INTO documents VALUES (?, ?)').run('fixture', 'saved data')
    db.prepare('INSERT INTO conversation_items VALUES (?, ?, ?)').run(
      'damaged',
      'message',
      '{broken',
    )
    db.close()
    const call = async (command: string, ...args: string[]) => {
      const result = await promisify(execFile)(process.execPath, [
        fileURLToPath(new URL('../dist/server-cli.js', import.meta.url)),
        command,
        '--data-dir',
        directory,
        '--json',
        ...args,
      ])
      return decode(Schema.Record(Schema.String, Schema.Unknown), JSON.parse(result.stdout))
    }
    const snapshot = await call('backup')
    if (typeof snapshot.path !== 'string') throw new Error('Backup path was not returned')
    const list = await call('backups')
    expect(list.entries).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: snapshot.path })]),
    )
    const changed = new DatabaseSync(config.databasePath)
    changed.exec("UPDATE documents SET value='changed' WHERE id='fixture'")
    changed.close()
    expect(await call('restore', '--backup', snapshot.path)).toMatchObject({
      restored: config.databasePath,
    })
    const restored = new DatabaseSync(config.databasePath)
    try {
      expect(restored.prepare('SELECT value FROM documents WHERE id=?').get('fixture')).toEqual({
        value: 'saved data',
      })
    } finally {
      restored.close()
    }
    const output = join(directory, 'export')
    expect(await call('recovery-export', '--output', output)).toMatchObject({
      output,
      tables: expect.arrayContaining([
        expect.objectContaining({ table: 'conversation_items', invalidJson: 1 }),
      ]),
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
