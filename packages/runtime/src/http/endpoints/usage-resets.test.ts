import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { randomBytes } from 'node:crypto'
import { startRuntime } from '../../index.js'
import { fixture } from '../../testing/fixture.js'
import { readResetCredits, consumeResetCredit } from '../../agents/tasks/reset-credits.js'
vi.mock('../../agents/tasks/reset-credits.js', () => ({
  readResetCredits:
    vi.fn<(typeof import('../../agents/tasks/reset-credits.js'))['readResetCredits']>(),
  consumeResetCredit:
    vi.fn<(typeof import('../../agents/tasks/reset-credits.js'))['consumeResetCredit']>(),
}))
it('requires authentication, isolates read from consume, and reuses a failed attempt ID', async () => {
  const token = randomBytes(32).toString('base64url')
  const f = await fixture()
  const databasePath = join(f.directory, 'usage.sqlite')
  let runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  try {
    runtime.services.store.update(() => f.workspace)
    const task = runtime.services.tasks.create({
      title: 'Usage',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Check',
    })
    runtime.services.store.updateTask(task.id, (current) => ({
      ...current,
      turns: [
        {
          id: 'turn',
          assistantId: 'reply',
          agentId: 'agent',
          provider: 'codex',
          model: '',
          startedAt: new Date().toISOString(),
          status: 'completed',
          usageAccount: { id: 'account', label: 'Account', subscription: 'pro' },
        },
      ],
    }))
    vi.mocked(readResetCredits).mockResolvedValue({
      credits: { supported: true, availableCount: 1, credits: [{ id: 'credit', title: 'Reset' }] },
      limits: [],
    })
    const call = (action: string, extra: object = {}, credential = token) =>
      fetch(`http://127.0.0.1:${runtime.port}/api/usage/resets/${action}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${credential}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: task.id, accountId: 'account', ...extra }),
      })
    expect((await call('read', {}, 'bad')).status).toBe(401)
    expect((await call('read')).status).toBe(200)
    expect(consumeResetCredit).not.toHaveBeenCalled()
    vi.mocked(consumeResetCredit)
      .mockRejectedValueOnce(new Error('Connection lost'))
      .mockResolvedValue('reset')
    expect((await call('consume', { creditId: 'credit', idempotencyKey: 'attempt-a' })).ok).toBe(
      false,
    )
    await runtime.close()
    runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
    expect(await (await call('read')).json()).toMatchObject({ pendingAttemptId: 'attempt-a' })
    expect(
      (await call('consume', { creditId: 'credit', idempotencyKey: 'attempt-b' })).status,
    ).toBe(409)
    expect(
      await (await call('consume', { creditId: 'credit', idempotencyKey: 'attempt-a' })).json(),
    ).toEqual({ outcome: 'reset' })
    expect(
      await (await call('consume', { creditId: 'credit', idempotencyKey: 'attempt-a' })).json(),
    ).toEqual({ outcome: 'reset' })
    await runtime.close()
    runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
    expect(
      await (await call('consume', { creditId: 'credit', idempotencyKey: 'attempt-a' })).json(),
    ).toEqual({ outcome: 'reset' })
    expect(consumeResetCredit).toHaveBeenCalledTimes(2)
    expect((await call('read', { accountId: 'other' })).status).toBe(400)
  } finally {
    await runtime.close()
    await f.cleanup()
  }
})
