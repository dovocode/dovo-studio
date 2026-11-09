import { expect, it, vi } from 'vite-plus/test'
import { ResponseError } from 'vscode-jsonrpc/node'
import { codexGoal } from './codex-goal.js'

function fixture() {
  const request = vi.fn<(method: string, params: object) => Promise<unknown>>(async () => ({
    goal: { objective: 'Fix tests', status: 'active', tokensUsed: 123, timeUsedSeconds: 4 },
  }))
  const accepted = vi.fn<() => void>()
  const text = vi.fn<(value: string) => void>()
  return {
    request,
    accepted,
    text,
    run: (command: Parameters<typeof codexGoal>[2]) =>
      codexGoal(request, 'thread', command, accepted, text),
  }
}

it('sets a native goal with user provenance and returns a work prompt', async () => {
  const f = fixture()
  expect(await f.run({ action: 'set', objective: 'Fix tests' })).toContain('Fix tests')
  expect(f.request).toHaveBeenCalledExactlyOnceWith('thread/goal/set', {
    threadId: 'thread',
    objective: 'Fix tests',
    status: 'active',
    origin: 'user',
  })
  expect(f.accepted).toHaveBeenCalledOnce()
})

it.each(['get', 'clear', 'pause'] as const)('does not start model work for %s', async (action) => {
  const f = fixture()
  expect(await f.run({ action })).toBeUndefined()
  expect(f.request.mock.calls.every(([method]) => method.startsWith('thread/goal/'))).toBe(true)
  const expected = {
    get: { method: 'thread/goal/get', params: { threadId: 'thread' } },
    pause: {
      method: 'thread/goal/set',
      params: { threadId: 'thread', status: 'paused', origin: 'user' },
    },
    clear: { method: 'thread/goal/clear', params: { threadId: 'thread', origin: 'user' } },
  }[action]
  expect(f.request).toHaveBeenLastCalledWith(expected.method, expected.params)
  expect(f.text).toHaveBeenCalledOnce()
})

it('resumes without replacing the objective or resetting usage', async () => {
  const f = fixture()
  expect(await f.run({ action: 'resume' })).toContain('Fix tests')
  expect(f.request).toHaveBeenLastCalledWith('thread/goal/set', {
    threadId: 'thread',
    status: 'active',
    origin: 'user',
  })
  expect(f.text).toHaveBeenCalledWith(expect.stringContaining('123 tokens'))
})

it('reports missing goals and old versions without a prompt fallback', async () => {
  const f = fixture()
  f.request.mockResolvedValue({ goal: null })
  await expect(f.run({ action: 'resume' })).rejects.toThrow('No goal set')
  expect(f.accepted).not.toHaveBeenCalled()
  f.request.mockRejectedValue(new ResponseError(-32601, 'unknown method'))
  await expect(f.run({ action: 'set', objective: 'Test' })).rejects.toThrow('Update Codex')
  expect(f.text).not.toHaveBeenCalled()
  f.request.mockRejectedValue(new ResponseError(-32000, 'Storage unavailable'))
  await expect(f.run({ action: 'clear' })).rejects.toThrow('Storage unavailable')
})
