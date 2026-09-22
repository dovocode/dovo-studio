import { afterEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { startRuntime } from '../index'
import { fixture } from '../testing/fixture'
import { claudeInput } from '../agents/providers/claude-input'
import type { AgentRun } from '../agents/types'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
const token = 'attachment-test-owner-token-with-32-characters'
const png =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1kAAAAASUVORK5CYII='
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
  expect(s.attachments.read(task.id, a.attachment.id).data).toBe(png)
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
