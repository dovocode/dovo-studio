import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, isAbsolute } from 'node:path'
import { Schema } from 'effect'
import {
  decode,
  decodeResult,
  mutableStruct,
  mutableArray,
  resetCreditsSchema,
  reportedPlanLimits,
  type Agent,
  type PlanLimit,
} from '@dovo/protocol'
import { createMessageConnection } from 'vscode-jsonrpc/node'
import { JsonLineReader, JsonLineWriter } from '../providers/codex/codex-transport.js'
import { processEnvironment } from '../../process.js'
import { stopOwnedChild } from '../execution/stop-owned-child.js'
import { reportedUsageAccount } from './usage-account.js'

export type ResetCredits = Schema.Schema.Type<typeof resetCreditsSchema>
const unavailable = (reason: string): ResetCredits => ({
  supported: false,
  availableCount: 0,
  credits: [],
  reason,
})
const optionalText = Schema.optional(Schema.NullOr(Schema.String))
const grantSchema = mutableStruct({
  id: Schema.String,
  resets_left: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  ends_at: optionalText,
  paused: Schema.optional(Schema.Boolean),
  usable_now: Schema.optional(Schema.Boolean),
})
export function claudeCredits(payload: unknown, now = Date.now()): ResetCredits {
  const result = decodeResult(
    mutableStruct({
      cedar_ember: Schema.optional(
        Schema.NullOr(
          mutableStruct({
            eligible: Schema.Boolean,
            next_grant_id: optionalText,
            grants: Schema.optional(mutableArray(Schema.Unknown)),
          }),
        ),
      ),
    }),
    payload,
  )
  if (!result.success || !result.data.cedar_ember?.eligible)
    return unavailable('This account does not report banked resets.')
  const block = result.data.cedar_ember
  const grants = (block.grants ?? [])
    .flatMap((item) => {
      const decoded = decodeResult(grantSchema, item)
      return decoded.success ? [decoded.data] : []
    })
    .filter(
      (grant) =>
        !grant.paused &&
        grant.usable_now &&
        grant.resets_left > 0 &&
        (!grant.ends_at || Date.parse(grant.ends_at) > now),
    )
  const next = grants.find((grant) => grant.id === block.next_grant_id)
  return {
    supported: true,
    availableCount: next ? grants.reduce((n, grant) => n + grant.resets_left, 0) : 0,
    credits: next
      ? [next, ...grants.filter((grant) => grant !== next)].map((grant) => ({
          id: grant.id,
          title: `${grant.resets_left} ${grant.resets_left === 1 ? 'reset' : 'resets'}`,
          ...(grant.ends_at ? { expiresAt: grant.ends_at } : {}),
        }))
      : [],
  }
}
export function codexCredits(payload: unknown, now = Date.now()): ResetCredits {
  const result = decodeResult(
    mutableStruct({
      rateLimitResetCredits: Schema.optional(
        Schema.NullOr(
          mutableStruct({
            availableCount: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
            credits: Schema.optional(Schema.NullOr(mutableArray(Schema.Unknown))),
          }),
        ),
      ),
    }),
    payload,
  )
  if (!result.success || !result.data.rateLimitResetCredits)
    return unavailable('This Codex version or account does not report reset credits.')
  const summary = result.data.rateLimitResetCredits
  const schema = mutableStruct({
    id: Schema.String,
    status: Schema.String,
    resetType: Schema.String,
    title: optionalText,
    expiresAt: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.finite()))),
  })
  return {
    supported: true,
    availableCount: summary.availableCount,
    credits: (summary.credits ?? []).flatMap((raw) => {
      const parsed = decodeResult(schema, raw)
      if (!parsed.success) return []
      const credit = parsed.data
      return credit.status === 'available' &&
        credit.resetType === 'codexRateLimits' &&
        (!credit.expiresAt || credit.expiresAt * 1000 > now)
        ? [
            {
              id: credit.id,
              title: credit.title ?? 'Full quota reset',
              ...(credit.expiresAt
                ? { expiresAt: new Date(credit.expiresAt * 1000).toISOString() }
                : {}),
            },
          ]
        : []
    }),
  }
}

/** A status-only app-server connection: no thread or model prompt is created. */
async function codexAccount<T>(
  agent: Agent,
  action: (request: (method: string, params?: object) => Promise<unknown>) => Promise<T>,
) {
  const child = spawn(
    agent.endpoint || 'codex',
    ['app-server', '--listen', 'stdio://', ...(agent.args ?? [])],
    {
      cwd: homedir(),
      env: processEnvironment(agent.env),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    },
  )
  if (!child.stdin || !child.stdout || !child.stderr)
    throw new Error('Codex status pipes unavailable')
  child.stderr.resume()
  const rpc = createMessageConnection(
    new JsonLineReader(child.stdout),
    new JsonLineWriter(child.stdin),
  )
  const controller = new AbortController()
  const failed = new Promise<never>((_, reject) => {
    child.once('error', reject)
    child.once('exit', () => reject(new Error('Codex status connection closed')))
    controller.signal.addEventListener(
      'abort',
      () => reject(new Error('Codex status request timed out')),
      { once: true },
    )
  })
  const timeout = setTimeout(() => controller.abort(), 20000)
  rpc.listen()
  try {
    return await Promise.race([
      failed,
      (async () => {
        await rpc.sendRequest('initialize', {
          clientInfo: { name: 'dovo_usage', version: '0.1.0' },
          capabilities: { experimentalApi: true },
        })
        await rpc.sendNotification('initialized', {})
        return action((method, params = {}) => rpc.sendRequest(method, params))
      })(),
    ])
  } finally {
    clearTimeout(timeout)
    rpc.dispose()
    await stopOwnedChild(child)
  }
}
async function readLogin<T extends Schema.Schema.AnyNoContext>(
  schema: T,
  path: string,
): Promise<Schema.Schema.Type<T>> {
  try {
    return decode(schema, JSON.parse(await readFile(path, 'utf8')))
  } catch {
    throw new Error('Claude login could not be read. Sign in again on the host.')
  }
}
async function claudeLogin(agent: Agent) {
  if (process.platform === 'darwin')
    throw new Error(
      'Claude resets are unavailable on macOS because its login is stored in Keychain.',
    )
  const env = processEnvironment(agent.env)
  if (env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY)
    throw new Error(
      'Banked resets require a Claude subscription login, rather than an API key or proxy.',
    )
  const home = env.HOME || homedir()
  const configured = env.CLAUDE_CONFIG_DIR || join(home, '.claude')
  const directory = configured.startsWith('~/') ? join(home, configured.slice(2)) : configured
  if (!isAbsolute(directory))
    throw new Error('Claude reset credits require an absolute CLAUDE_CONFIG_DIR.')
  const credentials = await readLogin(
    mutableStruct({ claudeAiOauth: mutableStruct({ accessToken: Schema.String }) }),
    join(directory, '.credentials.json'),
  )
  const config = await readLogin(
    mutableStruct({
      oauthAccount: mutableStruct({ organizationUuid: Schema.String, emailAddress: Schema.String }),
    }),
    env.CLAUDE_CONFIG_DIR ? join(directory, '.claude.json') : join(home, '.claude.json'),
  )
  return {
    token: credentials.claudeAiOauth.accessToken,
    organization: config.oauthAccount.organizationUuid,
    email: config.oauthAccount.emailAddress,
  }
}
async function claudeRequest(
  login: Awaited<ReturnType<typeof claudeLogin>>,
  path: string,
  body?: object,
) {
  const response = await fetch(`https://api.anthropic.com${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${login.token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'content-type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`Claude reset request failed (${response.status}).`)
  return response.json() as Promise<unknown>
}
export function claudeQuotaLimits(payload: unknown): PlanLimit[] {
  const record = decodeResult(Schema.Record({ key: Schema.String, value: Schema.Unknown }), payload)
  if (!record.success) return []
  const nested = decodeResult(
    Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    record.data.rate_limits,
  )
  const windows = nested.success ? nested.data : record.data
  const labels = {
    five_hour: '5-hour',
    seven_day: '7-day',
    seven_day_opus: '7-day Opus',
    seven_day_sonnet: '7-day Sonnet',
  }
  return Object.entries(labels).flatMap(([key, window]) => {
    const result = decodeResult(
      mutableStruct({ utilization: Schema.Number.pipe(Schema.finite()), resets_at: optionalText }),
      windows[key],
    )
    if (!result.success) return []
    const reset = result.data.resets_at ? Date.parse(result.data.resets_at) / 1000 : undefined
    return [
      {
        provider: 'claude',
        window,
        usedPercent: Math.max(0, Math.min(100, result.data.utilization)),
        ...(reset !== undefined && Number.isFinite(reset) ? { resetsAt: reset } : {}),
        updatedAt: new Date().toISOString(),
      },
    ]
  })
}
export async function readResetCredits(
  agent: Agent,
  expected: { id: string; label: string; subscription?: string },
) {
  if (agent.provider === 'codex')
    return codexAccount(agent, async (request) => {
      const account = reportedUsageAccount(
        'codex',
        'account/read',
        await request('account/read', { refreshToken: false }),
      )
      if (!account || account.id !== expected.id)
        throw new Error(
          'The signed-in Codex account changed. Run a turn to refresh its identity first.',
        )
      const usage = await request('account/rateLimits/read')
      return {
        credits: codexCredits(usage),
        limits: reportedPlanLimits('codex', 'account/rateLimits/read', usage),
      }
    })
  if (agent.provider === 'claude') {
    if (process.platform === 'darwin')
      return {
        credits: unavailable(
          'Claude resets are unavailable on macOS; its login is stored in Keychain.',
        ),
        limits: [],
      }
    const login = await claudeLogin(agent)
    const account = reportedUsageAccount('claude', 'account/info', {
      email: login.email,
      organization: login.organization,
      subscriptionType: expected.subscription,
    })
    if (account?.id !== expected.id)
      throw new Error(
        'Could not verify this Claude subscription against the host login. Run a turn to refresh its identity.',
      )
    const usage = await claudeRequest(login, '/api/oauth/usage?cedar_ember=1&skip_spend=1')
    return { credits: claudeCredits(usage), limits: claudeQuotaLimits(usage) }
  }
  throw new Error('This provider does not support quota resets.')
}
export async function consumeResetCredit(
  agent: Agent,
  expected: { id: string; label: string; subscription?: string },
  creditId: string | undefined,
  idempotencyKey: string,
) {
  const fresh = await readResetCredits(agent, expected)
  if (!fresh.credits.supported || fresh.credits.availableCount < 1)
    throw new Error(fresh.credits.reason ?? 'No reset credits are available.')
  if (creditId && !fresh.credits.credits.some((credit) => credit.id === creditId))
    throw new Error('This reset credit is no longer available. Refresh the list.')
  if (agent.provider === 'codex')
    return codexAccount(agent, async (request) => {
      const account = reportedUsageAccount(
        'codex',
        'account/read',
        await request('account/read', { refreshToken: false }),
      )
      if (account?.id !== expected.id)
        throw new Error('The signed-in account changed. Reset canceled.')
      const result = decode(
        mutableStruct({
          outcome: Schema.Literal('reset', 'nothingToReset', 'noCredit', 'alreadyRedeemed'),
        }),
        await request('account/rateLimitResetCredit/consume', {
          idempotencyKey,
          ...(creditId ? { creditId } : {}),
        }),
      )
      return result.outcome
    })
  const login = await claudeLogin(agent)
  const grant = creditId ?? fresh.credits.credits[0]?.id
  if (!grant || !/^[a-z0-9_-]{1,40}$/.test(grant))
    throw new Error('No redeemable Claude reset credit.')
  const response = decode(
    mutableStruct({
      result: Schema.Literal(
        'reset',
        'already_used',
        'not_limited',
        'cooldown',
        'ineligible',
        'unavailable',
      ),
    }),
    await claudeRequest(
      login,
      `/api/organizations/${encodeURIComponent(login.organization)}/reset_rate_limits`,
      { program: 'cedar_ember', grant_id: grant, request_id: idempotencyKey },
    ),
  )
  return response.result
}
