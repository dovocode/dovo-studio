import type Database from 'better-sqlite3'
import { decode, mutableStruct, runtimePreferencesSchema } from '@dovo/protocol'
import { Schema } from 'effect'
import { dirname, join, resolve, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { HttpError } from '../errors.js'
import { worktreesRoot } from '../scm/tasks/task-worktree-keys.js'
import { readLocalSettingsSection, writeLocalSettingsSection } from '@dovo/protocol/local-settings'
export class RuntimePreferences {
  private readonly settingsPath: string | null
  constructor(private db: Database.Database) {
    this.settingsPath =
      db.name === ':memory:'
        ? null
        : (process.env.DOVO_SETTINGS_PATH ?? join(dirname(resolve(db.name)), 'settings.json'))
  }
  get() {
    const saved = this.settingsPath && readLocalSettingsSection('runtime', this.settingsPath)
    if (saved !== undefined && saved !== null) return decode(runtimePreferencesSchema, saved)
    const row = decode(
      Schema.UndefinedOr(mutableStruct({ value: Schema.String })),
      this.db.prepare('SELECT value FROM documents WHERE id = ?').get('runtime-preferences'),
    )
    const settings = decode(runtimePreferencesSchema, row ? JSON.parse(row.value) : {})
    if (row && this.settingsPath)
      writeLocalSettingsSection('runtime', () => settings, this.settingsPath)
    return settings
  }
  /** Partial saves merge into the current preferences, so a client that knows only some fields
   * (for example an older phone) never resets the others to their defaults. */
  save(value: unknown) {
    const changes = value && typeof value === 'object' ? value : {}
    const settings = decode(runtimePreferencesSchema, { ...this.get(), ...changes })
    const root = settings.worktreesRoot.trim()
    if (root && root !== '~' && !root.startsWith('~/') && !isAbsolute(root))
      throw new HttpError(400, 'Worktree location must be an absolute path on this computer')
    settings.worktreesRoot = root
    if (this.settingsPath) writeLocalSettingsSection('runtime', () => settings, this.settingsPath)
    else
      this.db
        .prepare(
          'INSERT INTO documents VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
        )
        .run('runtime-preferences', JSON.stringify(settings))
    return settings
  }
  worktreesRoot() {
    return this.worktreesLocation().root
  }
  worktreesLocation() {
    const configured = this.get().worktreesRoot.trim()
    if (!configured)
      return {
        root: worktreesRoot(),
        source: process.env.DOVO_DATA_ROOT ? 'DOVO_DATA_ROOT' : 'Default (~/.dovo/worktrees)',
      }
    const root =
      configured === '~'
        ? homedir()
        : configured.startsWith('~/')
          ? join(homedir(), configured.slice(2))
          : configured
    if (!isAbsolute(root))
      throw new HttpError(400, 'Worktree location must be an absolute path on this computer')
    return { root: resolve(root), source: 'Settings' }
  }
}
