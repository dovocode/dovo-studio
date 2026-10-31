import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../index'
import { attachmentFileName, Attachments } from './attachments'
import { WorkspaceStore } from './workspace'
import { openDatabase } from './database'
import { Activity } from './activity'
import { HttpError } from '../errors'
import { fixture } from '../testing/fixture'
import { claudeInput } from '../agents/providers/claude/claude-input'
import type { AgentRun } from '../agents/execution/types'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const token = 'attachment-test-owner-token-with-32-characters'
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII='

it('commits recoverable uploads and bound receipts together, including concurrent replay', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  const { db, store, attachments } = runtime.services
  store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Recoverable upload',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const input = { taskId: task.id, id: randomUUID(), name: 'image.png', data: png }
  expect(() => attachments.acknowledgeUpload('device', input.id)).toThrow(
    'outcome is not yet known',
  )
  db.exec(
    "CREATE TRIGGER fail_upload_receipt BEFORE INSERT ON attachment_upload_receipts BEGIN SELECT RAISE(ABORT,'receipt failure'); END",
  )
  await expect(attachments.uploadRecoverable('device', input)).rejects.toThrow('receipt failure')
  expect(store.task(task.id).draftAttachments ?? []).toEqual([])
  expect(db.prepare('SELECT id FROM attachments WHERE id=?').get(input.id)).toBeUndefined()
  db.exec('DROP TRIGGER fail_upload_receipt')
  const [first, concurrent] = await Promise.all([
    attachments.uploadRecoverable('device', input),
    attachments.uploadRecoverable('device', input),
  ])
  expect(concurrent).toEqual(first)
  expect(store.task(task.id).draftAttachments).toEqual([first.attachment])
  const reopened = new Attachments(db, store, runtime.services.activity)
  cleanups.push(() => reopened.dispose())
  expect(reopened.uploadReceipt('device', input.id)).toEqual(first)
  await expect(
    reopened.uploadRecoverable('device', { ...input, name: 'other.png' }),
  ).rejects.toThrow('another request')
  await expect(reopened.uploadRecoverable('other-device', input)).rejects.toThrow('another request')
  await expect(
    reopened.uploadRecoverable('device', { ...input, queuedMessageId: 'another-edit' }),
  ).rejects.toThrow('another request')
  await expect(
    reopened.uploadRecoverable('device', { ...input, taskId: 'other-task' }),
  ).rejects.toThrow('another request')
  await expect(
    reopened.uploadRecoverable('device', {
      ...input,
      data: Buffer.from('different').toString('base64'),
    }),
  ).rejects.toThrow('another request')
  await expect(
    reopened.uploadRecoverable('device', { ...input, replaceId: randomUUID() }, true),
  ).rejects.toThrow('another request')
  expect(() => reopened.uploadReceipt('other-device', input.id)).toThrow('another device')
})

it('binds a replacement receipt to its original attachment and preserves both on conflicts', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  const { attachments, store } = runtime.services
  store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Replacement receipt',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const original = await attachments.upload({
    taskId: task.id,
    id: randomUUID(),
    name: 'before.png',
    data: png,
  })
  const other = await attachments.upload({
    taskId: task.id,
    id: randomUUID(),
    name: 'other.png',
    data: png,
  })
  const input = {
    taskId: task.id,
    id: randomUUID(),
    replaceId: original.attachment.id,
    name: 'after.png',
    data: png,
  }
  const result = await attachments.uploadRecoverable('device', input, true)
  await expect(
    attachments.uploadRecoverable('device', { ...input, replaceId: other.attachment.id }, true),
  ).rejects.toThrow('another request')
  expect(store.task(task.id).draftAttachments).toEqual([result.attachment, other.attachment])
  expect(attachments.read(task.id, original.attachment.id).data).toBe(png)
  expect(attachments.read(task.id, other.attachment.id).data).toBe(png)
})

it('guards detached draft commits and preserves replacement ownership across restart', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const databasePath = join(f.directory, '.git', 'runtime.sqlite')
  let runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  runtime.services.store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Guarded draft',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const { attachments, store } = runtime.services
  const original = await attachments.upload({
    taskId: task.id,
    id: randomUUID(),
    name: 'before.png',
    data: png,
  })
  const guard = attachments.draftUploadGuard(task.id)
  const input = {
    taskId: task.id,
    id: randomUUID(),
    name: 'after.png',
    data: png,
    detached: true,
    replaceId: original.attachment.id,
  }
  const result = await attachments.uploadRecoverable('device', input, true)
  expect(store.task(task.id).draftAttachments).toEqual([original.attachment])
  store.updateTask(task.id, (current) => ({ ...current, draft: 'remote change' }))
  expect(() => attachments.commitUploadToDraft('device', input.id, guard)).toThrow('draft changed')
  expect(attachments.uploadHandled('device', input.id)).toBe(false)
  const beforeRemoval = attachments.draftUploadGuard(task.id)
  store.updateTask(task.id, (current) => ({ ...current, draftAttachments: [] }))
  expect(() => attachments.commitUploadToDraft('device', input.id, beforeRemoval)).toThrow(
    'draft changed',
  )
  expect(() =>
    attachments.commitUploadToDraft('device', input.id, attachments.draftUploadGuard(task.id)),
  ).toThrow('original attachment')
  expect(store.task(task.id).draftAttachments).toEqual([])
  store.updateTask(task.id, (current) => ({ ...current, draftAttachments: [original.attachment] }))
  const beforeMessage = attachments.draftUploadGuard(task.id)
  store.updateTaskHistory(task.id, (current) => ({
    ...current,
    messages: [...current.messages, { id: 'sent', role: 'user', text: 'sent' }],
  }))
  expect(() => attachments.commitUploadToDraft('device', input.id, beforeMessage)).toThrow(
    'draft changed',
  )
  const beforeQueue = attachments.draftUploadGuard(task.id)
  store.updateTask(task.id, (current) => ({
    ...current,
    queue: [{ id: 'queued', role: 'user', text: 'next', createdAt: '' }],
  }))
  expect(() => attachments.commitUploadToDraft('device', input.id, beforeQueue)).toThrow(
    'draft changed',
  )
  const nextGuard = attachments.draftUploadGuard(task.id)
  await runtime.close()
  runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  expect(() =>
    runtime.services.attachments.commitUploadToDraft('other-device', input.id, nextGuard),
  ).toThrow('another device')
  const committed = runtime.services.attachments.commitUploadToDraft('device', input.id, nextGuard)
  expect(committed.attachment).toEqual(result.attachment)
  expect(runtime.services.store.task(task.id).draftAttachments).toEqual([result.attachment])
  expect(runtime.services.attachments.uploadHandled('device', input.id)).toBe(true)
  await runtime.close()
  runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  runtime.services.store.updateTask(task.id, (current) => ({ ...current, draft: 'changed again' }))
  const replay = runtime.services.attachments.commitUploadToDraft('device', input.id, nextGuard)
  expect(replay.attachment).toEqual(result.attachment)
  expect(replay.nextGuard).toBe(committed.nextGuard)
  expect(replay.nextGuard).not.toBe(runtime.services.attachments.draftUploadGuard(task.id))
})

it('allows a guarded upload while existing assistant history streams', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  const { attachments, store } = runtime.services
  store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Streaming upload',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  store.updateTaskHistory(task.id, (current) => ({
    ...current,
    messages: [{ id: 'stream', role: 'assistant', text: 'Start' }],
  }))
  const guard = attachments.draftUploadGuard(task.id)
  const input = { taskId: task.id, id: randomUUID(), name: 'image.png', data: png, detached: true }
  const upload = await attachments.uploadRecoverable('device', input)
  store.updateTaskHistory(task.id, (current) => ({
    ...current,
    historyRevision: (current.historyRevision ?? 0) + 1,
    messages: current.messages.map((message) => ({ ...message, text: 'Start streaming' })),
  }))
  expect(attachments.draftUploadGuard(task.id)).toBe(guard)
  expect(attachments.commitUploadToDraft('device', input.id, guard).attachment).toEqual(
    upload.attachment,
  )
  expect(store.task(task.id).draftAttachments).toEqual([upload.attachment])
})

it('retains an unacknowledged upload and its receipt through restart and collection', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const databasePath = join(f.directory, '.git', 'runtime.sqlite')
  let runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  runtime.services.store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Recovery',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const input = { taskId: task.id, id: randomUUID(), name: 'image.png', data: png }
  const result = await runtime.services.attachments.uploadRecoverable('device', input)
  runtime.services.store.updateTask(task.id, (current) => ({ ...current, draftAttachments: [] }))
  await runtime.close()
  runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  expect(runtime.services.attachments.uploadReceipt('device', input.id)).toEqual(result)
  await runtime.services.attachments.prune()
  expect(runtime.services.attachments.read(task.id, input.id).data).toBe(png)
  expect(await runtime.services.attachments.uploadRecoverable('device', input)).toEqual(result)
  expect(runtime.services.store.task(task.id).draftAttachments).toEqual([])
  runtime.services.attachments.recoverUploadToDraft('device', input.id)
  runtime.services.attachments.acknowledgeUpload('device', input.id)
  runtime.services.store.updateTask(task.id, (current) => ({ ...current, draftAttachments: [] }))
  await runtime.services.attachments.prune()
  expect(() => runtime.services.attachments.read(task.id, input.id)).toThrow('not found')
  expect(runtime.services.attachments.uploadReceipt('device', input.id)).toEqual(result)
  expect(runtime.services.attachments.uploadAvailable('device', input.id)).toBe(false)
  expect(() => runtime.services.attachments.acknowledgeUpload('device', input.id)).not.toThrow()
  await expect(runtime.services.attachments.uploadRecoverable('device', input)).rejects.toThrow(
    'no longer available',
  )
  expect(() => runtime.services.attachments.recoverUploadToDraft('device', input.id)).toThrow(
    'Attachment not found',
  )
})

it('exposes recoverable upload receipts over authenticated HTTP across restart', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const databasePath = join(f.directory, '.git', 'runtime.sqlite')
  let runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  runtime.services.store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'HTTP receipt',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const input = { taskId: task.id, id: randomUUID(), name: 'image.png', data: png }
  const request = (path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const response = await request('/api/attachments/recoverable-upload', input)
  expect(response.status).toBe(200)
  const result = await response.json()
  expect(JSON.stringify(runtime.services.activity.list('', '', 0))).not.toContain(png)
  await runtime.close()
  runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  const receipt = await request('/api/attachments/upload-receipt', { id: input.id })
  expect(receipt.status).toBe(200)
  expect(await receipt.json()).toEqual({ receipt: result, available: true })
  const replay = await request('/api/attachments/recoverable-upload', input)
  expect(await replay.json()).toEqual(result)
  const conflict = await request('/api/attachments/recoverable-upload', {
    ...input,
    name: 'different.png',
  })
  expect(conflict.status).toBe(409)
  expect(JSON.stringify(runtime.services.activity.list('', '', 0))).not.toContain(png)
  const ack = await request('/api/attachments/acknowledge-upload', { id: input.id })
  expect(ack.status).toBe(200)
})
it('keeps a detached upload out of a changed draft until explicit recovery', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const databasePath = join(f.directory, '.git', 'runtime.sqlite')
  let runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  runtime.services.store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Detached',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const input = { taskId: task.id, id: randomUUID(), name: 'image.png', data: png, detached: true }
  const pending = runtime.services.attachments.uploadRecoverable('device', input)
  runtime.services.store.updateTask(task.id, (current) => ({ ...current, draft: 'new draft' }))
  const result = await pending
  expect(runtime.services.store.task(task.id).draftAttachments ?? []).toEqual([])
  await runtime.close()
  runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  expect(runtime.services.attachments.uploadHandled('device', input.id)).toBe(false)
  expect(runtime.services.attachments.recoverUploadToDraft('device', input.id)).toEqual(result)
  expect(runtime.services.store.task(task.id).draft).toBe('new draft')
  expect(runtime.services.store.task(task.id).draftAttachments).toEqual([result.attachment])
})

it('commits detached uploads over HTTP only against the captured draft', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  runtime.services.store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'HTTP guarded upload',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const request = (path: string, body: unknown) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  const guardResponse = await request('/api/attachments/draft-guard', { taskId: task.id })
  expect(guardResponse.status).toBe(200)
  const { guard } = (await guardResponse.json()) as { guard: string }
  const input = { taskId: task.id, id: randomUUID(), name: 'image.png', data: png, detached: true }
  const upload = await request('/api/attachments/recoverable-upload', input)
  expect(upload.status).toBe(200)
  const result = await upload.json()
  expect(runtime.services.store.task(task.id).draftAttachments ?? []).toEqual([])
  const commit = await request('/api/attachments/commit-upload', { id: input.id, guard })
  expect(commit.status).toBe(200)
  const firstCommit = (await commit.json()) as {
    attachment: typeof result.attachment
    nextGuard: string
  }
  expect(firstCommit.attachment).toEqual(result.attachment)
  expect(runtime.services.store.task(task.id).draftAttachments).toEqual([result.attachment])
  const second = { ...input, id: randomUUID(), name: 'second.png' }
  const secondUpload = await request('/api/attachments/recoverable-upload', second)
  const secondResult = await secondUpload.json()
  const secondCommit = await request('/api/attachments/commit-upload', {
    id: second.id,
    guard: firstCommit.nextGuard,
  })
  expect(secondCommit.status).toBe(200)
  const secondReceipt = (await secondCommit.json()) as { nextGuard: string }
  expect(runtime.services.store.task(task.id).draftAttachments).toEqual([
    result.attachment,
    secondResult.attachment,
  ])
  const replay = await request('/api/attachments/commit-upload', { id: input.id, guard })
  expect((await replay.json()).nextGuard).toBe(firstCommit.nextGuard)
  runtime.services.store.updateTask(task.id, (current) => ({ ...current, draft: 'new draft' }))
  const third = { ...input, id: randomUUID(), name: 'third.png' }
  await request('/api/attachments/recoverable-upload', third)
  const staleCommit = await request('/api/attachments/commit-upload', {
    id: third.id,
    guard: secondReceipt.nextGuard,
  })
  expect(staleCommit.status).toBe(409)
  expect(runtime.services.store.task(task.id).draftAttachments).toEqual([
    result.attachment,
    secondResult.attachment,
  ])
  expect((await request('/api/attachments/upload-handled', { id: input.id })).status).toBe(200)
  expect((await request('/api/attachments/acknowledge-upload', { id: input.id })).status).toBe(200)
})

it('durably fences an explicitly abandoned upload before and after restart', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const databasePath = join(f.directory, '.git', 'runtime.sqlite')
  let runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  runtime.services.store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Abandon',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const input = { taskId: task.id, id: randomUUID(), name: 'image.png', data: png }
  const pending = runtime.services.attachments.uploadRecoverable('device', input)
  runtime.services.attachments.abandonUpload('device', input)
  await expect(pending).rejects.toThrow('discarded')
  runtime.services.attachments.abandonUpload('device', input)
  expect(() => runtime.services.attachments.abandonUpload('other-device', input)).toThrow(
    'another request',
  )
  await runtime.close()
  runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  await runtime.services.attachments.prune()
  await expect(runtime.services.attachments.uploadRecoverable('device', input)).rejects.toThrow(
    'discarded',
  )
  expect(runtime.services.attachments.uploadReceipt('device', input.id)).toBeNull()
})

it('applies an explicitly recovered upload only once, even after removal and restart', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const databasePath = join(f.directory, '.git', 'runtime.sqlite')
  let runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  runtime.services.store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Review recovery',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const input = { taskId: task.id, id: randomUUID(), name: 'image.png', data: png }
  const result = await runtime.services.attachments.uploadRecoverable('device', input)
  runtime.services.store.updateTask(task.id, (current) => ({ ...current, draftAttachments: [] }))
  expect(runtime.services.attachments.recoverUploadToDraft('device', input.id)).toEqual(result)
  expect(runtime.services.store.task(task.id).draftAttachments).toEqual([result.attachment])
  runtime.services.attachments.removeDraft(task.id, input.id)
  await runtime.close()
  runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  expect(() => runtime.services.attachments.recoverUploadToDraft('device', input.id)).toThrow(
    'no longer in its destination',
  )
  expect(runtime.services.store.task(task.id).draftAttachments).toEqual([])
})

it('retains a queued edit upload until its exact queued message commits the attachment', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const databasePath = join(f.directory, '.git', 'runtime.sqlite')
  let runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  runtime.services.store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Queued edit',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  runtime.services.store.updateTask(task.id, (current) => ({ ...current, queuePaused: true }))
  await runtime.services.tasks.send(task.id, 'queued-message', 'Original message')
  const input = {
    taskId: task.id,
    queuedMessageId: 'queued-message',
    id: randomUUID(),
    name: 'image.png',
    data: png,
  }
  const result = await runtime.services.attachments.uploadRecoverable('device', input)
  expect(runtime.services.attachments.uploadHandled('device', input.id)).toBe(false)
  expect(() => runtime.services.attachments.acknowledgeUpload('device', input.id)).toThrow(
    'not been committed',
  )
  runtime.services.db
    .prepare('UPDATE queued_attachment_uploads SET created_at=0 WHERE id=?')
    .run(input.id)
  await runtime.close()
  runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  await runtime.services.attachments.prune()
  expect(runtime.services.attachments.read(task.id, input.id).data).toBe(png)
  expect(runtime.services.attachments.uploadHandled('device', input.id)).toBe(false)
  runtime.services.store.updateTask(task.id, (current) => ({
    ...current,
    queue: current.queue?.map((message) =>
      message.id === input.queuedMessageId
        ? { ...message, attachments: [result.attachment] }
        : message,
    ),
  }))
  expect(runtime.services.attachments.confirmUploadHandled('device', input.id)).toBe(true)
  runtime.services.store.updateTask(task.id, (current) => ({ ...current, queue: [] }))
  await runtime.close()
  runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  expect(runtime.services.attachments.uploadHandled('device', input.id)).toBe(false)
  expect(() => runtime.services.attachments.acknowledgeUpload('device', input.id)).toThrow(
    'not been committed',
  )
})

it('retires an unacknowledged receipt once its task is deleted, keeping the ID bound', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const databasePath = join(f.directory, '.git', 'runtime.sqlite')
  let runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  runtime.services.store.update(() => f.workspace)
  const create = (title: string) =>
    runtime.services.tasks.create({ title, repositoryId: 'repo', agentId: 'agent', objective: '' })
  const task = create('Deleted')
  const live = create('Live')
  const input = { taskId: task.id, id: randomUUID(), name: 'image.png', data: png }
  const result = await runtime.services.attachments.uploadRecoverable('device', input)
  // A lost response on a live task stays recoverable.
  const lost = { taskId: live.id, id: randomUUID(), name: 'lost.png', data: png }
  const lostResult = await runtime.services.attachments.uploadRecoverable('device', lost)
  runtime.services.store.updateTask(live.id, (current) => ({ ...current, draftAttachments: [] }))
  expect(runtime.services.attachments.uploadHandled('device', input.id)).toBe(true)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.filter((item) => item.id !== task.id),
  }))
  expect(runtime.services.attachments.uploadHandled('device', input.id)).toBe(false)
  expect(() => runtime.services.attachments.acknowledgeUpload('device', input.id)).toThrow(
    'not been committed',
  )
  // Collection after restart relies only on the durable deletion marker.
  await runtime.close()
  runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  await runtime.services.attachments.prune()
  expect(runtime.services.attachments.uploadReceipt('device', input.id)).toEqual(result)
  expect(runtime.services.attachments.uploadAvailable('device', input.id)).toBe(false)
  await expect(runtime.services.attachments.uploadRecoverable('device', input)).rejects.toThrow(
    'no longer available',
  )
  await expect(
    runtime.services.attachments.uploadRecoverable('other-device', input),
  ).rejects.toThrow('another request')
  expect(runtime.services.attachments.read(live.id, lost.id).data).toBe(png)
  expect(runtime.services.attachments.uploadReceipt('device', lost.id)).toEqual(lostResult)
  expect(runtime.services.attachments.recoverUploadToDraft('device', lost.id)).toEqual(lostResult)
  expect(runtime.services.store.task(live.id).draftAttachments).toEqual([lostResult.attachment])
})

it('keeps an unacknowledged receipt whose task is missing only from the hydrated workspace', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  const { db, store, activity } = runtime.services
  store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Unreadable',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const input = { taskId: task.id, id: randomUUID(), name: 'image.png', data: png }
  const result = await runtime.services.attachments.uploadRecoverable('device', input)
  // Another workspace view without this task, as when its stored document cannot hydrate.
  const hydrated = new WorkspaceStore(db)
  vi.spyOn(hydrated, 'get').mockReturnValue({
    ...store.get(),
    tasks: store.get().tasks.filter((item) => item.id !== task.id),
  })
  const collector = new Attachments(db, hydrated, activity)
  cleanups.push(() => collector.dispose())
  await collector.prune()
  expect(runtime.services.attachments.uploadReceipt('device', input.id)).toEqual(result)
  expect(runtime.services.attachments.read(task.id, input.id).data).toBe(png)
})

it('retires receipts of revoked devices without removing live references', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  const { attachments, devices, store } = runtime.services
  store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Revoked',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const revoked = devices.add('Revoked phone', 'revoked-device-token-with-at-least-32-chars')
  const paired = devices.add('Paired phone', 'paired-device-token-with-at-least-32-chars')
  const upload = (name: string, device: string) =>
    attachments.uploadRecoverable(device, { taskId: task.id, id: randomUUID(), name, data: png })
  const orphan = await upload('orphan.png', revoked)
  const drafted = await upload('drafted.png', revoked)
  const pending = await upload('pending.png', paired)
  const owner = await upload('owner.png', 'owner')
  store.updateTask(task.id, (current) => ({
    ...current,
    draftAttachments: [drafted.attachment],
  }))
  devices.revoke(revoked)
  await attachments.prune()
  expect(() => attachments.read(task.id, orphan.attachment.id)).toThrow('not found')
  expect(attachments.uploadReceipt(revoked, orphan.attachment.id)).toEqual(orphan)
  expect(attachments.read(task.id, drafted.attachment.id).data).toBe(png)
  expect(store.task(task.id).draftAttachments).toEqual([drafted.attachment])
  for (const [device, result] of [
    [paired, pending],
    ['owner', owner],
  ] as const) {
    expect(attachments.uploadAvailable(device, result.attachment.id)).toBe(true)
    expect(attachments.recoverUploadToDraft(device, result.attachment.id)).toEqual(result)
  }
})

it('does not treat recovered or confirmed markers as a destination after task deletion', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const databasePath = join(f.directory, '.git', 'runtime.sqlite')
  let runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  runtime.services.store.update(() => f.workspace)
  const task = runtime.services.tasks.create({
    title: 'Deleted recovered destination',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const input = { taskId: task.id, id: randomUUID(), name: 'image.png', data: png }
  const result = await runtime.services.attachments.uploadRecoverable('device', input)
  runtime.services.store.updateTask(task.id, (current) => ({ ...current, draftAttachments: [] }))
  expect(runtime.services.attachments.recoverUploadToDraft('device', input.id)).toEqual(result)
  expect(runtime.services.attachments.confirmUploadHandled('device', input.id)).toBe(true)
  runtime.services.store.update((workspace) => ({
    ...workspace,
    tasks: workspace.tasks.filter((item) => item.id !== task.id),
  }))
  await runtime.close()
  runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  expect(runtime.services.attachments.uploadHandled('device', input.id)).toBe(false)
  expect(runtime.services.attachments.confirmUploadHandled('device', input.id)).toBe(false)
  expect(() => runtime.services.attachments.recoverUploadToDraft('device', input.id)).toThrow(
    'Task not found',
  )
  expect(() => runtime.services.attachments.acknowledgeUpload('device', input.id)).toThrow(
    'not been committed',
  )
  await runtime.services.attachments.prune()
  expect(runtime.services.attachments.uploadReceipt('device', input.id)).toEqual(result)
  expect(runtime.services.attachments.uploadAvailable('device', input.id)).toBe(false)
})

it.each(['before', 'during', 'after'] as const)(
  'cancels an upload %s commit without removing other draft files or allowing a late retry',
  async (stage) => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const r = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    cleanups.push(r.close)
    const s = r.services
    s.store.update(() => f.workspace)
    const task = s.tasks.create({
      title: 'Files',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: '',
    })
    const retained = await s.attachments.upload({
      taskId: task.id,
      id: randomUUID(),
      name: 'keep.txt',
      data: Buffer.from('Keep this draft attachment').toString('base64'),
    })
    const input = { taskId: task.id, id: randomUUID(), name: 'context.png', data: png }
    let pending: Promise<unknown>
    if (stage === 'before') {
      s.attachments.removeDraft(task.id, input.id)
      pending = s.attachments.upload(input)
    } else if (stage === 'during') {
      // Upload awaits MIME detection before its transaction. Cancel in that window.
      pending = s.attachments.upload(input)
      s.attachments.removeDraft(task.id, input.id)
    } else {
      await s.attachments.upload(input)
      s.attachments.removeDraft(task.id, input.id)
      pending = Promise.resolve()
    }
    const [result] = await Promise.allSettled([pending])
    const conflict = expect.objectContaining({ status: 409 })
    expect(result).toEqual(
      stage === 'after'
        ? { status: 'fulfilled', value: undefined }
        : { status: 'rejected', reason: conflict },
    )
    expect(s.store.task(task.id).draftAttachments).toEqual([retained.attachment])
    const reopened = new Attachments(s.db, s.store, s.activity)
    cleanups.push(() => reopened.dispose())
    await expect(reopened.upload(input)).rejects.toMatchObject({ status: 409 })
    expect(s.store.task(task.id).draftAttachments).toEqual([retained.attachment])
  },
)

it('rejects cross-task cancellation and expires cancelled uploads with pending attachment lifetimes', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const r = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(r.close)
  const s = r.services
  s.store.update(() => f.workspace)
  const create = (title: string) =>
    s.tasks.create({ title, repositoryId: 'repo', agentId: 'agent', objective: '' })
  const task = create('Original'),
    other = create('Other')
  const upload = await s.attachments.upload({
    taskId: task.id,
    id: randomUUID(),
    name: 'keep.txt',
    data: Buffer.from('Keep').toString('base64'),
  })
  const response = await fetch(`http://127.0.0.1:${r.port}/api/attachments/remove`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId: other.id, id: upload.attachment.id }),
  })
  expect(response.status).toBe(400)
  expect(s.store.task(task.id).draftAttachments).toEqual([upload.attachment])
  const cancelled = randomUUID(),
    expired = randomUUID(),
    deleted = randomUUID()
  for (const id of [cancelled, expired, deleted]) s.attachments.removeDraft(task.id, id)
  expect(() => s.attachments.removeDraft(other.id, cancelled)).toThrow('another task')
  s.db
    .prepare('UPDATE cancelled_attachment_uploads SET created_at=? WHERE id=?')
    .run(Date.now() - 24 * 60 * 60 * 1000 - 1, expired)
  s.db
    .prepare('UPDATE cancelled_attachment_uploads SET task=? WHERE id=?')
    .run('deleted-task', deleted)
  await s.attachments.prune()
  expect(s.db.prepare('SELECT id FROM cancelled_attachment_uploads').all()).toEqual([
    { id: cancelled },
  ])
})
it('accepts a 5 MB file over HTTP and rejects one byte over without storing it', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const r = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(r.close)
  r.services.store.update(() => f.workspace)
  const task = r.services.tasks.create({
    title: 'Size boundary',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const upload = (bytes: number) =>
    fetch(`http://127.0.0.1:${r.port}/api/attachments/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskId: task.id,
        id: randomUUID(),
        name: 'notes.txt',
        data: Buffer.alloc(bytes, 'x').toString('base64'),
      }),
    })
  const accepted = await upload(5 * 1024 * 1024)
  expect(accepted.status).toBe(200)
  expect(r.services.store.task(task.id).draftAttachments?.[0]?.size).toBe(5 * 1024 * 1024)
  const rejected = await upload(5 * 1024 * 1024 + 1)
  expect(rejected.status).toBe(413)
  expect(await rejected.text()).toContain('5 MB')
  expect(r.services.store.task(task.id).draftAttachments).toHaveLength(1)
})
it('validates uploads, deduplicates concurrent retries, isolates tasks and logs metadata without file bodies', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const r = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(r.close)
  const s = r.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Files',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const input = { taskId: task.id, id: randomUUID(), name: '../picture.png', data: png }
  const [a, b] = await Promise.all([s.attachments.upload(input), s.attachments.upload(input)])
  expect(a).toEqual(b)
  expect(a.attachment).toMatchObject({ name: 'picture.png', mime: 'image/png' })
  expect(s.store.task(task.id).draftAttachments).toHaveLength(1)
  expect(() => s.attachments.read('another-task', a.attachment.id)).toThrow('another task')
  await expect(
    s.attachments.upload({ ...input, data: Buffer.from('different').toString('base64') }),
  ).rejects.toThrow('different contents')
  await expect(
    s.attachments.upload({ ...input, id: randomUUID(), data: 'invalid!' }),
  ).rejects.toThrow('Invalid file data')
  const response = await fetch(`http://127.0.0.1:${r.port}/api/attachments/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...input,
      id: randomUUID(),
      name: 'notes.txt',
      data: Buffer.from('retained-private-file-body').toString('base64'),
    }),
  })
  expect(response.status).toBe(200)
  const history = JSON.stringify(s.activity.list('', '', 0))
  expect(history).not.toContain('retained-private-file-body')
  expect(history).not.toContain(png)
  expect(JSON.stringify(s.store.get())).not.toContain(png)
  s.attachments.removeDraft(task.id, a.attachment.id)
  await s.attachments.prune()
  expect(() => s.attachments.read(task.id, a.attachment.id)).toThrow('not found')
})
it('keeps queued attachments through restart, supplies content and paths to agents, and resumes without re-sending consumed files', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const databasePath = join(f.directory, '.git', 'runtime.sqlite')
  let r = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  r.services.store.update(() => f.workspace)
  const task = r.services.tasks.create({
    title: 'Files',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  r.services.store.updateTask(task.id, (t) => ({ ...t, queuePaused: true }))
  const file = (
    await r.services.attachments.upload({
      taskId: task.id,
      id: randomUUID(),
      name: 'context.txt',
      data: Buffer.from('Attachment fixture context').toString('base64'),
    })
  ).attachment
  await r.services.tasks.send(task.id, 'message-1', '', [file.id])
  await r.services.tasks.send(task.id, 'message-1', '', [file.id])
  expect(r.services.store.task(task.id).queue).toHaveLength(1)
  expect(r.services.store.task(task.id).draftAttachments).toEqual([])
  await r.close()
  r = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  cleanups.push(r.close)
  const runs: AgentRun[] = []
  vi.spyOn(r.services.agents, 'get').mockResolvedValue({
    probe: async () => ({ provider: 'codex', available: true, detail: '' }),
    run: async (run) => {
      runs.push(run)
      run.onSession('session')
      run.onText('Read attachment')
    },
  })
  await (
    await r.services.tasks.start(task.id)
  ).done
  expect(runs[0].prompt).toContain('Attachment fixture context')
  const supplied = runs[0].attachments?.[0]
  if (!supplied) throw new Error('Attachment missing from agent input')
  expect(await readFile(supplied.path, 'utf8')).toBe('Attachment fixture context')
  expect(
    r.services.store.task(task.id).messages.some((m) => m.attachments?.[0].id === file.id),
  ).toBe(true)
  await (
    await r.services.tasks.start(task.id)
  ).done
  expect(runs[1].attachments).toEqual([])
  expect(runs[1].sessionId).toBe('session')
  await r.services.git.command(f.directory, ['switch', '-c', 'external-switch'])
  await (
    await r.services.tasks.start(task.id)
  ).done
  expect(runs[2].sessionId).toBeUndefined()
  expect(runs[2].attachments).toHaveLength(1)
  const image = (
    await r.services.attachments.upload({
      taskId: task.id,
      id: randomUUID(),
      name: 'picture.png',
      data: png,
    })
  ).attachment
  const prepared = await r.services.attachments.materialize(task.id, image)
  const input = await claudeInput({ ...runs[0], attachments: [prepared] }).next()
  expect(input.value).toMatchObject({
    type: 'user',
    message: {
      content: [
        { type: 'text' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
      ],
    },
  })
  await rm(prepared.path)
  expect(await readFile((await r.services.attachments.materialize(task.id, image)).path)).toEqual(
    Buffer.from(png, 'base64'),
  )
})
it('validates the normalized file name so paths cannot become directory references', async () => {
  expect(attachmentFileName('../picture.png')).toBe('picture.png')
  expect(attachmentFileName('nested/dir/')).toBe('dir')
  for (const name of ['a/..', 'a/.', '/', '', '.', '..', 'a/b\u0001c', 'x\u007f'])
    expect(() => attachmentFileName(name)).toThrow('Invalid file name')
  const f = await fixture()
  cleanups.push(f.cleanup)
  const r = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(r.close)
  const s = r.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Files',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  await expect(
    s.attachments.upload({ taskId: task.id, id: randomUUID(), name: 'a/..', data: png }),
  ).rejects.toThrow('Invalid file name')
  expect(s.store.task(task.id).draftAttachments ?? []).toEqual([])
  expect(s.db.prepare('SELECT COUNT(*) AS total FROM attachments').get()).toEqual({ total: 0 })
})

it.each(['archivedAt', 'during-upload'] as const)(
  'rejects attachment admission for %s threads without storing a blob',
  async (state) => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const r = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    cleanups.push(r.close)
    const s = r.services
    s.store.update(() => f.workspace)
    const task = s.tasks.create({
      title: 'Files',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: '',
    })
    const archive = () =>
      s.store.updateTask(task.id, (current) => ({
        ...current,
        archived: state !== 'archivedAt',
        archivedAt: new Date().toISOString(),
      }))
    if (state !== 'during-upload') archive()
    const pending = s.attachments.upload({
      taskId: task.id,
      id: randomUUID(),
      name: 'file.png',
      data: png,
    })
    if (state === 'during-upload') archive()
    await expect(pending).rejects.toThrow('Restore the task')
    expect(s.store.task(task.id).draftAttachments).toBeUndefined()
    expect(s.db.prepare('SELECT COUNT(*) AS total FROM attachments').get()).toEqual({ total: 0 })
  },
)

it('restores the live workspace and history when an attachment transaction fails after its workspace update', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const r = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(r.close)
  const s = r.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'Files',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const before = s.store.get()
  const projected = s.store.publicWorkspace()
  const revision = s.store.version()
  const history = s.db.prepare('SELECT * FROM conversation_items').all()
  const document = s.db.prepare('SELECT value FROM documents WHERE id=?').get('workspace')
  s.db.exec(
    "CREATE TRIGGER fail_attachment_audit BEFORE INSERT ON activity WHEN NEW.kind='attachment' BEGIN SELECT RAISE(ABORT, 'fixture attachment audit failure'); END",
  )
  await expect(
    s.attachments.upload({ taskId: task.id, id: randomUUID(), name: 'file.png', data: png }),
  ).rejects.toThrow('fixture attachment audit failure')
  expect(s.store.get()).toBe(before)
  expect(s.store.publicWorkspace()).toBe(projected)
  expect(s.store.version()).toBe(revision)
  expect(s.db.prepare('SELECT * FROM conversation_items').all()).toEqual(history)
  expect(s.db.prepare('SELECT value FROM documents WHERE id=?').get('workspace')).toEqual(document)
  expect(s.db.prepare('SELECT COUNT(*) AS total FROM attachments').get()).toEqual({ total: 0 })
  expect(new WorkspaceStore(s.db).get()).toEqual(before)
  s.db.exec('DROP TRIGGER fail_attachment_audit')
  const accepted = await s.attachments.upload({
    taskId: task.id,
    id: randomUUID(),
    name: 'file.png',
    data: png,
  })
  expect(s.store.task(task.id).draftAttachments).toEqual([accepted.attachment])
  expect(s.attachments.read(task.id, accepted.attachment.id).data).toBe(png)
})
it('prunes materialized orphan files but keeps attachments referenced by conversation history', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  const s = runtime.services
  s.store.update(() => f.workspace)
  const task = s.tasks.create({
    title: 'GC',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const upload = async (name: string) =>
    (
      await s.attachments.upload({
        taskId: task.id,
        id: randomUUID(),
        name,
        data: Buffer.from(name).toString('base64'),
      })
    ).attachment
  const retained = await upload('retained.txt'),
    orphan = await upload('orphan.txt')
  const retainedDisk = await s.attachments.materialize(task.id, retained),
    orphanDisk = await s.attachments.materialize(task.id, orphan)
  s.store.updateTaskHistory(task.id, (current) => ({
    ...current,
    draftAttachments: [],
    messages: [{ id: 'history', role: 'user', text: 'Keep file', attachments: [retained] }],
  }))
  await s.attachments.prune()
  expect(await readFile(retainedDisk.path, 'utf8')).toBe('retained.txt')
  expect(s.attachments.read(task.id, retained.id).attachment).toEqual(retained)
  await expect(readFile(orphanDisk.path)).rejects.toThrow('ENOENT')
  expect(() => s.attachments.read(task.id, orphan.id)).toThrow('not found')
})

it.each([false, true])(
  'allows draft attachments without reopening a settled thread (automatic=%s)',
  async (automatic) => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
    cleanups.push(runtime.close)
    const s = runtime.services
    s.store.update(() => f.workspace)
    const task = s.tasks.create({
      title: 'Settled',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: '',
    })
    s.store.updateTask(task.id, (current) => ({
      ...current,
      status: 'review',
      archived: true,
      autoSettled: automatic || undefined,
    }))
    const upload = await s.attachments.upload({
      taskId: task.id,
      id: randomUUID(),
      name: 'note.txt',
      data: Buffer.from('Draft context').toString('base64'),
    })
    expect(s.store.task(task.id)).toMatchObject({
      archived: true,
      draftAttachments: [upload.attachment],
    })
    expect(s.store.task(task.id).autoSettled).toBe(automatic || undefined)
    s.attachments.removeDraft(task.id, upload.attachment.id)
    expect(s.store.task(task.id).archived).toBe(true)
  },
)

it('atomically replaces only a current draft image, including at the attachment limit, and keeps original bytes immutable', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const r = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(r.close)
  r.services.store.update(() => f.workspace)
  const task = r.services.tasks.create({
    title: 'Edit image',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const uploaded = []
  for (let n = 0; n < 5; n++)
    uploaded.push(
      (
        await r.services.attachments.upload({
          taskId: task.id,
          id: randomUUID(),
          name: `image-${n}.png`,
          data: png,
        })
      ).attachment,
    )
  const original = uploaded[2]
  const input = {
    taskId: task.id,
    id: randomUUID(),
    replaceId: original.id,
    name: 'edited.png',
    data: png,
  }
  const response = await fetch(`http://127.0.0.1:${r.port}/api/attachments/replace`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  expect(response.status).toBe(200)
  const files = r.services.store.task(task.id).draftAttachments!
  expect(files).toHaveLength(5)
  expect(files[2]).toMatchObject({ id: input.id, name: 'edited.png' })
  expect(files.filter((file) => file.id !== input.id)).toEqual(
    uploaded.filter((file) => file.id !== original.id),
  )
  expect(r.services.attachments.read(task.id, original.id).data).toBe(png)
  await expect(r.services.attachments.replace(input)).resolves.toMatchObject({
    attachment: { id: input.id },
  })
  await expect(r.services.attachments.replace({ ...input, id: randomUUID() })).rejects.toThrow(
    'no longer in the composer',
  )
  await expect(
    r.services.attachments.replace({
      ...input,
      id: randomUUID(),
      replaceId: files[2].id,
      data: 'invalid!',
    }),
  ).rejects.toThrow('Invalid file data')
  expect(r.services.store.task(task.id).draftAttachments).toEqual(files)
  expect(JSON.stringify(r.services.activity.list('', '', 0))).not.toContain(png)
})

it('reads only validated attachment metadata in requested order without loading or encoding file bodies', async () => {
  const statements: string[] = []
  const db = openDatabase(':memory:')
  const attachments = new Attachments(db, new WorkspaceStore(db), new Activity(db))
  try {
    const first = { id: randomUUID(), name: 'first.txt', mime: 'text/plain', size: 5 * 1024 * 1024 }
    const second = { ...first, id: randomUUID(), name: 'second.txt' }
    const insert = db.prepare('INSERT INTO attachments VALUES(?,?,?,?)')
    const data = Buffer.alloc(first.size, 65)
    insert.run(first.id, 'task', JSON.stringify(first), data)
    insert.run(second.id, 'task', JSON.stringify(second), data)
    const prepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((sql) => {
      statements.push(sql)
      return prepare(sql)
    })
    const read = vi.spyOn(attachments, 'read')
    const encode = vi.spyOn(Buffer.prototype, 'toString')
    expect(attachments.metadata('task', [second.id, first.id, second.id])).toEqual([
      second,
      first,
      second,
    ])
    expect(attachments.metadata('task', [])).toEqual([])
    expect(read).not.toHaveBeenCalled()
    expect(encode.mock.calls.some(([encoding]) => encoding === 'base64')).toBe(false)
    expect(
      statements.every((sql) => sql === 'SELECT task,metadata FROM attachments WHERE id=?'),
    ).toBe(true)
    expect(() => attachments.metadata('other-task', [first.id])).toThrow(
      'Attachment belongs to another task',
    )
    expect(() => attachments.metadata('task', ['missing'])).toThrow(
      new HttpError(404, 'Attachment not found'),
    )
    expect(() => attachments.metadata('other-task', [first.id])).toThrow(
      new HttpError(400, 'Attachment belongs to another task'),
    )
    expect(() => attachments.metadata('other-task', ['missing', first.id])).toThrow(
      'Attachment not found',
    )
    expect(() => attachments.metadata('other-task', [first.id, 'missing'])).toThrow(
      'Attachment belongs to another task',
    )
    db.prepare('UPDATE attachments SET metadata=? WHERE id=?').run('{"id":12}', first.id)
    expect(() => attachments.metadata('task', [first.id])).toThrow(/id/)
    db.prepare('UPDATE attachments SET metadata=? WHERE id=?').run('{', first.id)
    expect(() => attachments.metadata('task', [first.id])).toThrow(SyntaxError)
    // The materialization path still returns the actual bytes.
    encode.mockRestore()
    expect(attachments.read('task', second.id).data).toBe(data.toString('base64'))
    expect(
      (await readFile((await attachments.materialize('task', second)).path)).equals(data),
    ).toBe(true)
  } finally {
    await attachments.dispose()
    db.close()
  }
})
