import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import type Database from 'better-sqlite3'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileTypeFromBuffer } from 'file-type'
import { Schema } from 'effect'
import {
  attachmentSchema,
  attachmentUploadSchema,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  type Attachment,
} from '@dovo/protocol'
import type { WorkspaceStore } from './workspace.js'
import type { Activity } from './activity.js'
import { HttpError } from '../errors.js'
const rowSchema = mutableStruct({
  task: Schema.String,
  metadata: Schema.String,
  data: Schema.instanceOf(Buffer),
})
export class Attachments {
  private root: string
  constructor(
    private db: Database.Database,
    private store: WorkspaceStore,
    private activity: Activity,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS attachments (id TEXT PRIMARY KEY, task TEXT NOT NULL, metadata TEXT NOT NULL, data BLOB NOT NULL)',
    )
    this.root =
      db.name === ':memory:'
        ? mkdtempSync(join(tmpdir(), 'dovo-attachments-'))
        : join(dirname(resolve(db.name)), 'attachments')
  }
  read(taskId: string, id: string) {
    const value = this.db.prepare('SELECT task,metadata,data FROM attachments WHERE id=?').get(id)
    if (!value) throw new HttpError(404, 'Attachment not found')
    const row = decode(rowSchema, value)
    if (row.task !== taskId) throw new HttpError(400, 'Attachment belongs to another task')
    return {
      attachment: decode(attachmentSchema, JSON.parse(row.metadata)),
      data: row.data.toString('base64'),
    }
  }
  metadata(taskId: string, ids: string[]): Attachment[] {
    return ids.map((id) => this.read(taskId, id).attachment)
  }
  async upload(value: unknown) {
    const input = decode(attachmentUploadSchema, value)
    const task = this.store.task(input.taskId)
    if (task.archived) throw new HttpError(409, 'Restore the task before attaching files')
    const data = Buffer.from(input.data, 'base64')
    if (data.toString('base64') !== input.data) throw new HttpError(400, 'Invalid file data')
    if (['.', '..'].includes(input.name) || input.name.split('').some((c) => c.charCodeAt(0) < 32))
      throw new HttpError(400, 'Invalid file name')
    if (data.length > MAX_ATTACHMENT_BYTES)
      throw new HttpError(413, 'Files must be 4 MB or smaller')
    const existing = this.db.prepare('SELECT id FROM attachments WHERE id=?').get(input.id)
    if (existing) {
      const previous = this.read(input.taskId, input.id)
      if (
        previous.data !== input.data ||
        previous.attachment.name !== basename(input.name).replaceAll('\\', '_')
      )
        throw new HttpError(409, 'Upload ID already has different contents')
      return {
        attachment: previous.attachment,
        revision: this.store.version(),
      }
    }
    const detected = await fileTypeFromBuffer(data).catch((error) => {
      if (error instanceof Error && error.name === 'EndOfStreamError') return undefined
      throw error
    })
    const attachment = decode(attachmentSchema, {
      id: input.id,
      name: basename(input.name).replaceAll('\\', '_'),
      mime: detected?.mime ?? 'application/octet-stream',
      size: data.length,
    })
    this.db.transaction(() => {
      if (this.db.prepare('SELECT id FROM attachments WHERE id=?').get(input.id)) {
        const previous = this.read(input.taskId, input.id)
        if (previous.data !== input.data || previous.attachment.name !== attachment.name)
          throw new HttpError(409, 'Upload ID already has different contents')
        return
      }
      if ((this.store.task(input.taskId).draftAttachments?.length ?? 0) >= MAX_ATTACHMENTS)
        throw new HttpError(409, 'Attach up to 5 files per message')
      this.db
        .prepare('INSERT INTO attachments VALUES(?,?,?,?)')
        .run(input.id, input.taskId, JSON.stringify(attachment), data)
      this.store.updateTask(input.taskId, (t) => ({
        ...t,
        draftAttachments: [...(t.draftAttachments ?? []), attachment],
      }))
      this.activity.add('attachment', input.taskId, `Attached ${attachment.name}`, attachment)
    })()
    return {
      attachment,
      revision: this.store.version(),
    }
  }
  removeDraft(taskId: string, id: string) {
    this.store.updateTask(taskId, (t) => ({
      ...t,
      draftAttachments: t.draftAttachments?.filter((f) => f.id !== id),
    }))
    this.activity.add('attachment', taskId, 'Removed draft attachment', {
      id,
    })
  }
  async materialize(taskId: string, file: Attachment) {
    const { attachment, data } = this.read(taskId, file.id)
    const directory = join(this.root, attachment.id)
    await mkdir(directory, {
      recursive: true,
      mode: 0o700,
    })
    const path = join(directory, attachment.name)
    await writeFile(path, Buffer.from(data, 'base64'), {
      mode: 0o600,
    })
    return {
      ...attachment,
      path,
      data,
    }
  }
  async dispose() {
    if (this.db.name === ':memory:')
      await rm(this.root, {
        recursive: true,
        force: true,
      })
  }
}
