import { afterEach, expect, it, vi } from 'vitest'
import { startRuntime } from '../index'
import * as previews from '../previews/devices'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0)) await cleanup()
})
it('authenticates preview controls and requires a task on this runtime before invoking device tools', async () => {
  const list = vi
    .spyOn(previews, 'previewDevices')
    .mockResolvedValue({ host: 'Test host', devices: [], diagnostics: [] })
  const action = vi.spyOn(previews, 'previewDeviceAction').mockResolvedValue({ ok: true })
  const token = 'preview-owner-token-at-least-thirty-two-characters'
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: token, port: 0 })
  cleanups.push(() => runtime.close())
  const call = (path: string, body: unknown, credential = token) =>
    fetch(`http://127.0.0.1:${runtime.port}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  expect((await call('/api/previews/devices', { taskId: 'task' }, 'bad')).status).toBe(401)
  expect((await call('/api/previews/devices', { taskId: 'missing' })).status).toBe(404)
  expect(list).not.toHaveBeenCalled()
  runtime.services.store.update((w) => ({
    ...w,
    tasks: [
      {
        id: 'task',
        title: 'Preview',
        repositoryId: 'repo',
        agentId: '',
        status: 'draft',
        createdAt: new Date().toISOString(),
        messages: [],
        files: [],
        draft: '',
        example: false,
      },
    ],
  }))
  expect((await call('/api/previews/devices', { taskId: 'task' })).status).toBe(200)
  expect(list).toHaveBeenCalledOnce()
  expect(
    (await call('/api/previews/action', { taskId: 'task', id: 'ios:test', action: 'erase' }))
      .status,
  ).toBe(400)
  expect(action).not.toHaveBeenCalled()
  expect(
    (await call('/api/previews/action', { taskId: 'task', id: 'ios:test', action: 'screenshot' }))
      .status,
  ).toBe(200)
  expect(action).toHaveBeenCalledWith({ taskId: 'task', id: 'ios:test', action: 'screenshot' })
})
