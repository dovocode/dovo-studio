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

/** Shared runtime preferences; task copies stay stable when these defaults change. */
export class RuntimeDefaults {
  constructor(private db: Database.Database) {}
  get() {
    const row = decode(
      Schema.UndefinedOr(mutableStruct({ value: Schema.String })),
      this.db.prepare('SELECT value FROM documents WHERE id = ?').get('runtime-defaults'),
    )
    return decode(runtimeDefaultsSchema, row ? JSON.parse(row.value) : {})
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
