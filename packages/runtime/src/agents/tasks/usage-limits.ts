import { homedir } from 'node:os'
import { query, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { reportedPlanLimits, type Agent } from '@dovo/protocol'
import { processEnvironment } from '../../process.js'
import { claudeCommand } from '../configuration/claude-command.js'
import { claudeLaunchFlags } from '../configuration/launch-flags.js'
import { codexAccount } from './reset-credits.js'
import { reportedUsageAccount } from './usage-account.js'

/** Keep a control channel open without sending a message or consuming model tokens. */
export async function readUsageLimits(agent: Agent) {
  if (agent.provider === 'codex')
    return codexAccount(agent, async (request) => {
      const account = reportedUsageAccount(
        'codex',
        'account/read',
        await request('account/read', { refreshToken: false }),
      )
      const payload = await request('account/rateLimits/read')
      const limits = reportedPlanLimits('codex', 'account/rateLimits/read', payload)
      return { account, limits }
    })
  if (agent.provider !== 'claude') return { account: undefined, limits: [] }
  const env = processEnvironment(agent.env)
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return { account: undefined, limits: [] }
  const controller = new AbortController()
  const input: AsyncIterable<SDKUserMessage> = {
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        if (!controller.signal.aborted)
          await new Promise<void>((resolve) =>
            controller.signal.addEventListener('abort', () => resolve(), { once: true }),
          )
        return { done: true, value: undefined }
      },
    }),
  }
  const stream = query({
    prompt: input,
    options: {
      cwd: homedir(),
      env,
      extraArgs: claudeLaunchFlags(agent.args),
      abortController: controller,
      settingSources: [],
      pathToClaudeCodeExecutable: await claudeCommand(agent.endpoint, agent.env),
    },
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        const info = await stream.accountInfo()
        const usage = await stream.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
          skipBehaviors: true,
        })
        const account = !usage.rate_limits_available
          ? undefined
          : reportedUsageAccount('claude', 'account/info', {
              ...info,
              subscriptionType: usage.subscription_type ?? info.subscriptionType,
            })
        return {
          account,
          limits: usage.rate_limits_available
            ? reportedPlanLimits('claude', 'account/usage/read', usage)
            : [],
        }
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Claude usage request timed out')), 20000)
      }),
    ])
  } finally {
    clearTimeout(timer)
    controller.abort()
    stream.close()
  }
}
