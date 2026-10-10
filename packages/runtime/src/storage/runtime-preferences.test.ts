import { expect, it, vi } from 'vite-plus/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from './database'
import { RuntimePreferences } from './runtime-preferences'

it('persists a host worktree location across partial saves and rejects relative locations', () => {
  const db = openDatabase(':memory:')
  try {
    const preferences = new RuntimePreferences(db)
    const path = join(tmpdir(), 'configured-worktrees')
    expect(preferences.get().removeWorktreesOnThreadDelete).toBe(false)
    preferences.save({ worktreesRoot: path, removeWorktreesOnThreadDelete: true })
    preferences.save({ autoArchiveDays: 7 })
    expect(new RuntimePreferences(db).worktreesRoot()).toBe(path)
    expect(new RuntimePreferences(db).get().removeWorktreesOnThreadDelete).toBe(true)
    expect(() => preferences.save({ worktreesRoot: 'relative/path' })).toThrow('absolute path')
    expect(preferences.worktreesRoot()).toBe(path)
  } finally {
    db.close()
  }
})

it('moves saved runtime preferences from SQLite to settings.json', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-runtime-settings-'))
  vi.stubEnv('DOVO_SETTINGS_PATH', join(directory, 'settings.json'))
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
    vi.unstubAllEnvs()
    db.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('keeps remote profile metadata across partial saves and rejects invalid profile IDs', () => {
  const db = openDatabase(':memory:')
  try {
    const preferences = new RuntimePreferences(db)
    expect(preferences.get().browserProfiles).toEqual([{ id: 'default', name: 'Default' }])
    preferences.save({
      browserProfiles: [
        { id: 'default', name: 'Default' },
        { id: 'work', name: 'Work' },
      ],
    })
    preferences.save({ autoArchiveDays: 7 })
    expect(new RuntimePreferences(db).get().browserProfiles).toEqual([
      { id: 'default', name: 'Default' },
      { id: 'work', name: 'Work' },
    ])
    expect(() =>
      preferences.save({
        browserProfiles: [
          { id: 'default', name: 'Default' },
          { id: '../outside', name: 'Work' },
        ],
      }),
    ).toThrow(/browserProfiles/)
    expect(() => preferences.save({ browserProfiles: [{ id: 'work', name: 'Work' }] })).toThrow(
      /browserProfiles/,
    )
  } finally {
    db.close()
  }
})

it('defaults child concurrency to four and preserves validated overrides across partial saves', () => {
  const db = openDatabase(':memory:')
  try {
    const preferences = new RuntimePreferences(db)
    expect(preferences.get().maxActiveChildAgents).toBe(4)
    preferences.save({ maxActiveChildAgents: 13 })
    preferences.save({ autoArchiveDays: 7 })
    expect(new RuntimePreferences(db).get().maxActiveChildAgents).toBe(13)
    for (const limit of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => preferences.save({ maxActiveChildAgents: limit })).toThrow(
        /maxActiveChildAgents/,
      )
    expect(preferences.get().maxActiveChildAgents).toBe(13)
  } finally {
    db.close()
  }
})
