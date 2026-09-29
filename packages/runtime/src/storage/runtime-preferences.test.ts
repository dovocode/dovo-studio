import { expect, it } from 'vite-plus/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './database'
import { RuntimePreferences } from './runtime-preferences'

it('moves saved runtime preferences from SQLite to settings.json', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-runtime-settings-'))
  const db = openDatabase(join(directory, 'runtime.sqlite'))
  try {
    db.prepare('INSERT INTO documents VALUES (?, ?)').run(
      'runtime-preferences',
      JSON.stringify({ branchPrefix: 'custom/' }),
    )
    const preferences = new RuntimePreferences(db)
    expect(preferences.get().branchPrefix).toBe('custom/')
    const path = join(directory, 'settings.json')
    expect(JSON.parse(readFileSync(path, 'utf8')).runtime.branchPrefix).toBe('custom/')
    preferences.save({ autoContinueAfterRestart: true })
    expect(JSON.parse(readFileSync(path, 'utf8')).runtime).toMatchObject({
      branchPrefix: 'custom/',
      autoContinueAfterRestart: true,
    })
  } finally {
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
