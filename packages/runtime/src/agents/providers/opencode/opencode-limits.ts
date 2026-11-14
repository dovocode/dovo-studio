import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { Schema } from 'effect'
import { decode, mutableStruct, type PlanLimit } from '@dovo/protocol'
import { opencodeAddress, opencodeHeaders, type OpenCodeConnection } from './opencode-server.js'

const finite = Schema.Number.pipe(Schema.check(Schema.isFinite()))
const meter = mutableStruct({ percent: finite, limited: Schema.Boolean, resetsAt: finite })
const model = mutableStruct({
  providerID: Schema.String,
  modelID: Schema.String,
  name: Schema.String,
  spent: Schema.optional(finite),
})
const responseSchema = mutableStruct({
  data: Schema.NullOr(
    mutableStruct({
      workspace: mutableStruct({ id: Schema.String, name: Schema.optional(Schema.String) }),
      go: Schema.optional(mutableStruct({ rolling: meter, weekly: meter, monthly: meter })),
      budgets: Schema.Array(
        mutableStruct({
          id: Schema.String,
          limit: finite,
          spent: finite,
          scope: Schema.Literals(['each', 'combined']),
          per: Schema.Literals(['set', 'model']),
          coverage: Schema.Literals(['all', 'models']),
          models: Schema.Array(model),
          shared: Schema.Boolean,
          resetsAt: finite,
        }),
      ),
    }),
  ),
})

/** Read server-reported limits only. No model request or local credential scraping. */
export async function readOpenCodeServerLimits(connection: OpenCodeConnection) {
  const endpoint = opencodeAddress(connection.endpoint)
  const url = new URL(`${endpoint}/api/experimental/usage/limits`)
  url.searchParams.set('location[directory]', homedir())
  const response = await fetch(url, {
    headers: opencodeHeaders(connection.env),
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  })
  if (
    [404, 405].includes(response.status) ||
    (response.ok && response.headers.get('content-type')?.includes('text/html'))
  )
    return { account: undefined, limits: [] }
  if (response.status === 401 || response.status === 403)
    throw new Error(
      'OpenCode rejected authentication for account limits. Check this agent’s server credentials.',
    )
  if (!response.ok) throw new Error(`OpenCode account limits failed (${response.status}).`)
  const { data } = decode(responseSchema, await response.json())
  if (!data) return { account: undefined, limits: [] }
  const account = {
    // Workspace identifiers are server-scoped. Do not merge unrelated computers or endpoints.
    id: createHash('sha256').update(`opencode\0${endpoint}\0${data.workspace.id}`).digest('hex'),
    label: data.workspace.name?.trim() || data.workspace.id,
  }
  const limits: PlanLimit[] = []
  const updatedAt = new Date().toISOString()
  const append = (
    windowId: string,
    window: string,
    percent: number,
    reset: number,
    modelIds?: string[],
    durationMins?: number,
  ) =>
    limits.push({
      provider: 'opencode',
      bucketId: 'opencode',
      windowId,
      window,
      usedPercent: Math.min(100, Math.max(0, percent)),
      resetsAt: reset / 1000,
      updatedAt,
      ...(modelIds ? { modelIds } : {}),
      ...(durationMins ? { durationMins } : {}),
    })
  if (data.go)
    for (const [key, label, duration] of [
      ['rolling', 'Session', 300],
      ['weekly', 'Weekly', 10080],
      ['monthly', 'Monthly', undefined],
    ] as const) {
      const value = data.go[key]
      append(
        `go:${key}`,
        `Go · ${label}`,
        value.limited ? 100 : value.percent,
        value.resetsAt,
        undefined,
        duration,
      )
    }
  for (const budget of data.budgets) {
    const scope = budget.shared || budget.scope === 'combined' ? 'Shared' : 'Individual'
    const percent = (spent: number) => (budget.limit <= 0 ? 100 : (100 * spent) / budget.limit)
    if (
      budget.per === 'model' &&
      budget.coverage === 'models' &&
      budget.models.length &&
      budget.models.every((item) => item.spent !== undefined)
    ) {
      for (const item of budget.models)
        append(
          `budget:${budget.id}:${item.providerID}/${item.modelID}`,
          `Console · ${scope} · ${item.name}`,
          percent(item.spent!),
          budget.resetsAt,
          [`${item.providerID}/${item.modelID}`],
        )
    } else {
      const label =
        budget.coverage === 'all'
          ? 'All spend'
          : budget.models.map((m) => m.name).join(', ') || 'Models'
      append(
        `budget:${budget.id}`,
        `Console · ${scope} · ${label}${budget.per === 'model' ? ' · Most used model' : ''}`,
        percent(budget.spent),
        budget.resetsAt,
        budget.per === 'model'
          ? []
          : budget.coverage === 'models'
            ? budget.models.map((m) => `${m.providerID}/${m.modelID}`)
            : undefined,
      )
    }
  }
  return { account, limits }
}
