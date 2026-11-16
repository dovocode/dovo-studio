import { expect, it } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { startRuntime } from '../index.js'

it('extracts text locally from a stored image without an agent run or a draft change', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-attachment-ocr-'))
  const token = 'ocr-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({
    databasePath: join(directory, 'runtime.sqlite'),
    ownerToken: token,
    port: 0,
  })
  try {
    const task = runtime.services.tasks.create({
      title: 'OCR',
      repositoryId: '',
      agentId: '',
      objective: '',
    })
    const other = runtime.services.tasks.create({
      title: 'Other',
      repositoryId: '',
      agentId: '',
      objective: '',
    })
    const id = randomUUID()
    const image = await sharp(
      Buffer.from(
        '<svg width="500" height="120"><rect width="100%" height="100%" fill="white"/><text x="20" y="78" font-size="46" font-family="sans-serif">SAVE CHANGES</text></svg>',
      ),
    )
      .png()
      .toBuffer()
    await runtime.services.attachments.upload({
      taskId: task.id,
      id,
      name: 'button.png',
      data: image.toString('base64'),
      detached: true,
    })
    const call = (input: unknown, credential = token) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/attachments/ocr`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      })
    const result = await call({ taskId: task.id, id })
    expect(result.status).toBe(200)
    const body: unknown = await result.json()
    expect(body).toEqual({ text: expect.stringMatching(/SAVE\s+CHANGES/) })
    expect(runtime.services.store.task(task.id).draftAttachments ?? []).toEqual([])
    expect(runtime.services.attachments.read(task.id, id).data).toBe(image.toString('base64'))
    expect((await call({ taskId: other.id, id })).status).toBe(400)
    expect((await call({ taskId: task.id, id }, 'invalid')).status).toBe(401)
    expect((await call({ taskId: task.id, id: '../button.png' })).status).toBe(400)
    const documentId = randomUUID()
    await runtime.services.attachments.upload({
      taskId: task.id,
      id: documentId,
      name: 'notes.txt',
      data: Buffer.from('Notes').toString('base64'),
      detached: true,
    })
    expect((await call({ taskId: task.id, id: documentId })).status).toBe(400)
  } finally {
    await runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
