import { mutableArray, nativeAgentWorking } from '@dovo/protocol'
import { decodeResult } from '@dovo/protocol'
import { Schema } from 'effect'
import type { Subagent } from '@dovo/protocol'
const record = Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown))
const object = (value: unknown) => decodeResult(record, value).data ?? {}
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined)
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
const status = (value: unknown): Subagent['status'] => {
  if (['running', 'pending', 'pendingInit', 'started', 'interacted'].includes(String(value)))
    return 'working'
  if (value === 'completed') return 'completed'
  if (['failed', 'errored'].includes(String(value))) return 'failed'
  if (['stopped', 'shutdown', 'interrupted', 'killed'].includes(String(value))) return 'stopped'
  return 'unknown'
}

/** Consume only explicit provider subagent events; never infer agents from arbitrary commands. */
export function updateSubagents(
  current: Subagent[],
  provider: string,
  payload: unknown,
  now: string,
  method?: string,
  rootThreadId?: string,
): Subagent[] {
  const event = object(payload),
    item = object(event.item)
  let next = current
  const put = (id: string, fields: Partial<Subagent>) => {
    const previous = next.find(
      (agent) =>
        agent.id === id &&
        agent.provider === provider &&
        agent.source !== 'dovo' &&
        (!rootThreadId || !agent.sessionId || agent.sessionId === rootThreadId),
    )
    const agent: Subagent = {
      id,
      provider,
      name: id,
      status: 'unknown',
      startedAt: now,
      ...previous,
      ...fields,
      updatedAt: now,
      sessionLive: rootThreadId !== undefined || previous?.sessionLive,
      sessionId: rootThreadId ?? previous?.sessionId,
    }
    if (agent.status === 'working' && previous?.finishedAt) {
      agent.startedAt = now
      agent.result = undefined
      agent.completion = undefined
      agent.completionId = undefined
    }
    if (agent.status === 'working') agent.finishedAt = undefined
    else if (agent.status !== 'unknown') agent.finishedAt = previous?.finishedAt ?? now
    next = [...next.filter((entry) => entry !== previous), agent]
  }
  if (method === 'dovo/session/closed')
    return current.map((agent) =>
      agent.provider === provider &&
      agent.source !== 'dovo' &&
      (!rootThreadId || !agent.sessionId || agent.sessionId === rootThreadId)
        ? {
            ...agent,
            sessionLive: false,
            status:
              nativeAgentWorking(agent) || agent.status === 'working' ? 'stopped' : agent.status,
            finishedAt:
              nativeAgentWorking(agent) || agent.status === 'working' ? now : agent.finishedAt,
            updatedAt: now,
          }
        : agent,
    )
  const childId = text(event.threadId)
  if (
    provider === 'codex' &&
    childId &&
    (current.some(
      (agent) => agent.provider === provider && agent.id === childId && agent.source !== 'dovo',
    ) ||
      (rootThreadId && childId !== rootThreadId))
  ) {
    if (method === 'thread/tokenUsage/updated') {
      const tokens = number(object(object(event.tokenUsage).total).totalTokens)
      if (tokens !== undefined)
        put(childId, {
          tokens,
        })
    }
    if (method === 'item/started') {
      const activity = text(item.type)
      if (activity)
        put(childId, {
          activity,
          status: 'working',
        })
    }
    if (method === 'turn/completed') {
      const turn = object(event.turn)
      put(childId, {
        status: status(turn.status),
        activity: text(object(turn.error).message),
      })
    }
    if (method === 'item/completed' && item.type === 'agentMessage' && text(item.text))
      put(childId, { result: String(item.text).slice(-64000) })
  }
  if (provider === 'codex' && item.type === 'collabAgentToolCall') {
    const states = object(item.agentsStates)
    const ids = new Set([
      ...(decodeResult(mutableArray(Schema.String), item.receiverThreadIds).data ?? []),
      ...Object.keys(states),
    ])
    for (const id of ids) {
      if (id === rootThreadId) continue
      const state = object(states[id])
      const previous = next.find(
        (agent) => agent.id === id && agent.provider === provider && agent.source !== 'dovo',
      )
      const fields: Partial<Subagent> = {}
      if (text(item.senderThreadId)) fields.parentId = text(item.senderThreadId)
      if (state.status) fields.status = status(state.status)
      else if (!previous) fields.status = 'unknown'
      if (text(state.message)) {
        fields.activity = text(state.message)
        if (fields.status === 'completed') fields.result = text(state.message)?.slice(-64000)
      }
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
  if (
    provider === 'claude' &&
    event.type === 'system' &&
    event.subtype === 'background_tasks_changed'
  ) {
    const tasks = decodeResult(mutableArray(record), event.tasks).data
    if (!tasks) return next
    const live = new Set<string>()
    for (const task of tasks) {
      const id = text(task.task_id)
      if (!id || task.task_type !== 'local_agent' || task.ambient === true) continue
      live.add(id)
      put(id, { name: text(task.description) ?? id, status: 'working', background: true })
    }
    for (const agent of next)
      if (
        agent.provider === provider &&
        agent.source !== 'dovo' &&
        agent.background &&
        agent.status === 'working' &&
        !live.has(agent.id)
      )
        put(agent.id, { status: 'unknown', background: false })
  }
  if (provider === 'claude' && event.type === 'system' && text(event.task_id)) {
    const id = String(event.task_id),
      previous = next.find(
        (agent) => agent.id === id && agent.provider === provider && agent.source !== 'dovo',
      )
    if (
      event.subtype === 'task_started' &&
      (event.task_type === 'local_agent' || text(event.subagent_type)) &&
      event.ambient !== true &&
      event.skip_transcript !== true
    ) {
      put(id, {
        name: text(event.description) ?? text(event.subagent_type) ?? id,
        status: 'working',
        background:
          typeof event.is_backgrounded === 'boolean' ? event.is_backgrounded : previous?.background,
        prompt: text(event.prompt),
      })
    } else if (previous && event.subtype === 'task_updated') {
      const patch = object(event.patch)
      put(id, {
        status: patch.status ? status(patch.status) : previous.status,
        name: text(patch.description) ?? previous.name,
        activity: text(patch.error) ?? previous.activity,
        background:
          typeof patch.is_backgrounded === 'boolean' ? patch.is_backgrounded : previous.background,
      })
    } else if (previous && ['task_progress', 'task_notification'].includes(String(event.subtype))) {
      const usage = object(event.usage)
      put(id, {
        status: event.subtype === 'task_progress' ? 'working' : status(event.status),
        activity: text(event.summary) ?? text(event.last_tool_name) ?? text(event.description),
        tokens: number(usage.total_tokens) ?? previous.tokens,
        durationMs: number(usage.duration_ms) ?? previous.durationMs,
        ...(event.subtype === 'task_notification'
          ? { result: text(event.summary)?.slice(-64000) }
          : {}),
      })
    }
  }
  if (provider === 'opencode') {
    const properties = object(event.properties)
    const data = object(event.data)
    const info = Object.keys(data).length ? data : object(properties.info)
    const parent = text(info.parentID)
    const id = text(info.sessionID) ?? text(info.id)
    if (
      id &&
      parent &&
      (parent === rootThreadId ||
        next.some((agent) => agent.provider === provider && agent.id === parent))
    )
      put(id, { parentId: parent, name: text(info.title) ?? id })
    const child = text(data.sessionID) ?? text(properties.sessionID)
    const previous = next.find(
      (agent) => agent.provider === provider && agent.id === child && agent.source !== 'dovo',
    )
    if (child && previous) {
      if (method === 'session.execution.started') put(child, { status: 'working' })
      if (method === 'session.execution.succeeded' || method === 'session.idle')
        put(child, { status: 'completed' })
      if (method === 'session.execution.failed' || method === 'session.error')
        put(child, {
          status: 'failed',
          activity: text(object(data.error ?? properties.error).message),
        })
      if (method === 'session.execution.interrupted') put(child, { status: 'stopped' })
      if (method === 'session.status')
        put(child, {
          status:
            object(properties.status ?? data.status).type === 'idle' ? 'completed' : 'working',
        })
      if (method === 'session.text.ended')
        put(child, { result: ((previous.result ?? '') + (text(data.text) ?? '')).slice(-64000) })
      const part = object(properties.part)
      if (method === 'message.part.updated' && part.type === 'text')
        put(child, { result: text(part.text)?.slice(-64000) })
    }
  }
  if (provider === 'acp') {
    const update = object(event.update)
    const child = update
    if (update.sessionUpdate === 'subagent_update' && text(child.sessionId)) {
      const state = object(child.state)
      const fields: Partial<Subagent> = { parentId: text(event.sessionId) }
      if ('title' in child) fields.name = text(child.title) ?? String(child.sessionId)
      if ('description' in child) fields.prompt = text(child.description)
      if ('state' in child)
        fields.status =
          state.state === 'idle'
            ? state.stopReason === 'cancelled'
              ? 'stopped'
              : 'completed'
            : ['running', 'requires_action'].includes(String(state.state))
              ? 'working'
              : 'unknown'
      put(String(child.sessionId), fields)
    }
    const id = text(event.sessionId)
    const previous = next.find(
      (agent) => agent.provider === provider && agent.id === id && agent.source !== 'dovo',
    )
    if (
      id &&
      previous &&
      update.sessionUpdate === 'agent_message_chunk' &&
      object(update.content).type === 'text'
    )
      put(id, {
        result: ((previous.result ?? '') + (text(object(update.content).text) ?? '')).slice(-64000),
      })
  }
  if (provider === 'muse' && item.kind === 'subagent' && text(item.subagentId)) {
    const control = text(item.controlStatus)
    put(String(item.subagentId), {
      name: text(item.agentPath) ?? text(item.role) ?? String(item.subagentId),
      status: ['accepted', 'starting', 'running', 'closing', 'recoveryPending'].includes(
        control ?? '',
      )
        ? 'working'
        : control === 'resultReady'
          ? 'completed'
          : control === 'closed'
            ? 'stopped'
            : 'unknown',
      activity: text(item.failureReason) ?? text(item.fallbackText),
      result: (text(object(item.result).text) ?? text(object(item.result).summary))?.slice(-64000),
      durationMs: number(item.durationMs),
    })
  }
  return next
}
