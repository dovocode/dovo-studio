import { createHash } from 'node:crypto'
import { decodeResult, type Subagent, type Workflow } from '@dovo/protocol'
import { Schema } from 'effect'
import { join } from 'node:path'

const record = Schema.Record(Schema.String, Schema.Unknown)
const object = (value: unknown) => decodeResult(record, value).data ?? {}
const text = (value: unknown) => (typeof value === 'string' && value.length ? value : undefined)
const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
const instant = (value: unknown) => {
  const ms = count(value)
  return ms !== undefined && ms <= 8_640_000_000_000_000 ? new Date(ms).toISOString() : undefined
}

export function hasClaudeWorkflowProgress(payload: unknown) {
  const entries = object(payload).workflow_progress
  return (
    Array.isArray(entries) &&
    entries.some((raw) => {
      const entry = object(raw)
      return (
        count(entry.index) !== undefined &&
        ((entry.type === 'workflow_phase' && !!text(entry.title)) ||
          (entry.type === 'workflow_agent' && !!text(entry.label)))
      )
    })
  )
}

/** Translate Claude telemetry into the same workflow and member records used by other harnesses. */
export function updateClaudeWorkflows(
  current: Subagent[],
  payload: unknown,
  now: string,
  sessionId?: string,
) {
  const event = object(payload)
  let next = current
  const owned = (agent: Subagent) =>
    agent.provider === 'claude' &&
    agent.source !== 'dovo' &&
    (!sessionId || !agent.sessionId || agent.sessionId === sessionId)
  const put = (agent: Subagent) => {
    next = [...next.filter((entry) => !(owned(entry) && entry.id === agent.id)), agent]
  }
  let coordinator = next.find(
    (agent) => owned(agent) && agent.id === event.task_id && !!agent.workflow,
  )
  const runId = text(event.run_id)
  // New SDKs order task run IDs. Ignore late telemetry from a prior run.
  if (coordinator?.workflowRunId && runId && runId < coordinator.workflowRunId) return next
  if (
    event.subtype === 'task_started' &&
    coordinator?.finishedAt &&
    runId &&
    runId === coordinator.workflowRunId
  )
    return next
  const starts =
    event.type === 'system' &&
    event.subtype === 'task_started' &&
    event.task_type === 'local_workflow' &&
    event.ambient !== true &&
    event.skip_transcript !== true
  if (
    starts ||
    (!coordinator &&
      event.type === 'system' &&
      hasClaudeWorkflowProgress(event) &&
      text(event.task_id))
  ) {
    const id = String(event.task_id)
    const previous = next.find((agent) => owned(agent) && agent.id === id)
    const restarted =
      !!previous?.finishedAt ||
      (!!runId && !!previous?.workflowRunId && runId !== previous.workflowRunId)
    if (restarted && previous?.workflow) {
      // Preserve the old run's plan and members under its own coordinator identity.
      put({
        ...previous,
        id: previous.workflow.id,
        status: previous.finishedAt ? previous.status : 'stopped',
        finishedAt: previous.finishedAt ?? now,
      })
      for (const member of next.filter(
        (agent) => owned(agent) && agent.workflowId === previous.workflow?.id && !agent.finishedAt,
      ))
        put({ ...member, status: 'stopped', queued: false, finishedAt: now, updatedAt: now })
    }
    const workflow: Workflow =
      !restarted && previous?.workflow
        ? {
            ...previous.workflow,
            name: (text(event.workflow_name) ?? previous.workflow.name).slice(0, 200),
          }
        : {
            id: `claude:${createHash('sha256')
              .update(JSON.stringify([sessionId, id, runId ?? now]))
              .digest('hex')}`,
            name: (text(event.workflow_name) ?? text(event.description) ?? 'Workflow').slice(
              0,
              200,
            ),
            phases: [],
            members: [],
          }
    coordinator = {
      id,
      provider: 'claude',
      name: workflow.name,
      status: 'working',
      startedAt: now,
      ...(!restarted ? previous : undefined),
      workflow,
      workflowRunId: runId ?? previous?.workflowRunId,
      nativeToolUseId:
        text(event.tool_use_id) ?? (!restarted ? previous?.nativeToolUseId : undefined),
      prompt: text(event.prompt) ?? previous?.prompt,
      sessionId,
      sessionLive: true,
      updatedAt: now,
      finishedAt: undefined,
    }
    put(coordinator)
  }
  // A launch ACK supplies the transcript directory; progress frames do not.
  const ack = object(event.tool_use_result)
  if (ack.taskType === 'local_workflow') {
    const blocks = object(event.message).content
    const toolIds = Array.isArray(blocks)
      ? blocks.map((block) => text(object(block).tool_use_id)).filter(Boolean)
      : []
    const candidate = next.find(
      (agent) =>
        owned(agent) &&
        agent.workflow &&
        (agent.id === ack.taskId || toolIds.includes(agent.nativeToolUseId)),
    )
    if (candidate) {
      coordinator = {
        ...candidate,
        transcriptDirectory: text(ack.transcriptDir) ?? candidate.transcriptDirectory,
        updatedAt: now,
      }
      put(coordinator)
    }
  }
  if (!coordinator?.workflow) return next
  let workflow = coordinator.workflow
  if (event.type === 'system') {
    const patch = object(event.patch)
    const reported =
      event.subtype === 'task_notification'
        ? event.status
        : event.subtype === 'task_updated'
          ? patch.status
          : undefined
    const terminal =
      reported === 'completed'
        ? 'completed'
        : reported === 'failed'
          ? 'failed'
          : ['stopped', 'killed', 'interrupted', 'cancelled'].includes(String(reported))
            ? 'stopped'
            : undefined
    const usage = object(event.usage)
    coordinator = {
      ...coordinator,
      workflowRunId: runId ?? coordinator.workflowRunId,
      background:
        typeof event.is_backgrounded === 'boolean'
          ? event.is_backgrounded
          : typeof patch.is_backgrounded === 'boolean'
            ? patch.is_backgrounded
            : coordinator.background,
      status: terminal ?? coordinator.status,
      finishedAt: terminal ? (coordinator.finishedAt ?? now) : coordinator.finishedAt,
      result:
        event.subtype === 'task_notification'
          ? (text(event.summary)?.slice(-64000) ?? coordinator.result)
          : coordinator.result,
      activity: text(event.summary) ?? text(event.description) ?? coordinator.activity,
      tokens: count(usage.total_tokens) ?? coordinator.tokens,
      durationMs: count(usage.duration_ms) ?? coordinator.durationMs,
    }
  }
  const phases = new Map(workflow.phases.map((phase) => [phase.id, phase]))
  const members = new Map(workflow.members.map((member) => [member.id, member]))
  for (const raw of Array.isArray(event.workflow_progress) ? event.workflow_progress : []) {
    const entry = object(raw),
      index = count(entry.index)
    if (index === undefined) continue
    if (entry.type === 'workflow_phase' && text(entry.title)) {
      phases.set(String(index), { id: String(index), title: String(entry.title).slice(0, 200) })
      continue
    }
    if (entry.type !== 'workflow_agent' || !text(entry.label)) continue
    const id = `${workflow.id}:member:${index}`
    const previous = next.find((agent) => owned(agent) && agent.id === id)
    const attempt = count(entry.attempt) ?? previous?.attempt ?? 1
    if (previous?.attempt !== undefined && attempt < previous.attempt) continue
    const restarted = !!previous && attempt > (previous.attempt ?? 1)
    const queued =
      entry.state === 'queued' ||
      (entry.state === 'start' && instant(entry.startedAt) === undefined)
    const state: Subagent['status'] =
      entry.state === 'done'
        ? 'completed'
        : entry.state === 'error'
          ? 'failed'
          : queued
            ? 'unknown'
            : entry.state === 'start'
              ? 'working'
              : 'unknown'
    const regressed =
      !restarted &&
      previous &&
      ((['completed', 'failed', 'stopped'].includes(previous.status) &&
        state !== previous.status) ||
        (previous.status === 'working' && queued))
    if (regressed) continue
    const phaseId = count(entry.phaseIndex)?.toString() ?? members.get(id)?.phaseId ?? 'unphased'
    if (!phases.has(phaseId))
      phases.set(phaseId, {
        id: phaseId,
        title: (text(entry.phaseTitle) ?? 'Agents').slice(0, 200),
      })
    members.set(id, { id, phaseId })
    const agentId = text(entry.agentId)
    const transcript =
      agentId && /^[\w-]+$/.test(agentId) && coordinator.transcriptDirectory
        ? join(coordinator.transcriptDirectory, `agent-${agentId}.jsonl`)
        : undefined
    put({
      id,
      provider: 'claude',
      ...(!restarted ? previous : undefined),
      name: String(entry.label).slice(0, 1000),
      workflowId: workflow.id,
      parentId: coordinator.id,
      sessionId,
      sessionLive: true,
      status: state,
      queued,
      attempt,
      canStopIndividual: false,
      threadId: transcript ?? agentId ?? (!restarted ? previous?.threadId : undefined),
      model: text(entry.model) ?? (!restarted ? previous?.model : undefined),
      prompt:
        text(entry.promptPreview)?.slice(0, 20000) ?? (!restarted ? previous?.prompt : undefined),
      result:
        text(entry.resultPreview)?.slice(-64000) ?? (!restarted ? previous?.result : undefined),
      tokens: count(entry.tokens) ?? (!restarted ? previous?.tokens : undefined),
      durationMs: count(entry.durationMs) ?? (!restarted ? previous?.durationMs : undefined),
      activity: queued ? 'Queued' : text(entry.lastToolName),
      startedAt: instant(entry.startedAt) ?? (!restarted ? previous?.startedAt : undefined) ?? now,
      updatedAt: now,
      finishedAt:
        state === 'completed' || state === 'failed'
          ? (instant(entry.lastProgressAt) ?? now)
          : undefined,
    })
  }
  workflow = {
    ...workflow,
    phases: [...phases.values()].slice(0, 50),
    members: [...members.values()].slice(0, 200),
  }
  coordinator = { ...coordinator, workflow, updatedAt: now }
  put(coordinator)
  // ACKs can follow the first progress frame. Bind paths without replacing member identities.
  if (coordinator.transcriptDirectory) {
    for (const agent of next.filter(
      (agent) =>
        owned(agent) &&
        agent.workflowId === workflow.id &&
        agent.threadId &&
        /^[\w-]+$/.test(agent.threadId),
    )) {
      put({
        ...agent,
        threadId: join(coordinator.transcriptDirectory, `agent-${agent.threadId}.jsonl`),
      })
    }
  }
  if (coordinator.finishedAt) {
    for (const agent of next.filter(
      (agent) => owned(agent) && agent.workflowId === workflow.id && !agent.finishedAt,
    ))
      put({
        ...agent,
        status:
          coordinator.status === 'failed' || coordinator.status === 'stopped'
            ? coordinator.status
            : 'unknown',
        queued: false,
        finishedAt: now,
        updatedAt: now,
        activity: 'Workflow ended before this member reported a result',
      })
  }
  return next
}
