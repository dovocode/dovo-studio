import type Database from 'better-sqlite3'
import { z } from 'zod'
import { commandsSchema, type CommandSettings } from '@dovo/protocol'
export class Commands {
  private settings: CommandSettings
  constructor(private db: Database.Database) {
    const row = z
      .object({ value: z.string() })
      .optional()
      .parse(db.prepare('SELECT value FROM documents WHERE id = ?').get('commands'))
    this.settings = commandsSchema.parse(row ? JSON.parse(row.value) : {})
  }
  get() {
    return this.settings
  }
  save(value: unknown) {
    const settings = commandsSchema.parse(value)
    this.db
      .prepare(
        'INSERT INTO documents VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run('commands', JSON.stringify(settings))
    this.settings = settings
    return settings
  }
}
