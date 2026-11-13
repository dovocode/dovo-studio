import { expect, it } from 'vite-plus/test'
import { decode, subagentSchema, nativeAgentWorking, type Subagent } from '@dovo/protocol'
import { updateSubagents } from '../../execution/subagents'

const now = '2026-11-13T10:00:00.000Z'
const apply = (current: Subagent[], event: Record<string, unknown>) =>
  updateSubagents(
    current,
    'claude',
    { type: 'system', task_id: 'flow', ...event },
    now,
    'system',
    'session',
  )
const start = () =>
  apply([], {
    subtype: 'task_started',
    task_type: 'local_workflow',
    workflow_name: 'Review',
    tool_use_id: 'launch',
    run_id: '001',
    prompt: 'export const meta = {}',
  })
const progress = (state: string, extra: Record<string, unknown> = {}) => ({
  subtype: 'task_progress',
  run_id: '001',
  workflow_progress: [
    { type: 'workflow_phase', index: 0, title: 'Inspect' },
    {
      type: 'workflow_agent',
      index: 0,
      label: 'Read API',
      phaseIndex: 0,
      state,
      agentId: 'reader',
      ...extra,
    },
  ],
})

it('projects native phases, queued members, late launch ACKs and final status into stable records', () => {
  const started = start()
  expect(started[0]?.workflow?.name).toBe('Review')
  const queued = apply(started, progress('start'))
  const member = queued.find((agent) => agent.workflowId)
  expect(member).toMatchObject({ status: 'unknown', queued: true, canStopIndividual: false })
  const acknowledged = updateSubagents(
    queued,
    'claude',
    {
      type: 'user',
      tool_use_result: {
        taskType: 'local_workflow',
        transcriptDir: '/config/projects/session/workflow/run',
      },
      message: { content: [{ type: 'tool_result', tool_use_id: 'launch' }] },
    },
    now,
    'user',
    'session',
  )
  expect(acknowledged.find((agent) => agent.workflowId)?.threadId).toBe(
    '/config/projects/session/workflow/run/agent-reader.jsonl',
  )
  const running = apply(acknowledged, progress('start', { startedAt: Date.parse(now), tokens: 12 }))
  expect(running.find((agent) => agent.workflowId)).toMatchObject({
    id: member?.id,
    status: 'working',
    queued: false,
    tokens: 12,
  })
  const done = apply(
    running,
    progress('done', { resultPreview: 'API checked', lastProgressAt: Date.parse(now) + 1000 }),
  )
  const ended = apply(done, {
    subtype: 'task_notification',
    run_id: '001',
    status: 'completed',
    summary: 'Reviewed',
  })
  expect(ended.every((agent) => !nativeAgentWorking(agent))).toBe(true)
  expect(
    apply(ended, { subtype: 'task_started', task_type: 'local_workflow', run_id: '001' }),
  ).toBe(ended)
  expect(ended.find((agent) => agent.workflowId)).toMatchObject({
    id: member?.id,
    status: 'completed',
    result: 'API checked',
  })
  for (const agent of ended) expect(() => decode(subagentSchema, agent)).not.toThrow()
})

it('ignores regressed attempts and old run events, and clears old results on a retry', () => {
  const done = apply(start(), progress('done', { attempt: 1, resultPreview: 'Old result' }))
  const retry = apply(done, progress('start', { attempt: 2, startedAt: Date.parse(now) }))
  const member = retry.find((agent) => agent.workflowId)
  expect(member).toMatchObject({ attempt: 2, status: 'working' })
  expect(member?.result).toBeUndefined()
  expect(
    apply(retry, progress('done', { attempt: 1, resultPreview: 'Stale' })).find(
      (agent) => agent.workflowId,
    ),
  ).toEqual(member)
  const ended = apply(retry, { subtype: 'task_notification', status: 'completed', run_id: '001' })
  const restarted = apply(ended, {
    subtype: 'task_started',
    task_type: 'local_workflow',
    workflow_name: 'New review',
    run_id: '002',
  })
  expect(restarted.filter((agent) => agent.workflow)).toHaveLength(2)
  expect(apply(restarted, { ...progress('done'), run_id: '001' })).toBe(restarted)
  const newProgress = apply(restarted, {
    ...progress('start', { startedAt: Date.parse(now) }),
    run_id: '002',
  })
  expect(newProgress.find((agent) => agent.workflowId && !agent.finishedAt)?.id).not.toBe(
    member?.id,
  )
})

it('does not leave queued members working after a failed coordinator or closed session', () => {
  const queued = apply(start(), progress('queued'))
  const failed = apply(queued, { subtype: 'task_notification', status: 'failed' })
  expect(failed.find((agent) => agent.workflowId)).toMatchObject({
    status: 'failed',
    queued: false,
  })
  expect(failed.some(nativeAgentWorking)).toBe(false)
  const closed = updateSubagents(queued, 'claude', {}, now, 'dovo/session/closed', 'session')
  expect(closed.some(nativeAgentWorking)).toBe(false)
  expect(closed.find((agent) => agent.workflowId)).toMatchObject({
    queued: false,
    status: 'stopped',
  })
})

it('does not classify ordinary task progress with an empty workflow field as a workflow', () => {
  const agent = apply([], {
    subtype: 'task_started',
    task_type: 'local_agent',
    description: 'Ordinary child',
  })
  const progressed = apply(agent, {
    subtype: 'task_progress',
    workflow_progress: [],
    usage: { total_tokens: 42 },
  })
  expect(progressed).toHaveLength(1)
  expect(progressed[0]).toMatchObject({ name: 'Ordinary child', tokens: 42 })
  expect(progressed[0]?.workflow).toBeUndefined()
})
