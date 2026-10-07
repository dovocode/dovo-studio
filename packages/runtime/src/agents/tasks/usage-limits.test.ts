import { expect, it, vi } from 'vite-plus/test'
import type { Agent } from '@dovo/protocol'
import { readUsageLimits } from './usage-limits.js'
const mocks = vi.hoisted(() => ({
  query:
    vi.fn<
      (input: Parameters<typeof import('@anthropic-ai/claude-agent-sdk').query>[0]) => unknown
    >(),
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: mocks.query }))
vi.mock('../configuration/claude-command.js', () => ({ claudeCommand: async () => '/bin/claude' }))
const agent: Agent = {
  id: 'claude',
  name: 'Claude',
  provider: 'claude',
  endpoint: '',
  model: '',
  instructions: '',
  permission: 'ask',
}
it('uses the Claude control channel without sending a model prompt and closes it', async () => {
  const close = vi.fn<() => void>(),
    usage = vi.fn<(options?: { skipBehaviors?: boolean }) => Promise<unknown>>().mockResolvedValue({
      subscription_type: 'pro',
      rate_limits_available: true,
      // A window that already reset is not a current limit; keep the fixture in the future.
      rate_limits: {
        five_hour: { utilization: 25, resets_at: new Date(Date.now() + 3_600_000).toISOString() },
      },
    })
  mocks.query.mockReturnValue({
    accountInfo: async () => ({
      email: 'test@example.com',
      organization: 'org',
      subscriptionType: 'pro',
    }),
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: usage,
    close,
  })
  const result = await readUsageLimits(agent)
  expect(result.limits).toMatchObject([{ window: 'Session', usedPercent: 25 }])
  expect(result.account?.label).toBe('test@example.com')
  expect(usage).toHaveBeenCalledWith({ skipBehaviors: true })
  expect(close).toHaveBeenCalledOnce()
  const prompt = mocks.query.mock.calls[0][0].prompt
  expect(typeof prompt).not.toBe('string')
  if (typeof prompt === 'string') throw new Error('Quota probe submitted a string prompt')
  expect(await prompt[Symbol.asyncIterator]().next()).toEqual({ done: true, value: undefined })
})
it('keeps API-key configurations out of subscription account readings', async () => {
  mocks.query.mockClear()
  expect(await readUsageLimits({ ...agent, env: { ANTHROPIC_API_KEY: 'test' } })).toEqual({
    account: undefined,
    limits: [],
  })
  expect(mocks.query).not.toHaveBeenCalled()
})
