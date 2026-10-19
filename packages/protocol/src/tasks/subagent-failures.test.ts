import { expect, it } from 'vite-plus/test'
import { decode } from '../shared/schema.js'
import { taskSchema } from '../workspace.js'
import { taskFailureVersion, nativeFailureKey, subagentVisible } from './subagent-failures.js'
import { taskParentReference } from './thread-parent.js'

const task = decode(taskSchema, {
  id: 'child',
  title: 'Child',
  repositoryId: '',
  agentId: '',
  status: 'failed',
  createdAt: '',
  draft: '',
  messages: [],
  files: [],
  example: false,
})
const failed = {
  id: 'native',
  name: 'Worker',
  provider: 'codex' as const,
  status: 'failed' as const,
  startedAt: 'start',
  updatedAt: 'end',
  finishedAt: 'end',
}

it('keeps native failures until acknowledged, without suppressing the next execution', () => {
  expect(subagentVisible(failed, true)).toBe(true)
  const legacy = { ...failed, finishedAt: undefined }
  expect(nativeFailureKey('owner', legacy)).toBe(
    nativeFailureKey('owner', { ...legacy, updatedAt: 'refresh' }),
  )
  expect(subagentVisible(failed, true, true)).toBe(false)
  expect(subagentVisible(failed, false, true)).toBe(true)
  expect(nativeFailureKey('owner', failed)).not.toBe(
    nativeFailureKey('owner', { ...failed, startedAt: 'retry' }),
  )
  expect(taskFailureVersion(task)).toBe(taskFailureVersion({ ...task }))
  expect(taskFailureVersion(task)).not.toBe(
    taskFailureVersion({
      ...task,
      runAttempt: { runId: 'run-2', inputMessageIds: [], promptAccepted: true },
    }),
  )
})

it('resolves direct links from persisted parent identity without a cached parent', () => {
  expect(
    taskParentReference(
      {
        ...task,
        spawnParent: { runtimeId: 'parent-identity', threadId: 'owner', title: 'Coordinator' },
      },
      'child-profile',
      [],
    ),
  ).toEqual({
    runtimeId: 'parent-identity',
    runtimeIdentity: 'parent-identity',
    threadId: 'owner',
    title: 'Coordinator',
  })
  expect(
    taskParentReference(
      { ...task, delegation: { parentTaskId: 'owner', parentRunId: 'run', key: 'key' } },
      'profile',
      [],
      'identity',
    ),
  ).toMatchObject({ runtimeId: 'profile', runtimeIdentity: 'identity', threadId: 'owner' })
})

it('infers legacy ownership only from explicit spawned relationships on the right computer', () => {
  const watch = {
    runtimeId: 'foreign-profile',
    threadId: task.id,
    computerName: 'Server',
    relation: 'spawned' as const,
    status: 'watching' as const,
    offline: false,
    snapshot: {
      runtimeId: 'child-identity',
      title: 'Child',
      phase: 'completed' as const,
      revision: '1',
      attention: [],
      watches: { pipelines: 0, pullRequests: 0, failures: 0 },
    },
  }
  const source = {
    runtimeId: 'parent-profile',
    runtimeIdentity: 'parent-identity',
    tasks: [{ ...task, id: 'owner', threadWatches: [watch] }],
  }
  expect(taskParentReference(task, 'child-profile', [], 'child-identity', [source])).toMatchObject({
    threadId: 'owner',
    runtimeIdentity: 'parent-identity',
  })
  expect(
    taskParentReference(task, 'unrelated-profile', [], 'unrelated-identity', [source]),
  ).toBeUndefined()
  expect(
    taskParentReference(task, 'child-profile', [], 'child-identity', [
      {
        ...source,
        tasks: [{ ...source.tasks[0], threadWatches: [{ ...watch, relation: 'linked' }] }],
      },
    ]),
  ).toBeUndefined()
})

it('bounds native summaries, prioritizes failures and running work, and excludes private payloads', async () => {
  const { threadNativeAgents } = await import('./subagent-failures.js')
  const agents = Array.from({ length: 50 }, (_, i) => ({
    ...failed,
    id: String(i),
    status: 'completed' as const,
    prompt: 'private prompt',
    result: 'private result',
  }))
  const working = {
    ...failed,
    id: 'working',
    status: 'working' as const,
    sessionLive: true,
    finishedAt: undefined,
  }
  const summaries = threadNativeAgents({
    id: 'owner',
    subagents: [...agents, failed, working, { ...failed, source: 'dovo' }],
  })
  expect(summaries).toHaveLength(40)
  expect(summaries[0]).toMatchObject({ name: 'Worker', status: 'failed', working: false })
  expect(summaries[1].working).toBe(true)
  expect(JSON.stringify(summaries)).not.toMatch(/private|prompt|result|sessionId/)
  expect(threadNativeAgents({ id: 'other-owner', subagents: [failed] })[0].key).not.toBe(
    summaries[0].key,
  )
})

it('reports bounded overflow facts with execution-specific failure acknowledgement', async () => {
  const { threadNativeAgents, threadNativeAgentOverflow } = await import('./subagent-failures.js')
  const task = {
    id: 'owner',
    subagents: Array.from({ length: 42 }, (_, i) => ({ ...failed, id: String(i) })),
  }
  const overflow = threadNativeAgentOverflow(task)!
  expect(overflow).toMatchObject({ total: 2, failed: 2, working: 0 })
  expect(overflow.failureKey).toHaveLength(64)
  expect(JSON.stringify(overflow)).not.toMatch(/prompt|result|sessionId/)
  const renamed = {
    ...task,
    subagents: task.subagents.map((agent) => ({ ...agent, name: 'Renamed', updatedAt: 'later' })),
  }
  expect(threadNativeAgentOverflow(renamed)).toEqual(overflow)
  task.subagents[41].finishedAt = 'retry'
  expect(threadNativeAgentOverflow(task)?.failureKey).not.toBe(overflow.failureKey)
  expect(threadNativeAgents(task)).toHaveLength(40)
})
