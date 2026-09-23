import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import { commandsSchema, type CommandSettings } from '@dovo/protocol'
export class Commands {
  private settings: CommandSettings
  constructor(private db: Database.Database) {
    const row = decode(
      Schema.UndefinedOr(
        mutableStruct({
          value: Schema.String,
        }),
      ),
      db.prepare('SELECT value FROM documents WHERE id = ?').get('commands'),
    )
    this.settings = decode(commandsSchema, row ? JSON.parse(row.value) : {})
  }
  get() {
    return this.settings
  }
  save(value: unknown) {
    const settings = decode(commandsSchema, value)
    this.db
      .prepare(
        'INSERT INTO documents VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run('commands', JSON.stringify(settings))
    this.settings = settings
    return settings
  }
}
