import { expect, it, vi } from 'vite-plus/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startRuntime } from '../index'
import type { AgentAdapter, AgentRun } from '../agents/execution/types'

it('titles stored attachment-only messages and rejects threads without a user message', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-title-'))
  const token = 'title-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({
    databasePath: join(directory, 'runtime.sqlite'),
    ownerToken: token,
    port: 0,
  })
  try {
    runtime.services.titles.save({
      harness: { provider: 'codex', endpoint: 'fixture' },
      model: 'title-model',
    })
    let captured: AgentRun | undefined
    vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
      probe: vi.fn<AgentAdapter['probe']>(),
      run: async (run) => {
        captured = run
        run.onText('Screenshot review')
      },
    })
    const task = runtime.services.tasks.create({
      title: 'New',
      repositoryId: '',
      agentId: '',
      objective: '',
    })
    const call = (body: unknown) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/tasks/title`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    expect((await call({ taskId: task.id, text: 'must not be used' })).status).toBe(400)
    const attachment = {
      id: '8cf51548-a817-44fd-802f-1d22cb814101',
      name: 'dashboard.png',
      mime: 'image/png',
      size: 123,
    }
    runtime.services.store.updateTaskHistory(task.id, (current) => ({
      ...current,
      messages: [{ id: 'first', role: 'user', text: '', attachments: [attachment] }],
    }))
    const response = await call({ taskId: task.id, expectedTitle: 'New', text: 'must not be used' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ title: 'Screenshot review' })
    expect(captured?.prompt).toContain('dashboard.png')
    expect(captured?.prompt).not.toContain('must not be used')
    expect(runtime.services.store.task(task.id).title).toBe('Screenshot review')
  } finally {
    await runtime.close()
    await rm(directory, { recursive: true, force: true })
  }
})
