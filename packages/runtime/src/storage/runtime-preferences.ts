import type Database from 'better-sqlite3'
import { decode, mutableStruct, runtimePreferencesSchema } from '@dovo/protocol'
import { Schema } from 'effect'
export class RuntimePreferences {
  constructor(private db: Database.Database) {}
  get() {
    const row = decode(
      Schema.UndefinedOr(mutableStruct({ value: Schema.String })),
      this.db.prepare('SELECT value FROM documents WHERE id = ?').get('runtime-preferences'),
    )
    return decode(runtimePreferencesSchema, row ? JSON.parse(row.value) : {})
  }
  /** Partial saves merge into the current preferences, so a client that knows only some fields
   * (for example an older phone) never resets the others to their defaults. */
  save(value: unknown) {
    const changes = value && typeof value === 'object' ? value : {}
    const settings = decode(runtimePreferencesSchema, { ...this.get(), ...changes })
    this.db
      .prepare(
        'INSERT INTO documents VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run('runtime-preferences', JSON.stringify(settings))
    return settings
  }
}
