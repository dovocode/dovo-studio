import { expect, it } from 'vite-plus/test'
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
      output_file: '/tmp/provider/tasks/agent-transcript-id.output',
    },
    now,
  )
  expect(ended[0]).toMatchObject({
    name: 'Review API',
    status: 'failed',
    tokens: 1200,
    durationMs: 8000,
    activity: 'Connection lost',
    threadId: 'transcript-id',
  })
  const resumed = updateSubagents(
    ended,
    'claude',
    {
      type: 'system',
      subtype: 'task_started',
      task_type: 'local_agent',
      task_id: 'agent',
    },
    now,
  )
  expect(resumed[0].threadId).toBe('transcript-id')
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

it('discovers Codex children before a collaboration event and ignores root events', () => {
  const child = updateSubagents(
    [],
    'codex',
    { threadId: 'child', item: { type: 'commandExecution' } },
    now,
    'item/started',
    'root',
  )
  expect(child).toMatchObject([
    { id: 'child', status: 'working', sessionLive: true, activity: 'commandExecution' },
  ])
  expect(
    updateSubagents(
      child,
      'codex',
      { threadId: 'root', item: { type: 'commandExecution' } },
      now,
      'item/started',
      'root',
    ),
  ).toBe(child)
  const completed = updateSubagents(
    child,
    'codex',
    { threadId: 'child', turn: { status: 'completed' } },
    now,
    'turn/completed',
    'root',
  )
  expect(completed[0]?.status).toBe('completed')
})

it('recovers missed Claude agents and background jobs from its roster without ambient work', () => {
  const roster = {
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [
      { task_id: 'agent', task_type: 'local_agent', description: 'Explore' },
      { task_id: 'shell', task_type: 'local_bash', description: 'Build' },
      { task_id: 'ambient', task_type: 'local_agent', description: 'Watch', ambient: true },
    ],
  }
  const discovered = updateSubagents([], 'claude', roster, now, 'system', 'session')
  expect(discovered).toMatchObject([
    { id: 'agent', name: 'Explore', status: 'working', background: true, sessionLive: true },
    {
      id: 'shell',
      kind: 'background',
      name: 'Background: Build',
      status: 'working',
      background: true,
      sessionLive: true,
    },
  ])
  expect(discovered).toHaveLength(2)
  const patch = updateSubagents(
    discovered,
    'claude',
    {
      type: 'system',
      subtype: 'task_updated',
      task_id: 'agent',
      patch: { status: 'killed', error: 'Stopped', description: 'Review' },
    },
    now,
    'system',
    'session',
  )
  expect(patch.find((task) => task.id === 'agent')).toMatchObject({
    name: 'Review',
    status: 'stopped',
    activity: 'Stopped',
  })
  const removed = updateSubagents(
    discovered,
    'claude',
    { ...roster, tasks: [] },
    now,
    'system',
    'session',
  )
  expect(removed[0]).toMatchObject({ status: 'unknown', background: false })
  expect(
    updateSubagents(
      discovered,
      'claude',
      { ...roster, tasks: 'malformed' },
      now,
      'system',
      'session',
    ),
  ).toBe(discovered)
})

it('clears native liveness when a provider process closes without modifying Dovo-owned records', () => {
  const native = updateSubagents(
    [],
    'codex',
    { threadId: 'child', item: { type: 'commandExecution' } },
    now,
    'item/started',
    'root',
  )[0]
  const owned = { ...native, id: 'dovo-child', source: 'dovo' as const }
  const closed = updateSubagents([native, owned], 'codex', {}, now, 'dovo/session/closed')
  expect(closed[0]).toMatchObject({ status: 'stopped', sessionLive: false, finishedAt: now })
  expect(closed[1]).toBe(owned)
})

it('tracks an explicitly backgrounded Claude monitor through completion and session closure', () => {
  const started = updateSubagents(
    [],
    'claude',
    {
      type: 'system',
      subtype: 'task_started',
      task_type: 'local_bash',
      task_id: 'monitor',
      description: 'Watch test results',
      is_backgrounded: true,
    },
    now,
    'system',
    'session',
  )
  expect(started[0]).toMatchObject({
    kind: 'background',
    name: 'Background: Watch test results',
    status: 'working',
    background: true,
    sessionLive: true,
  })
  const finished = updateSubagents(
    started,
    'claude',
    {
      type: 'system',
      subtype: 'task_notification',
      task_id: 'monitor',
      status: 'completed',
      summary: 'Five cycles passed',
    },
    now,
    'system',
    'session',
  )
  expect(finished[0]).toMatchObject({
    status: 'completed',
    result: 'Five cycles passed',
    finishedAt: now,
  })
  expect(
    updateSubagents(started, 'claude', {}, now, 'dovo/session/closed', 'session')[0],
  ).toMatchObject({ status: 'stopped', sessionLive: false })
})

it('tracks distinct Copilot invocations, cancellation, failure and closed sessions', () => {
  let agents = updateSubagents(
    [],
    'copilot',
    {
      toolCallId: 'a',
      agentName: 'reviewer',
      agentDisplayName: 'Review code',
      agentDescription: 'Inspect changes',
      model: 'm',
      executionMode: 'background',
    },
    now,
    'subagent.started',
    'root',
  )
  agents = updateSubagents(
    agents,
    'copilot',
    {
      toolCallId: 'b',
      agentName: 'reviewer',
      agentDisplayName: 'Review tests',
      agentDescription: 'Inspect tests',
    },
    now,
    'subagent.started',
    'root',
  )
  agents = updateSubagents(
    agents,
    'copilot',
    { toolCallId: 'c', agentName: 'reviewer', agentDescription: 'More work' },
    now,
    'subagent.started',
    'root',
  )
  expect(agents).toHaveLength(3)
  expect(agents[0]).toMatchObject({
    id: 'a',
    name: 'Review code',
    prompt: 'Inspect changes',
    model: 'm',
    background: true,
    status: 'working',
    sessionId: 'root',
    sessionLive: true,
  })
  agents = updateSubagents(
    agents,
    'copilot',
    { toolCallId: 'a', totalTokens: 42, durationMs: 123 },
    now,
    'subagent.completed',
    'root',
  )
  agents = updateSubagents(
    agents,
    'copilot',
    { toolCallId: 'b', error: 'Failed tool' },
    now,
    'subagent.failed',
    'root',
  )
  agents = updateSubagents(
    agents,
    'copilot',
    { toolCallId: 'c', cancelled: true },
    now,
    'subagent.completed',
    'root',
  )
  expect(agents.find((a) => a.id === 'a')).toMatchObject({
    status: 'completed',
    tokens: 42,
    durationMs: 123,
  })
  expect(agents.find((a) => a.id === 'b')).toMatchObject({
    status: 'failed',
    result: 'Failed tool',
  })
  expect(agents.find((a) => a.id === 'c')).toMatchObject({ status: 'stopped' })
  expect(
    updateSubagents(
      agents,
      'copilot',
      { toolCallId: 'missing' },
      now,
      'subagent.completed',
      'root',
    ),
  ).toBe(agents)
  expect(updateSubagents(agents, 'copilot', {}, now, 'dovo/session/closed', 'other')).toEqual(
    agents,
  )
  const closed = updateSubagents(agents, 'copilot', {}, now, 'dovo/session/closed', 'root')
  expect(closed.every((a) => a.sessionLive === false)).toBe(true)
})
