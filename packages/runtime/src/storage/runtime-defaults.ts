import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  runtimeDefaultsSchema,
  supportsAccess,
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
  constructor(private db: Database.Database) {}
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
    this.db
      .prepare(
        'INSERT INTO documents VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(
        'runtime-defaults',
        JSON.stringify({ ...settings, configured: configure || settings.configured }),
      )
    defaultsCache.delete(this.db)
    return this.get()
  }
}

export function validateDefaultHarness(harness: TaskHarness) {
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
