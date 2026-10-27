import { mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import type Database from 'better-sqlite3'
import { mkdir, writeFile, rm, readdir } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { dirname, join, resolve, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { fileTypeFromBuffer } from 'file-type'
import { Schema } from 'effect'
import {
  attachmentSchema,
  attachmentUploadSchema,
  attachmentReplaceSchema,
  isImageAttachment,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  type Attachment,
} from '@dovo/protocol'
import type { WorkspaceStore } from './workspace.js'
import type { Activity } from './activity.js'
import { HttpError } from '../errors.js'
import { randomUUID } from 'node:crypto'
const rowSchema = mutableStruct({
  task: Schema.String,
  metadata: Schema.String,
  data: Schema.instanceOf(Buffer),
})
const PENDING_UPLOAD_LIFETIME = 24 * 60 * 60 * 1000
/** Reduces an uploaded name to the file name that is stored and later written to disk.
 * Validation runs on that normalized value, so `a/..` cannot pass as a raw name and then
 * materialize as a directory reference. */
export function attachmentFileName(raw: string) {
  const name = basename(raw).replaceAll('\\', '_')
  const control = name.split('').some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  if (!name || ['.', '..'].includes(name) || control) throw new HttpError(400, 'Invalid file name')
  return name
}
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
    db.exec(
      'CREATE TABLE IF NOT EXISTS queued_attachment_uploads (id TEXT PRIMARY KEY, task TEXT NOT NULL, created_at INTEGER NOT NULL)',
    )
    db.exec(
      'CREATE TABLE IF NOT EXISTS cancelled_attachment_uploads (id TEXT PRIMARY KEY, task TEXT NOT NULL, created_at INTEGER NOT NULL)',
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
  /** A fork owns independent attachment records, including inherited conversation files. */
  copy(sourceId: string, taskId: string, ids: string[]): Attachment[] {
    return ids.map((id) => {
      const source = this.read(sourceId, id)
      const attachment = { ...source.attachment, id: randomUUID() }
      this.db
        .prepare('INSERT INTO attachments VALUES(?,?,?,?)')
        .run(attachment.id, taskId, JSON.stringify(attachment), Buffer.from(source.data, 'base64'))
      return attachment
    })
  }
  replace(value: unknown) {
    const { replaceId, ...input } = decode(attachmentReplaceSchema, value)
    if (replaceId === input.id) throw new HttpError(400, 'Edited images need a new attachment ID')
    return this.upload(input, replaceId)
  }
  private assertUploadActive(id: string) {
    if (this.db.prepare('SELECT 1 FROM cancelled_attachment_uploads WHERE id=?').get(id))
      throw new HttpError(409, 'This attachment upload was cancelled. Choose the file again.')
  }
  async upload(value: unknown, replaceId?: string) {
    const input = decode(attachmentUploadSchema, value)
    const task = this.store.taskSummary(input.taskId)
    if (
      input.queuedMessageId &&
      !task.queue?.some((message) => message.id === input.queuedMessageId)
    )
      throw new HttpError(409, 'This message already started or was removed')
    if (task.archivedAt) throw new HttpError(409, 'Restore the task before attaching files')
    this.assertUploadActive(input.id)
    const data = Buffer.from(input.data, 'base64')
    if (data.toString('base64') !== input.data) throw new HttpError(400, 'Invalid file data')
    const name = attachmentFileName(input.name)
    if (data.length > MAX_ATTACHMENT_BYTES)
      throw new HttpError(413, 'Files must be 5 MB or smaller')
    const existing = this.db.prepare('SELECT id FROM attachments WHERE id=?').get(input.id)
    if (existing) {
      const previous = this.read(input.taskId, input.id)
      if (previous.data !== input.data || previous.attachment.name !== name)
        throw new HttpError(409, 'Upload ID already has different contents')
      if (
        replaceId &&
        !input.queuedMessageId &&
        (task.draftAttachments?.some((file) => file.id === replaceId) ||
          !task.draftAttachments?.some((file) => file.id === input.id))
      )
        throw new HttpError(409, 'The draft attachment has changed. Reopen the image to edit it.')
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
      name,
      mime: detected?.mime ?? 'application/octet-stream',
      size: data.length,
    })
    this.store.transaction(() => {
      this.assertUploadActive(input.id)
      const current = this.store.taskSummary(input.taskId)
      if (current.archivedAt) throw new HttpError(409, 'Restore the task before attaching files')
      if (this.db.prepare('SELECT id FROM attachments WHERE id=?').get(input.id)) {
        const previous = this.read(input.taskId, input.id)
        if (previous.data !== input.data || previous.attachment.name !== attachment.name)
          throw new HttpError(409, 'Upload ID already has different contents')
        return
      }
      if (
        input.queuedMessageId &&
        !current.queue?.some((message) => message.id === input.queuedMessageId)
      )
        throw new HttpError(409, 'This message already started or was removed')
      if (replaceId) {
        const original = input.queuedMessageId
          ? this.read(input.taskId, replaceId).attachment
          : current.draftAttachments?.find((file) => file.id === replaceId)
        if (!original)
          throw new HttpError(
            409,
            'The image is no longer in the composer. Reopen it before editing.',
          )
        if (!isImageAttachment(original) || !isImageAttachment(attachment))
          throw new HttpError(400, 'Only image attachments can be edited')
      }
      if (
        !input.queuedMessageId &&
        !replaceId &&
        (current.draftAttachments?.length ?? 0) >= MAX_ATTACHMENTS
      )
        throw new HttpError(409, 'Attach up to 5 files per message')
      this.db
        .prepare('INSERT INTO attachments VALUES(?,?,?,?)')
        .run(input.id, input.taskId, JSON.stringify(attachment), data)
      if (input.queuedMessageId) {
        this.db
          .prepare('INSERT INTO queued_attachment_uploads VALUES(?,?,?)')
          .run(input.id, input.taskId, Date.now())
        return
      }
      this.store.updateTask(input.taskId, (t) => ({
        ...t,
        draftAttachments: replaceId
          ? (t.draftAttachments ?? []).map((file) => (file.id === replaceId ? attachment : file))
          : [...(t.draftAttachments ?? []), attachment],
      }))
      this.activity.add('attachment', input.taskId, `Attached ${attachment.name}`, attachment)
    })
    return {
      attachment,
      revision: this.store.version(),
    }
  }
  removeDraft(taskId: string, id: string) {
    this.store.transaction(() => {
      this.store.taskSummary(taskId)
      const owner = this.db.prepare('SELECT task FROM attachments WHERE id=?').get(id)
      const cancelled = this.db
        .prepare('SELECT task FROM cancelled_attachment_uploads WHERE id=?')
        .get(id)
      for (const row of [owner, cancelled])
        if (row && decode(mutableStruct({ task: Schema.String }), row).task !== taskId)
          throw new HttpError(400, 'Attachment belongs to another task')
      // IDs are immutable. Record removal before an in-flight upload can commit so a
      // lost response or cancellation during MIME detection cannot reattach the file.
      this.db
        .prepare(
          'INSERT INTO cancelled_attachment_uploads VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET created_at=excluded.created_at',
        )
        .run(id, taskId, Date.now())
      this.store.updateTask(taskId, (t) => ({
        ...t,
        draftAttachments: t.draftAttachments?.filter((f) => f.id !== id),
      }))
      this.activity.add('attachment', taskId, 'Removed draft attachment', { id })
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
  /** Reference-aware collection also repairs disk leftovers from interrupted task deletion. */
  async prune() {
    const retained = new Set([
      ...this.store
        .get()
        .tasks.flatMap((task) => [
          ...(task.draftAttachments ?? []),
          ...(task.queue ?? []).flatMap((message) => message.attachments ?? []),
        ])
        .map((file) => file.id),
      ...this.store.messageAttachmentIds(),
    ])
    // Edits keep uploads separate from the ordinary draft. Unreferenced uploads can be collected after a day.
    const taskIds = new Set(this.store.get().tasks.map((task) => task.id))
    const pendingUploads = this.db
      .prepare('SELECT id, task, created_at FROM queued_attachment_uploads')
      .all()
    const removePending = this.db.prepare('DELETE FROM queued_attachment_uploads WHERE id=?')
    for (const row of pendingUploads) {
      const upload = decode(
        mutableStruct({ id: Schema.String, task: Schema.String, created_at: Schema.Number }),
        row,
      )
      if (taskIds.has(upload.task) && upload.created_at > Date.now() - PENDING_UPLOAD_LIFETIME)
        retained.add(upload.id)
      else removePending.run(upload.id)
    }
    const cancellations = this.db
      .prepare('SELECT id, task, created_at FROM cancelled_attachment_uploads')
      .all()
    const removeCancellation = this.db.prepare(
      'DELETE FROM cancelled_attachment_uploads WHERE id=?',
    )
    for (const row of cancellations) {
      const cancelled = decode(
        mutableStruct({ id: Schema.String, task: Schema.String, created_at: Schema.Number }),
        row,
      )
      if (
        !taskIds.has(cancelled.task) ||
        cancelled.created_at <= Date.now() - PENDING_UPLOAD_LIFETIME
      )
        removeCancellation.run(cancelled.id)
    }
    const rows = this.db
      .prepare('SELECT id FROM attachments')
      .all()
      .map((row) => decode(mutableStruct({ id: Schema.String }), row).id)
    const remove = this.db.prepare('DELETE FROM attachments WHERE id=?')
    this.db.transaction(() => {
      for (const id of rows) if (!retained.has(id)) remove.run(id)
    })()
    let entries: string[]
    try {
      entries = await readdir(this.root)
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
      throw error
    }
    for (const id of entries) {
      // Check again after asynchronous directory I/O; a new upload may have just committed.
      if (!this.db.prepare('SELECT 1 FROM attachments WHERE id=?').get(id))
        await rm(join(this.root, id), { recursive: true, force: true })
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
