import { expect, it, vi } from 'vite-plus/test'
import { createTask, useWorkspace } from '@dovo/studio-core'
import { decode, runtimeProfile } from '@dovo/protocol'
import { dispatchLauncherTask, type LauncherAttempt } from './task-launcher-dispatch'
function fixture(failingPath: string) {
  const attempt: LauncherAttempt = {
    task: createTask({ title: 'Task', objective: '', repositoryId: 'repo', agentId: '' }),
    profile: runtimeProfile({
      address: 'http://server:8787',
      token: 'test-token-at-least-twenty-characters',
    }),
    messageId: crypto.randomUUID(),
    text: 'Fix the bug',
    created: false,
  }
  let failed = false
  const calls = vi.fn<(path: string, input: unknown) => void>()
  const request: ReturnType<typeof useWorkspace>['readRuntime'] = async (
    _profile,
    path,
    input,
    schema,
  ) => {
    calls(path, input)
    if (!failed && path === failingPath) {
      failed = true
      throw new Error('Response lost')
    }
    return decode(schema, path === '/api/workspace' ? { revision: 1 } : { ok: true })
  }
  return { attempt, calls, request }
}
it('retries a lost submission acknowledgement without creating another task or changing the message', async () => {
  const { attempt, calls, request } = fixture('/api/tasks/message')
  await expect(dispatchLauncherTask(attempt, request)).rejects.toThrow('Response lost')
  expect(attempt.created).toBe(true)
  await dispatchLauncherTask(attempt, request)
  expect(calls.mock.calls.filter(([path]) => path === '/api/workspace')).toHaveLength(1)
  const messages = calls.mock.calls.filter(([path]) => path === '/api/tasks/message')
  expect(messages).toHaveLength(2)
  expect(messages[0]).toEqual(messages[1])
  expect(messages[0][1]).toEqual({
    id: attempt.task.id,
    messageId: attempt.messageId,
    text: 'Fix the bug',
  })
})
it('reuses the identical creation payload if creating the draft loses its acknowledgement', async () => {
  const { attempt, calls, request } = fixture('/api/workspace')
  await expect(dispatchLauncherTask(attempt, request)).rejects.toThrow('Response lost')
  expect(attempt.created).toBe(false)
  await dispatchLauncherTask(attempt, request)
  expect(calls.mock.calls[0]).toEqual(calls.mock.calls[1])
  expect(calls.mock.calls.filter(([path]) => path === '/api/tasks/message')).toHaveLength(1)
})
