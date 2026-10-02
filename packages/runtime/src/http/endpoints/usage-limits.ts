import { Effect, Schema } from 'effect'
import {
  decode,
  mutableStruct,
  mergePlanLimits,
  modelDiscoveryInput,
  resolveTaskAgent,
  type Agent,
} from '@dovo/protocol'
import type { IncomingMessage } from 'node:http'
import { RuntimeServices, type Services } from '../../services.js'
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
  const configurations = new Map<string, Agent[]>()
  for (const agent of [
    ...workspace.agents,
    ...workspace.tasks.flatMap((task) => {
      const agent = resolveTaskAgent(task, workspace.agents)
      return agent ? [{ ...agent, id: agent.id || `task:${task.id}` }] : []
    }),
  ]) {
    if (agent.provider !== 'codex' && agent.provider !== 'claude') continue
    const key = JSON.stringify(modelDiscoveryInput(agent))
    const agents = configurations.get(key) ?? []
    if (!agents.some((old) => old.id === agent.id)) configurations.set(key, [...agents, agent])
  }
  const key = JSON.stringify(
    [...configurations].map(([key, agents]) => [key, agents.map((agent) => agent.id)]),
  )
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
    const probe = async (agents: Agent[]) => {
      const agent = agents[0]
      try {
        const result = await readUsageLimits(agent)
        const sourceTask = workspace.tasks.find(
          (task) =>
            task.turns?.some((turn) => turn.usageAccount?.id === result.account?.id) &&
            JSON.stringify(
              modelDiscoveryInput(resolveTaskAgent(task, workspace.agents) ?? agent),
            ) === JSON.stringify(modelDiscoveryInput(agent)),
        )
        const limits = result.limits.map((limit) => ({
          ...limit,
          account: result.account,
          agentId: agent.id,
          ...(sourceTask ? { sourceTaskId: sourceTask.id } : {}),
        }))
        const status: 'ok' | 'unsupported' = limits.length ? 'ok' : 'unsupported'
        s.store.update((workspace) => ({
          ...workspace,
          planLimits: mergePlanLimits(
            (workspace.planLimits ?? []).filter(
              (limit) =>
                !agents.some((agent) => limit.agentId === agent.id) &&
                !(
                  result.account &&
                  limit.provider === agent.provider &&
                  limit.account?.id === result.account.id
                ),
            ),
            limits,
          ),
        }))
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
      mutableStruct({ force: Schema.optional(Schema.Boolean) }),
      yield* serviceResult(body(request)),
    )
    return yield* serviceResult(read(s, input.force ?? false))
  })
