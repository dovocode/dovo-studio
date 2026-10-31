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
  attachmentUploadResultSchema,
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
import { createHash, randomUUID } from 'node:crypto'
const rowSchema = mutableStruct({
  task: Schema.String,
  metadata: Schema.String,
  data: Schema.instanceOf(Buffer),
})
const metadataRowSchema = mutableStruct({
  task: Schema.String,
  metadata: Schema.String,
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
    db.exec(
      'CREATE TABLE IF NOT EXISTS abandoned_attachment_uploads (id TEXT PRIMARY KEY, device TEXT NOT NULL, fingerprint TEXT NOT NULL)',
    )
    db.exec(
      'CREATE TABLE IF NOT EXISTS attachment_upload_receipts (id TEXT PRIMARY KEY, device TEXT NOT NULL, fingerprint TEXT NOT NULL, result TEXT NOT NULL, acknowledged INTEGER NOT NULL DEFAULT 0, recovered INTEGER NOT NULL DEFAULT 0, task TEXT, queued_message TEXT)',
    )
    const receiptColumns = db.prepare('PRAGMA table_info(attachment_upload_receipts)').all()
    if (
      !receiptColumns.some(
        (column) => decode(mutableStruct({ name: Schema.String }), column).name === 'recovered',
      )
    )
      db.exec(
        'ALTER TABLE attachment_upload_receipts ADD COLUMN recovered INTEGER NOT NULL DEFAULT 0',
      )
    const names = receiptColumns.map(
      (column) => decode(mutableStruct({ name: Schema.String }), column).name,
    )
    if (!names.includes('task'))
      db.exec('ALTER TABLE attachment_upload_receipts ADD COLUMN task TEXT')
    if (!names.includes('queued_message'))
      db.exec('ALTER TABLE attachment_upload_receipts ADD COLUMN queued_message TEXT')
    if (!names.includes('replace_id'))
      db.exec('ALTER TABLE attachment_upload_receipts ADD COLUMN replace_id TEXT')
    if (!names.includes('commit_guard'))
      db.exec('ALTER TABLE attachment_upload_receipts ADD COLUMN commit_guard TEXT')
    if (!names.includes('handled'))
      db.exec(
        'ALTER TABLE attachment_upload_receipts ADD COLUMN handled INTEGER NOT NULL DEFAULT 0',
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
    const query = this.db.prepare('SELECT task,metadata FROM attachments WHERE id=?')
    return ids.map((id) => {
      const value = query.get(id)
      if (!value) throw new HttpError(404, 'Attachment not found')
      const row = decode(metadataRowSchema, value)
      if (row.task !== taskId) throw new HttpError(400, 'Attachment belongs to another task')
      return decode(attachmentSchema, JSON.parse(row.metadata))
    })
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
    if (
      this.db.prepare('SELECT 1 FROM cancelled_attachment_uploads WHERE id=?').get(id) ||
      this.db.prepare('SELECT 1 FROM abandoned_attachment_uploads WHERE id=?').get(id)
    )
      throw new HttpError(409, 'This attachment upload was cancelled. Choose the file again.')
  }
  abandonUpload(device: string, value: unknown, replacement = false) {
    const decoded = decode(replacement ? attachmentReplaceSchema : attachmentUploadSchema, value)
    const { replaceId, ...input } =
      'replaceId' in decoded ? decoded : { ...decoded, replaceId: undefined }
    const fingerprint = createHash('sha256')
      .update(JSON.stringify({ input, replaceId: replaceId ?? null }))
      .digest('hex')
    this.store.transaction(() => {
      for (const table of ['attachment_upload_receipts', 'abandoned_attachment_uploads']) {
        const row = this.db
          .prepare(`SELECT device,fingerprint FROM ${table} WHERE id=?`)
          .get(input.id)
        if (row) {
          const existing = decode(
            mutableStruct({ device: Schema.String, fingerprint: Schema.String }),
            row,
          )
          if (existing.device !== device || existing.fingerprint !== fingerprint)
            throw new HttpError(409, 'Upload ID already belongs to another request')
        }
      }
      this.db
        .prepare('INSERT OR IGNORE INTO abandoned_attachment_uploads VALUES(?,?,?)')
        .run(input.id, device, fingerprint)
      this.db
        .prepare('UPDATE attachment_upload_receipts SET acknowledged=1 WHERE id=?')
        .run(input.id)
    })
  }
  uploadReceipt(device: string, id: string) {
    const row = this.db
      .prepare('SELECT device,result FROM attachment_upload_receipts WHERE id=?')
      .get(id)
    if (!row) return null
    const receipt = decode(mutableStruct({ device: Schema.String, result: Schema.String }), row)
    if (receipt.device !== device) throw new HttpError(403, 'Upload belongs to another device')
    return decode(attachmentUploadResultSchema, JSON.parse(receipt.result))
  }
  acknowledgeUpload(device: string, id: string) {
    const receipt = this.uploadReceipt(device, id)
    if (!receipt) throw new HttpError(409, 'Upload outcome is not yet known')
    const row = decode(
      mutableStruct({ acknowledged: Schema.Number }),
      this.db.prepare('SELECT acknowledged FROM attachment_upload_receipts WHERE id=?').get(id),
    )
    if (row.acknowledged) return
    if (!this.uploadHandled(device, id))
      throw new HttpError(409, 'Upload has not been committed to its destination')
    this.db.prepare('UPDATE attachment_upload_receipts SET acknowledged=1 WHERE id=?').run(id)
  }
  uploadAvailable(device: string, id: string) {
    if (!this.uploadReceipt(device, id)) return false
    return !!this.db.prepare('SELECT 1 FROM attachments WHERE id=?').get(id)
  }
  uploadHandled(device: string, id: string) {
    if (!this.uploadAvailable(device, id)) return false
    const row = decode(
      mutableStruct({
        task: Schema.NullOr(Schema.String),
        queued_message: Schema.NullOr(Schema.String),
        recovered: Schema.Number,
        handled: Schema.Number,
      }),
      this.db
        .prepare(
          'SELECT task,queued_message,recovered,handled FROM attachment_upload_receipts WHERE id=?',
        )
        .get(id),
    )
    if (!row.task) return false
    if (this.store.questionAttachmentIds(row.task).includes(id)) return true
    let summary: ReturnType<WorkspaceStore['taskSummary']>
    try {
      summary = this.store.taskSummary(row.task)
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return false
      throw error
    }
    if (row.recovered) {
      if (summary.draftAttachments?.some((file) => file.id === id)) return true
      if (summary.queue?.some((message) => message.attachments?.some((file) => file.id === id)))
        return true
    } else if (row.queued_message) {
      const queued = summary.queue?.find((message) => message.id === row.queued_message)
      if (queued) return !!queued.attachments?.some((file) => file.id === id)
    } else if (summary.draftAttachments?.some((file) => file.id === id)) return true
    return this.store
      .task(row.task)
      .messages.some(
        (message) =>
          (row.recovered || !row.queued_message || message.id === row.queued_message) &&
          message.attachments?.some((file) => file.id === id),
      )
  }
  confirmUploadHandled(device: string, id: string) {
    return this.store.transaction(() => {
      if (!this.uploadHandled(device, id)) return false
      this.db.prepare('UPDATE attachment_upload_receipts SET handled=1 WHERE id=?').run(id)
      return true
    })
  }
  recoverUploadToDraft(device: string, id: string) {
    return this.store.transaction(() => {
      const result = this.uploadReceipt(device, id)
      if (!result) throw new HttpError(404, 'Upload receipt not found')
      const row = decode(
        mutableStruct({ recovered: Schema.Number }),
        this.db.prepare('SELECT recovered FROM attachment_upload_receipts WHERE id=?').get(id),
      )
      const owner = this.db.prepare('SELECT task FROM attachments WHERE id=?').get(id)
      if (!owner) throw new HttpError(404, 'Attachment not found')
      const attachmentRow = decode(mutableStruct({ task: Schema.String }), owner)
      const task = this.store.taskSummary(attachmentRow.task)
      if (row.recovered) {
        if (!this.uploadHandled(device, id))
          throw new HttpError(409, 'The recovered attachment is no longer in its destination')
        return result
      }
      if (task.archivedAt) throw new HttpError(409, 'Restore the task before attaching files')
      if (!task.draftAttachments?.some((file) => file.id === id)) {
        if ((task.draftAttachments?.length ?? 0) >= MAX_ATTACHMENTS)
          throw new HttpError(409, 'Attach up to 5 files per message')
        this.store.updateTask(attachmentRow.task, (current) => ({
          ...current,
          draftAttachments: [...(current.draftAttachments ?? []), result.attachment],
        }))
        this.activity.add(
          'attachment',
          attachmentRow.task,
          `Attached ${result.attachment.name}`,
          result.attachment,
        )
      }
      this.db.prepare('UPDATE attachment_upload_receipts SET recovered=1 WHERE id=?').run(id)
      return result
    })
  }
  draftUploadGuard(taskId: string) {
    const task = this.store.taskSummary(taskId)
    if (task.archivedAt) throw new HttpError(409, 'Restore the task before attaching files')
    return createHash('sha256')
      .update(
        JSON.stringify([
          task.draft,
          (task.draftAttachments ?? []).map((file) => file.id),
          task.history.messages,
          (task.queue ?? []).map((message) => message.id),
        ]),
      )
      .digest('hex')
  }
  commitUploadToDraft(device: string, id: string, guard: string) {
    return this.store.transaction(() => {
      const result = this.uploadReceipt(device, id)
      if (!result) throw new HttpError(404, 'Upload receipt not found')
      this.assertUploadActive(id)
      const row = decode(
        mutableStruct({
          task: Schema.NullOr(Schema.String),
          queued_message: Schema.NullOr(Schema.String),
          replace_id: Schema.NullOr(Schema.String),
          commit_guard: Schema.NullOr(Schema.String),
          recovered: Schema.Number,
        }),
        this.db
          .prepare(
            'SELECT task,queued_message,replace_id,commit_guard,recovered FROM attachment_upload_receipts WHERE id=?',
          )
          .get(id),
      )
      if (!row.task || row.queued_message)
        throw new HttpError(409, 'Upload belongs to another destination')
      if (!this.uploadAvailable(device, id)) throw new HttpError(410, 'Attachment not found')
      if (
        !this.db
          .prepare('SELECT 1 FROM queued_attachment_uploads WHERE id=? AND task=?')
          .get(id, row.task)
      )
        throw new HttpError(409, 'Upload is not awaiting a draft destination')
      if (row.recovered) {
        if (!this.uploadHandled(device, id))
          throw new HttpError(409, 'The attachment is no longer in its destination')
        if (!row.commit_guard) throw new HttpError(409, 'The attachment was recovered separately')
        return { ...result, nextGuard: row.commit_guard }
      }
      if (this.draftUploadGuard(row.task) !== guard)
        throw new HttpError(409, 'The draft changed. Review the saved attachment.')
      const task = this.store.taskSummary(row.task)
      const files = task.draftAttachments ?? []
      if (row.replace_id && !files.some((file) => file.id === row.replace_id))
        throw new HttpError(409, 'The original attachment is no longer in the draft')
      if (!row.replace_id && files.length >= MAX_ATTACHMENTS)
        throw new HttpError(409, 'Attach up to 5 files per message')
      this.store.updateTask(row.task, (current) => ({
        ...current,
        draftAttachments: row.replace_id
          ? (current.draftAttachments ?? []).map((file) =>
              file.id === row.replace_id ? result.attachment : file,
            )
          : [...(current.draftAttachments ?? []), result.attachment],
      }))
      this.activity.add(
        'attachment',
        row.task,
        `Attached ${result.attachment.name}`,
        result.attachment,
      )
      const nextGuard = this.draftUploadGuard(row.task)
      this.db
        .prepare('UPDATE attachment_upload_receipts SET recovered=1,commit_guard=? WHERE id=?')
        .run(nextGuard, id)
      return { ...result, revision: this.store.version(), nextGuard }
    })
  }
  async uploadRecoverable(device: string, value: unknown, replacement = false) {
    if (replacement) {
      const { replaceId, ...input } = decode(attachmentReplaceSchema, value)
      if (replaceId === input.id) throw new HttpError(400, 'Edited images need a new attachment ID')
      return this.upload(input, replaceId, device)
    }
    return this.upload(value, undefined, device)
  }
  async upload(value: unknown, replaceId?: string, device?: string) {
    const input = decode(attachmentUploadSchema, value)
    const fingerprint = device
      ? createHash('sha256')
          .update(JSON.stringify({ input, replaceId: replaceId ?? null }))
          .digest('hex')
      : undefined
    const previousReceipt = () => {
      if (!device) return null
      if (this.db.prepare('SELECT 1 FROM abandoned_attachment_uploads WHERE id=?').get(input.id))
        throw new HttpError(409, 'This attachment upload was discarded')
      const row = this.db
        .prepare('SELECT device,fingerprint,result FROM attachment_upload_receipts WHERE id=?')
        .get(input.id)
      if (!row) return null
      const receipt = decode(
        mutableStruct({ device: Schema.String, fingerprint: Schema.String, result: Schema.String }),
        row,
      )
      if (receipt.device !== device || receipt.fingerprint !== fingerprint)
        throw new HttpError(409, 'Upload ID already belongs to another request')
      if (!this.db.prepare('SELECT 1 FROM attachments WHERE id=?').get(input.id))
        throw new HttpError(410, 'The committed attachment is no longer available')
      return decode(attachmentUploadResultSchema, JSON.parse(receipt.result))
    }
    const completed = previousReceipt()
    if (completed) return completed
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
      if (device) throw new HttpError(409, 'Upload ID already belongs to an earlier upload')
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
    return this.store.transaction(() => {
      const completed = previousReceipt()
      if (completed) return completed
      this.assertUploadActive(input.id)
      const current = this.store.taskSummary(input.taskId)
      if (current.archivedAt) throw new HttpError(409, 'Restore the task before attaching files')
      if (this.db.prepare('SELECT id FROM attachments WHERE id=?').get(input.id)) {
        if (device) throw new HttpError(409, 'Upload ID already belongs to an earlier upload')
        const previous = this.read(input.taskId, input.id)
        if (previous.data !== input.data || previous.attachment.name !== attachment.name)
          throw new HttpError(409, 'Upload ID already has different contents')
        return { attachment: previous.attachment, revision: this.store.version() }
      }
      if (
        input.queuedMessageId &&
        !current.queue?.some((message) => message.id === input.queuedMessageId)
      )
        throw new HttpError(409, 'This message already started or was removed')
      if (replaceId) {
        const original =
          input.queuedMessageId || input.detached
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
        !input.detached &&
        !replaceId &&
        (current.draftAttachments?.length ?? 0) >= MAX_ATTACHMENTS
      )
        throw new HttpError(409, 'Attach up to 5 files per message')
      this.db
        .prepare('INSERT INTO attachments VALUES(?,?,?,?)')
        .run(input.id, input.taskId, JSON.stringify(attachment), data)
      if (input.queuedMessageId || input.detached) {
        this.db
          .prepare('INSERT INTO queued_attachment_uploads VALUES(?,?,?)')
          .run(input.id, input.taskId, Date.now())
      } else {
        this.store.updateTask(input.taskId, (t) => ({
          ...t,
          draftAttachments: replaceId
            ? (t.draftAttachments ?? []).map((file) => (file.id === replaceId ? attachment : file))
            : [...(t.draftAttachments ?? []), attachment],
        }))
        this.activity.add('attachment', input.taskId, `Attached ${attachment.name}`, attachment)
      }
      const result = { attachment, revision: this.store.version() }
      if (device && fingerprint)
        this.db
          .prepare(
            'INSERT INTO attachment_upload_receipts (id,device,fingerprint,result,task,queued_message,replace_id) VALUES (?,?,?,?,?,?,?)',
          )
          .run(
            input.id,
            device,
            fingerprint,
            JSON.stringify(result),
            input.taskId,
            input.queuedMessageId ?? null,
            replaceId ?? null,
          )
      return result
    })
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
    // An unacknowledged receipt keeps an uncertain outcome recoverable. Once its device is
    // revoked or its task is durably deleted, no request can recover it, so it stops pinning the
    // bytes. A task missing only from the hydrated workspace is not a deletion. The receipt itself
    // remains, keeping its ID bound to the original request.
    this.db
      .prepare(
        `UPDATE attachment_upload_receipts SET acknowledged=1 WHERE acknowledged=0 AND (
          device IN (SELECT id FROM devices WHERE revoked_at IS NOT NULL) OR
          EXISTS (
            SELECT 1 FROM attachments
            WHERE attachments.id=attachment_upload_receipts.id
            AND EXISTS (SELECT 1 FROM documents WHERE documents.id='workspace-deleted:tasks:'||attachments.task)
            AND NOT EXISTS (SELECT 1 FROM workspace_tasks WHERE task_id=attachments.task)
          )
        )`,
      )
      .run()
    const retained = new Set([
      ...this.store
        .get()
        .tasks.flatMap((task) => [
          ...(task.draftAttachments ?? []),
          ...(task.queue ?? []).flatMap((message) => message.attachments ?? []),
        ])
        .map((file) => file.id),
      ...this.store.messageAttachmentIds(),
      ...this.store.questionAttachmentIds(),
      ...this.db
        .prepare('SELECT id FROM attachment_upload_receipts WHERE acknowledged=0')
        .all()
        .map((row) => decode(mutableStruct({ id: Schema.String }), row).id),
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
