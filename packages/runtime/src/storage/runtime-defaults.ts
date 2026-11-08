import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  runtimeDefaultsSchema,
  supportsAccess,
  permissionPolicyIssue,
  sharedSettingsEntrySchema,
  mergeSharedSettings,
  initializeScopedSettings,
  type SharedSettingsEntry,
  type TaskHarness,
} from '@dovo/protocol'
import { isDeepStrictEqual } from 'node:util'
import { environmentSettings } from '@dovo/protocol'
import { HttpError } from '../errors.js'

const defaultsCache = new WeakMap<
  Database.Database,
  {
    value: ReturnType<typeof readDefaults>
    expires: number
    revision: number
  }
>()
let revision = 0
function readDefaults(db: Database.Database) {
  const row = decode(
    Schema.UndefinedOr(mutableStruct({ value: Schema.String })),
    db.prepare('SELECT value FROM documents WHERE id = ?').get('runtime-defaults'),
  )
  return decode(runtimeDefaultsSchema, row ? JSON.parse(row.value) : {})
}

/** Shared runtime preferences; task copies stay stable when these defaults change. */
export class RuntimeDefaults {
  constructor(private db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS shared_state_versions (id TEXT PRIMARY KEY, value TEXT NOT NULL)',
    )
  }
  /** Accepted shared versions survive rapid edits and restarts before a peer can connect. */
  private rememberShared(entries: readonly SharedSettingsEntry[]) {
    for (const entry of entries) {
      const id = JSON.stringify([
        entry.key,
        entry.updatedAt,
        entry.changeId,
        ...(entry.revisions ? [entry.revisions] : []),
      ])
      const previous = this.db
        .prepare('SELECT value FROM shared_state_versions WHERE id=?')
        .pluck()
        .get(id)
      if (
        typeof previous === 'string' &&
        !isDeepStrictEqual(JSON.parse(previous), JSON.parse(JSON.stringify(entry)))
      )
        throw new HttpError(409, 'A shared state version was reused with different data')
      this.db
        .prepare('INSERT OR IGNORE INTO shared_state_versions VALUES (?,?)')
        .run(id, JSON.stringify(entry))
    }
  }
  sharedVersions(after = 0) {
    return decode(
      Schema.Array(mutableStruct({ sequence: Schema.Int, value: Schema.String })),
      this.db
        .prepare(
          'SELECT rowid AS sequence,value FROM shared_state_versions WHERE rowid>? ORDER BY rowid',
        )
        .all(after),
    ).map((row) => ({
      sequence: row.sequence,
      entry: decode(sharedSettingsEntrySchema, JSON.parse(row.value)),
    }))
  }
  mergeShared(entries: readonly SharedSettingsEntry[]) {
    return this.db.transaction(() => {
      const current = this.get()
      const scoped = initializeScopedSettings(current)
      const merged = mergeSharedSettings(scoped.shared, entries)
      this.rememberShared(entries)
      if (!isDeepStrictEqual(merged, scoped.shared))
        this.save({ ...current, scopedSettings: { ...scoped, shared: merged } }, false)
      return merged
    })()
  }
  private cached() {
    // An outer transaction can roll back. Never publish its uncommitted settings
    // into the shared cache, or serve an older cached value inside it.
    if (this.db.inTransaction)
      return { value: readDefaults(this.db), expires: 0, revision: ++revision }
    let cached = defaultsCache.get(this.db)
    if (!cached || cached.expires <= Date.now()) {
      const value = readDefaults(this.db)
      cached = {
        value,
        expires: Date.now() + 15000,
        revision: cached && isDeepStrictEqual(cached.value, value) ? cached.revision : ++revision,
      }
      defaultsCache.set(this.db, cached)
    }
    return cached
  }
  version() {
    return this.cached().revision
  }
  get() {
    // Callers historically receive an independent settings object.
    return structuredClone(this.cached().value)
  }
  save(value: unknown, configure = true) {
    const settings = decode(runtimeDefaultsSchema, value)
    validateDefaultHarness(settings.harness)
    const previous = this.get()
    if (
      previous.scopedSettings &&
      !isDeepStrictEqual(
        environmentSettings({ ...previous, scopedSettings: undefined }),
        environmentSettings({ ...settings, scopedSettings: undefined }),
      )
    ) {
      settings.scopedSettings = {
        ...(settings.scopedSettings ?? previous.scopedSettings),
        environment: {
          ...(settings.scopedSettings ?? previous.scopedSettings).environment,
          taskDefaults: environmentSettings({ ...settings, scopedSettings: undefined })
            .taskDefaults,
        },
      }
    }
    this.db.transaction(() => {
      this.rememberShared(previous.scopedSettings?.shared ?? [])
      this.rememberShared(settings.scopedSettings?.shared ?? [])
      this.db
        .prepare(
          'INSERT INTO documents VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
        )
        .run(
          'runtime-defaults',
          JSON.stringify({ ...settings, configured: configure || settings.configured }),
        )
    })()
    defaultsCache.delete(this.db)
    return this.get()
  }
}

export function validateDefaultHarness(harness: TaskHarness) {
  const issue = permissionPolicyIssue(harness)
  if (issue) throw new HttpError(400, issue)
  if (!supportsAccess(harness.provider, harness.permission))
    throw new HttpError(400, 'The selected provider does not support this access mode')
  if (
    harness.provider === 'acp' &&
    !harness.acpInstallationId &&
    !harness.endpoint.trim() &&
    !harness.executablePath?.trim()
  )
    throw new HttpError(400, 'Choose an installed ACP agent or enter its executable')
}
