import { detectRuntimeType } from './runtime-type.js'
import type { ManagedPolicy } from '../policy/managed-policy.js'
import type Database from 'better-sqlite3'
import { decode, mutableStruct, runtimePreferencesSchema } from '@dovo/protocol'
import { Schema } from 'effect'
import { dirname, join, resolve, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { HttpError } from '../errors.js'
import { worktreesRoot } from '../scm/tasks/task-worktree-keys.js'
import {
  readLocalSettingsSection,
  writeLocalSettingsSection,
  writeLocalSettingsSections,
} from '@dovo/protocol/local-settings'
/** Saves from paired clients that this file records with the settings they wrote. */
const savesSection = 'runtimeSaves'
const appliedSaveLimit = 200
const savesSchema = mutableStruct({
  revision: Schema.Number,
  applied: Schema.Array(
    mutableStruct({ deviceId: Schema.String, id: Schema.String, revision: Schema.Number }),
  ),
})
type Saves = Schema.Schema.Type<typeof savesSchema>
const readSaves = (value: unknown): Saves =>
  value === undefined || value === null ? { revision: 0, applied: [] } : decode(savesSchema, value)
const attemptSchema = Schema.UndefinedOr(
  mutableStruct({ base_revision: Schema.NullOr(Schema.Number) }),
)
const tableExists = (db: Database.Database, name: string) =>
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
  undefined
/** A receipted save from one paired device. */
type PreferenceSaveIdentity = { deviceId: string; id: string }
type RuntimeSettings = Schema.Schema.Type<typeof runtimePreferencesSchema>
type SaveOutcome = {
  previous: RuntimeSettings
  settings: RuntimeSettings
  write?: { runtime: unknown; saves: Saves }
}
export class RuntimePreferences {
  private readonly detectedType = detectRuntimeType()
  private readonly settingsPath: string | null
  constructor(
    private db: Database.Database,
    private onWatchSettingsChange?: () => void,
    private policy?: ManagedPolicy,
  ) {
    this.settingsPath =
      db.name === ':memory:'
        ? null
        : (process.env.DOVO_SETTINGS_PATH ?? join(dirname(resolve(db.name)), 'settings.json'))
    db.transaction(() => {
      if (tableExists(db, 'runtime_preference_save_attempts')) return
      // base_revision is NULL when an older runtime started the save without recording it.
      db.exec(
        'CREATE TABLE runtime_preference_save_attempts (device_id TEXT NOT NULL, id TEXT NOT NULL, base_revision INTEGER, PRIMARY KEY(device_id,id))',
      )
      // An older runtime could commit a preference save and lose its receipt. Its receipts do
      // not record the route, so every unfinished receipt becomes an attempt with an unknown
      // base. Only preference saves read these rows; pruning removes the rest once they settle.
      if (tableExists(db, 'mutation_receipts'))
        db.exec(
          'INSERT INTO runtime_preference_save_attempts SELECT device_id, id, NULL FROM mutation_receipts WHERE result IS NULL',
        )
    })()
    this.pruneAttempts()
  }
  /** An attempt matters only while its receipt is unfinished. A settled receipt returns its
   * stored outcome, and a revoked device cannot retry. A save that was written keeps its
   * record in the settings, so an explicit retry after a rejection still finds it. */
  private pruneAttempts() {
    if (!tableExists(this.db, 'mutation_receipts')) return
    this.db
      .prepare(
        `DELETE FROM runtime_preference_save_attempts AS attempt WHERE NOT EXISTS (
          SELECT 1 FROM mutation_receipts AS receipt
          WHERE receipt.device_id = attempt.device_id AND receipt.id = attempt.id
            AND receipt.result IS NULL)`,
      )
      .run()
  }
  /** Decides a save against the current document. With a settings file, this runs while the
   * file lock is held, so another process cannot change the document between the checks and
   * the write. Returns undefined when nothing must be written. */
  private decide(
    current: { runtime: unknown; saves: Saves },
    changes: object,
    identity: PreferenceSaveIdentity | undefined,
  ): SaveOutcome {
    const previous = this.decode(current.runtime)
    if (
      identity &&
      current.saves.applied.some(
        (save) => save.deviceId === identity.deviceId && save.id === identity.id,
      )
    )
      return { previous, settings: previous }
    const settings = decode(runtimePreferencesSchema, { ...previous, ...changes })
    this.policy?.validatePreferences(settings)
    const root = settings.worktreesRoot.trim()
    if (root && root !== '~' && !root.startsWith('~/') && !isAbsolute(root))
      throw new HttpError(400, 'Worktree location must be an absolute path on this computer')
    settings.worktreesRoot = root
    if (identity) {
      const attempt = decode(
        attemptSchema,
        this.db
          .prepare(
            'SELECT base_revision FROM runtime_preference_save_attempts WHERE device_id = ? AND id = ?',
          )
          .get(identity.deviceId, identity.id),
      )
      if (!attempt)
        this.db
          .prepare('INSERT INTO runtime_preference_save_attempts VALUES (?, ?, ?)')
          .run(identity.deviceId, identity.id, current.saves.revision)
      else if (attempt.base_revision !== current.saves.revision) {
        // The earlier attempt may have written, and a newer save may have followed it.
        // Accept the retry only if it would change nothing.
        if (JSON.stringify(settings) === JSON.stringify(previous))
          return { previous, settings: previous }
        throw new HttpError(
          409,
          'Computer preferences changed after this save started, and the computer cannot confirm that this save applied. Review the current preferences and save again.',
        )
      }
    }
    const revision = current.saves.revision + 1
    return {
      previous,
      settings,
      write: {
        runtime: this.policy?.storedPreferences(current.runtime, previous, settings) ?? settings,
        saves: {
          revision,
          applied: identity
            ? [...current.saves.applied, { ...identity, revision }].slice(-appliedSaveLimit)
            : current.saves.applied,
        } satisfies Saves,
      },
    }
  }
  private databaseDocument(id: string): unknown {
    const row = decode(
      Schema.UndefinedOr(mutableStruct({ value: Schema.String })),
      this.db.prepare('SELECT value FROM documents WHERE id = ?').get(id),
    )
    return row ? JSON.parse(row.value) : undefined
  }
  private read(): unknown {
    const saved = this.settingsPath && readLocalSettingsSection('runtime', this.settingsPath)
    if (saved !== undefined && saved !== null) return saved
    const row = this.databaseDocument('runtime-preferences')
    const settings: unknown = row ?? {}
    if (row !== undefined && this.settingsPath)
      writeLocalSettingsSection('runtime', () => settings, this.settingsPath)
    return settings
  }
  get() {
    return this.decode(this.read())
  }
  private decode(value: unknown) {
    const effective = this.policy?.preferences(value) ?? value
    const settings = decode(runtimePreferencesSchema, effective)
    if (effective && typeof effective === 'object' && !('runtimeIcon' in effective))
      settings.runtimeIcon = this.detectedType
    return settings
  }
  /** Partial saves merge into the current preferences, so a client that knows only some fields
   * (for example an older phone) never resets the others to their defaults. */
  save(value: unknown, identity?: PreferenceSaveIdentity) {
    const changes = value && typeof value === 'object' ? value : {}
    if (identity) this.pruneAttempts()
    const result: { outcome?: SaveOutcome } = {}
    // The settings and the record of this save commit together. A retry after a lost
    // receipt then finds its save instead of writing old values again.
    if (this.settingsPath)
      writeLocalSettingsSections((document) => {
        const runtime = document.runtime
        const outcome = (result.outcome = this.decide(
          {
            runtime:
              runtime === undefined || runtime === null
                ? (this.databaseDocument('runtime-preferences') ?? {})
                : runtime,
            saves: readSaves(document[savesSection]),
          },
          changes,
          identity,
        ))
        return (
          outcome.write && { runtime: outcome.write.runtime, [savesSection]: outcome.write.saves }
        )
      }, this.settingsPath)
    else {
      const upsert = this.db.prepare(
        'INSERT INTO documents VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      this.db
        .transaction(() => {
          const outcome = (result.outcome = this.decide(
            {
              runtime: this.databaseDocument('runtime-preferences') ?? {},
              saves: readSaves(this.databaseDocument(savesSection)),
            },
            changes,
            identity,
          ))
          if (!outcome.write) return
          upsert.run('runtime-preferences', JSON.stringify(outcome.write.runtime))
          upsert.run(savesSection, JSON.stringify(outcome.write.saves))
        })
        .immediate()
    }
    if (!result.outcome) throw new Error('Preferences save produced no outcome')
    const { previous, settings } = result.outcome
    if (
      previous.enableGithubEventStreams !== settings.enableGithubEventStreams ||
      previous.enablePipelineWatching !== settings.enablePipelineWatching ||
      previous.enablePullRequestWatching !== settings.enablePullRequestWatching ||
      previous.enablePullRequestBabysitting !== settings.enablePullRequestBabysitting
    )
      this.onWatchSettingsChange?.()
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
