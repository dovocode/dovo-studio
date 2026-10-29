import { Effect, Schema } from 'effect'
import {
  decode,
  mutableStruct,
  mergePlanLimits,
  planLimitKey,
  modelDiscoveryInput,
  resolveTaskAgent,
  type Agent,
  type PlanLimit,
} from '@dovo/protocol'
import type { IncomingMessage } from 'node:http'
import type { Services } from '../../services.js'
import { RuntimeServices } from '../../runtime-services.js'
import { readUsageLimits } from '../../agents/tasks/usage-limits.js'
import { body } from '../support/body.js'
import { serviceResult } from '../support/effect.js'
import { errorMessage } from '../../errors.js'
const cache = new WeakMap<
  Services,
  { key: string; checkedAt: number; pending?: Promise<Result>; result?: Result }
>()
type Result = {
  checkedAt: string
  accounts: {
    agentId: string
    provider: string
    status: 'ok' | 'unsupported' | 'failed'
    reason?: string
  }[]
}
/** Coalesce clients and launch settings. Failed probes also respect the automatic cooldown. */
async function read(s: Services, force: boolean): Promise<Result> {
  const workspace = s.store.get()
  const configurations = new Map<string, Map<string, Agent>>()
  for (const agent of [
    ...workspace.agents,
    ...workspace.tasks.flatMap((task) => {
      const agent = resolveTaskAgent(task, workspace.agents)
      return agent ? [{ ...agent, id: agent.id || `task:${task.id}` }] : []
    }),
  ]) {
    if (agent.provider !== 'codex' && agent.provider !== 'claude') continue
    const key = JSON.stringify(modelDiscoveryInput(agent))
    let agents = configurations.get(key)
    if (!agents) {
      agents = new Map()
      configurations.set(key, agents)
    }
    if (!agents.has(agent.id)) agents.set(agent.id, agent)
  }
  const key = JSON.stringify([...configurations].map(([key, agents]) => [key, [...agents.keys()]]))
  const previous = cache.get(s)
  if (previous?.key === key && previous.pending) return previous.pending
  if (
    !force &&
    previous?.key === key &&
    previous.result &&
    Date.now() - previous.checkedAt < 300000
  )
    return previous.result
  const entry: { key: string; checkedAt: number; pending?: Promise<Result>; result?: Result } = {
    key,
    checkedAt: Date.now(),
  }
  cache.set(s, entry)
  const pending = (async () => {
    const accounts: Result['accounts'] = []
    const probe = async (configuration: Map<string, Agent>) => {
      const agents = [...configuration.values()]
      const agent = agents[0]
      try {
        // Use admission time: a slower probe must not supersede a later observation.
        const startedAt = new Date().toISOString()
        const atAdmission = new Map(
          (s.store.get().planLimits ?? []).map((limit) => [
            planLimitKey(limit),
            JSON.stringify(limit),
          ]),
        )
        const result = await readUsageLimits(agent)
        const accountId = result.account?.id
        const used = accountId ? s.store.usage.taskIds(accountId) : new Set<string>()
        const sourceTask = workspace.tasks.find(
          (task) =>
            (task.history.latestTurn?.usageAccount?.id === accountId || used.has(task.id)) &&
            !!accountId &&
            JSON.stringify(
              modelDiscoveryInput(resolveTaskAgent(task, workspace.agents) ?? agent),
            ) === JSON.stringify(modelDiscoveryInput(agent)),
        )
        const limits = result.limits.map((limit) => ({
          ...limit,
          updatedAt: startedAt,
          account: result.account,
          agentId: agent.id,
          ...(sourceTask ? { sourceTaskId: sourceTask.id } : {}),
        }))
        const status: 'ok' | 'unsupported' = limits.length ? 'ok' : 'unsupported'
        s.store.update((workspace) => {
          const existing = workspace.planLimits ?? []
          const concurrent = (limit: PlanLimit) => {
            const observed = Date.parse(limit.updatedAt),
              admission = Date.parse(startedAt)
            return (
              observed > admission ||
              (observed === admission &&
                atAdmission.get(planLimitKey(limit)) !== JSON.stringify(limit))
            )
          }
          const protectedReadings = existing.filter(concurrent)
          // Ignore account/source attribution only when comparing the same window.
          // A concurrent anonymous reading must not be rolled back while an older
          // probe is learning which account owns this source.
          const windowKey = (limit: PlanLimit) =>
            planLimitKey({
              ...limit,
              account: undefined,
              agentId: undefined,
              sourceTaskId: undefined,
            })
          const incoming = limits.filter(
            (limit) =>
              !protectedReadings.some(
                (old) =>
                  planLimitKey(old) === planLimitKey(limit) ||
                  (!old.account &&
                    windowKey(old) === windowKey(limit) &&
                    ((old.agentId !== undefined && configuration.has(old.agentId)) ||
                      (old.sourceTaskId !== undefined && old.sourceTaskId === limit.sourceTaskId))),
              ),
          )
          return {
            ...workspace,
            planLimits: mergePlanLimits(
              existing.filter(
                (limit) =>
                  concurrent(limit) ||
                  (!(limit.agentId !== undefined && configuration.has(limit.agentId)) &&
                    !(
                      result.account &&
                      limit.provider === agent.provider &&
                      limit.account?.id === result.account.id
                    )),
              ),
              incoming,
            ),
          }
        })
        accounts.push(
          ...agents.map((agent) => ({ agentId: agent.id, provider: agent.provider, status })),
        )
      } catch (cause) {
        accounts.push(
          ...agents.map((agent) => ({
            agentId: agent.id,
            provider: agent.provider,
            status: 'failed' as const,
            reason: errorMessage(cause),
          })),
        )
      }
    }
    const iterator = configurations.values()
    await Promise.all(
      Array.from({ length: Math.min(2, configurations.size) }, async () => {
        for (let next = iterator.next(); !next.done; next = iterator.next()) await probe(next.value)
      }),
    )
    return { checkedAt: new Date().toISOString(), accounts }
  })()
  entry.pending = pending
  try {
    entry.result = await pending
    return entry.result
  } finally {
    entry.checkedAt = Date.now()
    entry.pending = undefined
  }
}
export const usageLimits = (request: IncomingMessage) =>
  Effect.gen(function* () {
    const s = yield* RuntimeServices
    const input = decode(
      mutableStruct({
        force: Schema.optional(Schema.Boolean),
        section: Schema.optional(Schema.Literals(['local', 'hubs'])),
      }),
      yield* serviceResult(body(request)),
    )
    if (input.section === 'local') return yield* serviceResult(read(s, input.force ?? false))
    if (input.section === 'hubs')
      return {
        checkedAt: new Date().toISOString(),
        accounts: [],
        hubs: yield* serviceResult(s.store.usageHubs.read(input.force ?? false)),
      }
    const [local, hubs] = yield* serviceResult(
      Promise.all([read(s, input.force ?? false), s.store.usageHubs.read(input.force ?? false)]),
    )
    return { ...local, hubs }
  })
