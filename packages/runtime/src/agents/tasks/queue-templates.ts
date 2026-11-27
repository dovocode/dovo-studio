import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import { decode, mutableStruct, queueTemplateSchema, type QueueTemplate } from '@dovo/protocol'
import { HttpError } from '../../errors.js'

const rowSchema = mutableStruct({ definition: Schema.String })

export class QueueTemplates {
  constructor(private readonly db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS queue_templates(
      project_id TEXT NOT NULL, id TEXT NOT NULL, fingerprint TEXT NOT NULL, definition TEXT NOT NULL,
      PRIMARY KEY(project_id, id));`)
  }

  list(project: string): QueueTemplate[] {
    return this.db
      .prepare('SELECT definition FROM queue_templates WHERE project_id=? ORDER BY rowid')
      .all(project)
      .map((row) => this.readRow(row))
  }

  get(project: string, id: string) {
    const row = this.db
      .prepare('SELECT definition FROM queue_templates WHERE project_id=? AND id=?')
      .get(project, id)
    if (!row)
      throw new HttpError(
        404,
        'This queue template was removed. Reopen queue templates to refresh.',
      )
    return this.readRow(row)
  }

  save(project: string, id: string, name: string, fingerprint: string, readSteps: () => string[]) {
    this.db
      .transaction(() => {
        const prior = this.db
          .prepare('SELECT fingerprint,definition FROM queue_templates WHERE project_id=? AND id=?')
          .get(project, id)
        if (prior) {
          const receipt = decode(
            mutableStruct({ fingerprint: Schema.String, definition: Schema.String }),
            prior,
          )
          if (receipt.fingerprint !== fingerprint || this.readRow(receipt).name !== name)
            throw new HttpError(409, 'This queue template ID belongs to another template.')
          return
        }
        const all = this.list(project)
        if (all.length >= 20)
          throw new HttpError(409, 'A project can keep up to 20 queue templates.')
        if (all.some((item) => item.name.toLowerCase() === name.toLowerCase()))
          throw new HttpError(409, 'Choose a different name for the queue template.')
        const template = decode(queueTemplateSchema, { id, name, steps: readSteps() })
        this.db
          .prepare('INSERT INTO queue_templates VALUES(?,?,?,?)')
          .run(project, id, fingerprint, JSON.stringify(template))
      })
      .immediate()
  }

  delete(project: string, id: string) {
    this.db.prepare('DELETE FROM queue_templates WHERE project_id=? AND id=?').run(project, id)
  }

  private readRow(row: unknown) {
    return decode(queueTemplateSchema, JSON.parse(decode(rowSchema, row).definition))
  }
}
