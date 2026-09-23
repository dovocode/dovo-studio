import { expect, it } from 'vitest'
import { updateSubagents } from './subagents'
const now = '2026-09-23T00:00:00Z'
it('merges Codex spawn, activity and completion by agent ID without inventing usage', () => {
  const spawned = updateSubagents(
    [],
    'codex',
    {
      item: {
        type: 'collabAgentToolCall',
        tool: 'spawnAgent',
        receiverThreadIds: ['child'],
        senderThreadId: 'parent',
        model: 'model',
        reasoningEffort: 'high',
        prompt: 'Review files',
        agentsStates: { child: { status: 'running' } },
      },
    },
    now,
  )
  const named = updateSubagents(
    spawned,
    'codex',
    {
      item: {
        type: 'subAgentActivity',
        agentThreadId: 'child',
        agentPath: '/root/reviewer',
        kind: 'started',
      },
    },
    now,
  )
  const finished = updateSubagents(
    named,
    'codex',
    {
      item: {
        type: 'collabAgentToolCall',
        tool: 'wait',
        receiverThreadIds: ['child'],
        agentsStates: { child: { status: 'completed', message: 'Review complete' } },
      },
    },
    '2026-09-23T00:01:00Z',
  )
  expect(finished).toHaveLength(1)
  expect(finished[0]).toMatchObject({
    name: '/root/reviewer',
    model: 'model',
    reasoning: 'high',
    status: 'completed',
    activity: 'Review complete',
    startedAt: now,
    finishedAt: '2026-09-23T00:01:00Z',
  })
  expect(finished[0]?.tokens).toBeUndefined()
  expect(updateSubagents(finished, 'codex', { delta: 'not an agent' }, now)).toBe(finished)
})
it('distinguishes Claude agents from background shell tasks and preserves reported usage', () => {
  expect(
    updateSubagents(
      [],
      'claude',
      { type: 'system', subtype: 'task_started', task_type: 'local_bash', task_id: 'shell' },
      now,
    ),
  ).toEqual([])
  const started = updateSubagents(
    [],
    'claude',
    {
      type: 'system',
      subtype: 'task_started',
      task_type: 'local_agent',
      task_id: 'agent',
      description: 'Review API',
    },
    now,
  )
  const progress = updateSubagents(
    started,
    'claude',
    {
      type: 'system',
      subtype: 'task_progress',
      task_id: 'agent',
      summary: 'Reading files',
      usage: { total_tokens: 1200, duration_ms: 8000 },
    },
    now,
  )
  const ended = updateSubagents(
    progress,
    'claude',
    {
      type: 'system',
      subtype: 'task_notification',
      task_id: 'agent',
      status: 'failed',
      summary: 'Connection lost',
    },
    now,
  )
  expect(ended[0]).toMatchObject({
    name: 'Review API',
    status: 'failed',
    tokens: 1200,
    durationMs: 8000,
    activity: 'Connection lost',
  })
})
it('keeps unreported state unknown and handles interruption and resume', () => {
  const unknown = updateSubagents(
    [],
    'codex',
    { item: { type: 'collabAgentToolCall', receiverThreadIds: ['child'], status: 'completed' } },
    now,
  )
  expect(unknown[0]?.status).toBe('unknown')
  const stopped = updateSubagents(
    unknown,
    'codex',
    { item: { type: 'subAgentActivity', agentThreadId: 'child', kind: 'interrupted' } },
    now,
  )
  expect(stopped[0]?.status).toBe('stopped')
  const resumed = updateSubagents(
    stopped,
    'codex',
    { item: { type: 'subAgentActivity', agentThreadId: 'child', kind: 'started' } },
    now,
  )
  expect(resumed[0]?.status).toBe('working')
  expect(resumed[0]?.finishedAt).toBeUndefined()
})
it('accepts token usage only for identified child threads, never parent totals', () => {
  const started = updateSubagents(
    [],
    'codex',
    {
      item: {
        type: 'subAgentActivity',
        agentThreadId: 'child',
        agentPath: '/root/child',
        kind: 'started',
      },
    },
    now,
  )
  const payload = { threadId: 'child', tokenUsage: { total: { totalTokens: 12345 } } }
  expect(
    updateSubagents(started, 'codex', payload, now, 'thread/tokenUsage/updated')[0]?.tokens,
  ).toBe(12345)
  expect(
    updateSubagents(
      started,
      'codex',
      { ...payload, threadId: 'parent' },
      now,
      'thread/tokenUsage/updated',
    ),
  ).toBe(started)
})
