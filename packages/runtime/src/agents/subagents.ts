import { z } from 'zod'
import type { Subagent } from '@dovo/protocol'
const record = z.record(z.string(), z.unknown())
const object = (value: unknown) => record.safeParse(value).data ?? {}
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
const status = (value: unknown): Subagent['status'] => {
  if (['running', 'pendingInit', 'started', 'interacted'].includes(String(value))) return 'working'
  if (value === 'completed') return 'completed'
  if (['failed', 'errored'].includes(String(value))) return 'failed'
  if (['stopped', 'shutdown', 'interrupted'].includes(String(value))) return 'stopped'
  return 'unknown'
}

/** Consume only explicit provider subagent events; never infer agents from arbitrary commands. */
export function updateSubagents(
  current: Subagent[],
  provider: string,
  payload: unknown,
  now: string,
  method?: string,
): Subagent[] {
  const event = object(payload),
    item = object(event.item)
  let next = current
  const put = (id: string, fields: Partial<Subagent>) => {
    const previous = next.find((agent) => agent.id === id && agent.provider === provider)
    const agent: Subagent = {
      id,
      provider,
      name: id,
      status: 'unknown',
      startedAt: now,
      ...previous,
      ...fields,
      updatedAt: now,
    }
    if (agent.status === 'working') agent.finishedAt = undefined
    else if (agent.status !== 'unknown') agent.finishedAt = previous?.finishedAt ?? now
    next = [...next.filter((entry) => entry.id !== id || entry.provider !== provider), agent]
  }
  const childId = text(event.threadId)
  if (
    provider === 'codex' &&
    childId &&
    current.some((agent) => agent.provider === provider && agent.id === childId)
  ) {
    if (method === 'thread/tokenUsage/updated') {
      const tokens = number(object(object(event.tokenUsage).total).totalTokens)
      if (tokens !== undefined) put(childId, { tokens })
    }
    if (method === 'item/started') {
      const activity = text(item.type)
      if (activity) put(childId, { activity, status: 'working' })
    }
    if (method === 'turn/completed') {
      const turn = object(event.turn)
      put(childId, { status: status(turn.status), activity: text(object(turn.error).message) })
    }
  }
  if (provider === 'codex' && item.type === 'collabAgentToolCall') {
    const states = object(item.agentsStates)
    const ids = new Set([
      ...(z.array(z.string()).safeParse(item.receiverThreadIds).data ?? []),
      ...Object.keys(states),
    ])
    for (const id of ids) {
      const state = object(states[id])
      const previous = next.find((agent) => agent.id === id)
      const fields: Partial<Subagent> = {}
      if (text(item.senderThreadId)) fields.parentId = text(item.senderThreadId)
      if (state.status) fields.status = status(state.status)
      else if (!previous) fields.status = 'unknown'
      if (text(state.message)) fields.activity = text(state.message)
      if (item.tool === 'spawnAgent') {
        if (text(item.model)) fields.model = text(item.model)
        if (text(item.reasoningEffort)) fields.reasoning = text(item.reasoningEffort)
        if (text(item.prompt)) fields.prompt = text(item.prompt)
      }
      put(id, fields)
    }
  }
  if (provider === 'codex' && item.type === 'subAgentActivity' && text(item.agentThreadId)) {
    put(String(item.agentThreadId), {
      name: text(item.agentPath) ?? String(item.agentThreadId),
      status: status(item.kind),
    })
  }
  if (provider === 'claude' && event.type === 'system' && text(event.task_id)) {
    const id = String(event.task_id),
      previous = next.find((agent) => agent.id === id && agent.provider === provider)
    if (
      event.subtype === 'task_started' &&
      (event.task_type === 'local_agent' || text(event.subagent_type))
    ) {
      put(id, {
        name: text(event.description) ?? text(event.subagent_type) ?? id,
        status: 'working',
        prompt: text(event.prompt),
      })
    } else if (previous && ['task_progress', 'task_notification'].includes(String(event.subtype))) {
      const usage = object(event.usage)
      put(id, {
        status: event.subtype === 'task_progress' ? 'working' : status(event.status),
        activity: text(event.summary) ?? text(event.last_tool_name) ?? text(event.description),
        tokens: number(usage.total_tokens) ?? previous.tokens,
        durationMs: number(usage.duration_ms) ?? previous.durationMs,
      })
    }
  }
  return next
}
