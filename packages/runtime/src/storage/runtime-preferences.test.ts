import { expect, it, vi } from 'vite-plus/test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decode } from '@dovo/protocol'
import { Schema } from 'effect'
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
    preferences.save({ autoContinueAfterRestart: true, runtimeIcon: 'cloud' })
    preferences.save({ allowWebRequests: true })
    preferences.save({ autoArchiveDays: 7 })
    expect(JSON.parse(readFileSync(path, 'utf8')).runtime).toMatchObject({
      branchPrefix: 'custom/',
      autoContinueAfterRestart: true,
      runtimeIcon: 'cloud',
      allowWebRequests: true,
    })
    expect(new RuntimePreferences(db).get().runtimeIcon).toBe('cloud')
    expect(new RuntimePreferences(db).get().allowWebRequests).toBe(true)
    expect(() => preferences.save({ allowWebRequests: 'true' })).toThrow(/allowWebRequests/)
    expect(preferences.get().allowWebRequests).toBe(true)
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

it('uses detected server type for unset preferences and preserves explicit choices', () => {
  vi.stubEnv('DOVO_SERVER_DISTRIBUTION', 'archive')
  const db = openDatabase(':memory:')
  try {
    const preferences = new RuntimePreferences(db)
    expect(preferences.get().runtimeIcon).toBe('server')
    preferences.save({ autoArchiveDays: 7 })
    expect(new RuntimePreferences(db).get().runtimeIcon).toBe('server')
    preferences.save({ runtimeIcon: 'desktop' })
    expect(new RuntimePreferences(db).get().runtimeIcon).toBe('desktop')
    preferences.save({ runtimeIcon: 'laptop' })
    expect(new RuntimePreferences(db).get().runtimeIcon).toBe('laptop')
  } finally {
    db.close()
    vi.unstubAllEnvs()
  }
})

it('retries an unapplied save only while no newer save exists', () => {
  const db = openDatabase(':memory:')
  try {
    const preferences = new RuntimePreferences(db)
    const phone = { deviceId: 'phone', id: 'phone-limit' }
    // The first attempt fails before the settings commit.
    db.exec(
      `CREATE TRIGGER fail_settings BEFORE INSERT ON documents WHEN NEW.id = 'runtimeSaves' BEGIN SELECT RAISE(ABORT, 'disk failure'); END`,
    )
    expect(() => preferences.save({ unattendedSpendLimitUsd: 100 }, phone)).toThrow('disk failure')
    expect(preferences.get().unattendedSpendLimitUsd).toBeNull()
    db.exec('DROP TRIGGER fail_settings')
    // Nothing changed since that attempt, so the retry is its first effect.
    expect(preferences.save({ unattendedSpendLimitUsd: 100 }, phone).unattendedSpendLimitUsd).toBe(
      100,
    )
    // A repeated retry finds its own save and writes nothing.
    preferences.save({ unattendedSpendLimitUsd: 10 })
    expect(preferences.save({ unattendedSpendLimitUsd: 100 }, phone).unattendedSpendLimitUsd).toBe(
      10,
    )

    // A recorded attempt that did not write, followed by a newer save from another device.
    const late = { deviceId: 'phone', id: 'late-limit' }
    db.prepare('INSERT INTO runtime_preference_save_attempts VALUES (?, ?, ?)').run(
      late.deviceId,
      late.id,
      JSON.parse(
        decode(
          Schema.Struct({ value: Schema.String }),
          db.prepare("SELECT value FROM documents WHERE id = 'runtimeSaves'").get(),
        ).value,
      ).revision,
    )
    preferences.save({ unattendedSpendLimitUsd: 20 }, { deviceId: 'desktop', id: 'desktop' })
    // The runtime cannot prove that the late save is newer, so it keeps the newer value.
    expect(() => preferences.save({ unattendedSpendLimitUsd: 50 }, late)).toThrow(
      expect.objectContaining({ status: 409 }),
    )
    // A retry that would change nothing is already in effect.
    expect(preferences.save({ unattendedSpendLimitUsd: 20 }, late).unattendedSpendLimitUsd).toBe(20)
    expect(new RuntimePreferences(db).get().unattendedSpendLimitUsd).toBe(20)
  } finally {
    db.close()
  }
})

it('writes runtime settings and the record of their save in one settings.json write', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-runtime-saves-'))
  vi.stubEnv('DOVO_SETTINGS_PATH', join(directory, 'settings.json'))
  const db = openDatabase(join(directory, 'runtime.sqlite'))
  try {
    const preferences = new RuntimePreferences(db)
    preferences.save({ autoArchiveDays: 7 }, { deviceId: 'phone', id: 'save' })
    const document = JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8'))
    expect(document.runtime).toMatchObject({ autoArchiveDays: 7 })
    expect(document.runtimeSaves).toEqual({
      revision: 1,
      applied: [{ deviceId: 'phone', id: 'save', revision: 1 }],
    })
    expect(
      new RuntimePreferences(db).save({ autoArchiveDays: 3 }, { deviceId: 'phone', id: 'save' }),
    ).toMatchObject({ autoArchiveDays: 7 })
  } finally {
    db.close()
    vi.unstubAllEnvs()
    rmSync(directory, { recursive: true, force: true })
  }
})

it('keeps save records in the shared settings file when two runtimes write it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-runtime-writers-'))
  vi.stubEnv('DOVO_SETTINGS_PATH', join(directory, 'settings.json'))
  const first = openDatabase(join(directory, 'first.sqlite'))
  const second = openDatabase(join(directory, 'second.sqlite'))
  try {
    const phone = { deviceId: 'phone', id: 'phone-limit' }
    new RuntimePreferences(first).save({ unattendedSpendLimitUsd: 100 }, phone)
    // The other runtime merges into the file it reads under the lock, not a stale copy.
    expect(
      new RuntimePreferences(second).save(
        { autoArchiveDays: 14 },
        { deviceId: 'desktop', id: 'd' },
      ),
    ).toMatchObject({ unattendedSpendLimitUsd: 100, autoArchiveDays: 14 })
    new RuntimePreferences(second).save({ unattendedSpendLimitUsd: 10 })
    expect(
      new RuntimePreferences(first).save({ unattendedSpendLimitUsd: 100 }, phone),
    ).toMatchObject({ unattendedSpendLimitUsd: 10, autoArchiveDays: 14 })
    expect(
      JSON.parse(readFileSync(join(directory, 'settings.json'), 'utf8')).runtimeSaves.revision,
    ).toBe(3)
  } finally {
    first.close()
    second.close()
    vi.unstubAllEnvs()
    rmSync(directory, { recursive: true, force: true })
  }
})
