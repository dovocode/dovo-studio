import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, afterEach, expect, it, vi } from 'vite-plus/test'
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
let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'claude-usage-'))
  vi.stubEnv('HOME', home)
  vi.stubEnv('CLAUDE_CONFIG_DIR', join(home, '.claude'))
  for (const key of ['ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'])
    vi.stubEnv(key, '')
  mocks.query.mockClear()
})
afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(home, { recursive: true, force: true })
})
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
  mkdirSync(join(home, '.claude'))
  writeFileSync(join(home, '.claude', 'settings.json'), '{malformed-excluded-user-settings')
  const result = await readUsageLimits({
    ...agent,
    args: [
      '--setting-sources=user',
      '--setting-sources=',
      '--managed-settings={"env":{"ANTHROPIC_BASE_URL":"http://ignored-managed","ANTHROPIC_AUTH_TOKEN":"ignored-token"},"permissions":{"deny":["Read"]}}',
    ],
  })
  expect(result.limits).toMatchObject([{ window: 'Session', usedPercent: 25 }])
  expect(result.account?.label).toBe('test@example.com')
  expect(usage).toHaveBeenCalledWith({ skipBehaviors: true })
  expect(close).toHaveBeenCalledOnce()
  const options = mocks.query.mock.calls[0][0].options
  expect(options?.settingSources).toEqual([])
  expect(options?.extraArgs).not.toHaveProperty('setting-sources')
  expect(options?.extraArgs).not.toHaveProperty('managed-settings')
  expect(options?.env?.ANTHROPIC_BASE_URL).toBe('')
  expect(options?.env?.ANTHROPIC_AUTH_TOKEN).toBe('')
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

it('does not probe subscription usage for an endpoint-only settings gateway', async () => {
  mkdirSync(join(home, '.claude'))
  writeFileSync(
    join(home, '.claude', 'settings.json'),
    JSON.stringify({ env: { ANTHROPIC_BASE_URL: 'http://vpn:8080' } }),
  )
  expect(await readUsageLimits(agent)).toEqual({ account: undefined, limits: [] })
  expect(mocks.query).not.toHaveBeenCalled()
})
