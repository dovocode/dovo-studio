import { afterEach, expect, it, vi } from 'vite-plus/test'
import { join } from 'node:path'
import {
  taskFailureVersion,
  threadFailureKey,
  nativeFailureKey,
  decode,
  threadWatchSnapshotSchema,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration } from '../testing/integration.js'
import { threadSnapshot } from './thread-snapshot.js'

vi.setConfig(runtimeIntegration)
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})
const ownerToken = 'subagent-failure-test-owner-token-at-least-32'
async function setup() {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const options = { databasePath: join(f.directory, 'runtime.sqlite'), ownerToken, port: 0 }
  let runtime = await startRuntime(options)
  cleanups.push(async () => {
    await runtime.close()
  })
  const s = runtime.services
  s.store.update(() => f.workspace)
  s.preferences.save({ enableStudioThreads: true })
  const parent = s.tasks.create({
    title: 'Coordinator',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const child = s.tasks.create({
    title: 'Child',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  s.store.updateTask(child.id, (task) => ({
    ...task,
    status: 'failed',
    error: 'Provider stopped',
    runAttempt: { runId: 'run-1', inputMessageIds: [], promptAccepted: true },
    delegation: { parentTaskId: parent.id, parentRunId: 'run', key: 'child' },
  }))
  return {
    s,
    parent,
    child,
    runtime,
    post: (key: string, token: string | null = ownerToken) =>
      fetch('http://127.0.0.1:' + runtime.port + '/api/tasks/acknowledge-subagent-failure', {
        method: 'POST',
        headers: {
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: parent.id, key }),
      }),
    restart: async () => {
      await runtime.close()
      runtime = await startRuntime(options)
      return runtime.services
    },
  }
}

it('authenticates failure acknowledgement, persists it, and rejects stale or unrelated failures', async () => {
  const f = await setup()
  const child = f.s.store.taskSummary(f.child.id)
  const key = threadFailureKey(f.s.runtimeId, child.id, taskFailureVersion(child))
  expect((await f.post(key, null)).status).toBe(401)
  expect((await f.post('0'.repeat(64))).status).toBe(409)
  expect((await f.post(key)).status).toBe(200)
  expect((await f.post(key)).status).toBe(200)
  expect(f.s.store.taskSummary(f.parent.id).acknowledgedSubagentFailures).toEqual([key])
  const s = await f.restart()
  expect(s.store.taskSummary(f.parent.id).acknowledgedSubagentFailures).toEqual([key])
  // Finalization and ordinary metadata changes belong to the same failed execution.
  s.store.updateTask(child.id, (task) => ({
    ...task,
    runAttempt: undefined,
    title: 'Renamed failure',
  }))
  expect((await f.post(key)).status).toBe(200)
  s.store.updateTask(child.id, (task) => ({ ...task, status: 'running' }))
  s.store.updateTask(child.id, (task) => ({ ...task, status: 'failed', error: 'Provider stopped' }))
  expect((await f.post(key)).status).toBe(409)
  const newer = threadFailureKey(
    s.runtimeId,
    child.id,
    taskFailureVersion(s.store.taskSummary(child.id)),
  )
  expect((await f.post(newer)).status).toBe(200)
})

it('acknowledges native failures with owner-scoped identities', async () => {
  const f = await setup()
  const agent = {
    id: 'native',
    name: 'Native',
    provider: 'codex' as const,
    status: 'failed' as const,
    startedAt: 'start',
    updatedAt: 'end',
    finishedAt: 'end',
  }
  f.s.store.updateTask(f.child.id, (task) => ({ ...task, subagents: [agent] }))
  expect((await f.post(nativeFailureKey(f.parent.id, agent))).status).toBe(409)
  expect((await f.post(nativeFailureKey(f.child.id, agent))).status).toBe(200)
})

it('carries renderable descendants separately from active counts and preserves the requested root at the bound', async () => {
  const f = await setup()
  f.s.store.updateTask(f.parent.id, (task) => ({ ...task, title: 'P'.repeat(2000) }))
  const remote = {
    runtimeId: 'remote-id',
    title: 'Remote',
    status: 'failed',
    failureVersion: 'failure',
    phase: 'needs-input' as const,
    revision: 'r',
    attention: ['q'],
    watches: { pipelines: 2, pullRequests: 1, failures: 0 },
    entries: [
      {
        runtimeId: 'remote-id',
        threadId: 'remote',
        title: 'Remote',
        status: 'failed',
        phase: 'completed' as const,
        revision: 'r',
        attention: [],
        watches: { pipelines: 2, pullRequests: 0, failures: 0 },
      },
      {
        runtimeId: 'remote-id',
        threadId: 'grandchild',
        title: 'Grandchild',
        parent: { runtimeId: 'remote-id', threadId: 'remote' },
        phase: 'needs-input' as const,
        revision: 'r',
        attention: ['q'],
        watches: { pipelines: 0, pullRequests: 1, failures: 0 },
      },
    ],
  }
  vi.spyOn(f.s.threadWatch, 'list').mockImplementation((id) =>
    id === f.parent.id
      ? [
          {
            runtimeId: 'remote-profile',
            threadId: 'remote',
            computerName: 'Server',
            relation: 'spawned',
            status: 'stopped',
            offline: false,
            snapshot: remote,
          },
        ]
      : [],
  )
  const snapshot = decode(threadWatchSnapshotSchema, threadSnapshot(f.s, f.parent.id))
  expect(snapshot.attention).toEqual([])
  expect(snapshot.watches).toEqual({ pipelines: 0, pullRequests: 0, failures: 0 })
  expect(snapshot.threads?.find((entry) => entry.threadId === 'grandchild')).toMatchObject({
    title: 'Grandchild',
    paused: true,
    parent: { runtimeId: 'remote-id', threadId: 'remote' },
  })
  expect(snapshot.threads?.find((entry) => entry.threadId === 'remote')?.parent).toMatchObject({
    runtimeId: f.s.runtimeId,
    threadId: f.parent.id,
  })
  f.s.preferences.save({ enableStudioThreads: false })
  expect(
    threadSnapshot(f.s, f.parent.id)
      .threads?.filter((entry) => entry.runtimeId === 'remote-id')
      .every((entry) => entry.paused),
  ).toBe(true)
  for (let i = 0; i < 205; i++) {
    const child = f.s.tasks.create({
      title: 'Child ' + i,
      repositoryId: 'repo',
      agentId: 'agent',
      objective: '',
    })
    f.s.store.updateTask(child.id, (task) => ({
      ...task,
      delegation: { parentTaskId: f.parent.id, parentRunId: 'run', key: 'child' + i },
    }))
  }
  const bounded = decode(threadWatchSnapshotSchema, threadSnapshot(f.s, f.parent.id))
  expect(bounded.threads).toHaveLength(200)
  expect(bounded.threads?.[0].threadId).toBe(f.parent.id)
  expect(bounded.partial).toBe(true)
})

it('publishes bounded private-free native summaries and changes revision for native execution outcomes', async () => {
  const f = await setup()
  const agent = {
    id: 'provider-agent',
    provider: 'codex' as const,
    name: 'Provider worker',
    status: 'working' as const,
    sessionLive: true,
    startedAt: 'start',
    updatedAt: 'start',
    prompt: 'private input',
    result: 'private result',
  }
  f.s.store.updateTask(f.child.id, (task) => ({ ...task, status: 'review', subagents: [agent] }))
  const before = decode(threadWatchSnapshotSchema, threadSnapshot(f.s, f.parent.id))
  expect(before.phase).toBe('running')
  expect(
    before.threads?.find((entry) => entry.threadId === f.child.id)?.nativeAgents,
  ).toMatchObject([{ working: true, name: 'Provider worker' }])
  f.s.store.updateTask(f.child.id, (task) => ({
    ...task,
    subagents: [{ ...agent, status: 'failed', finishedAt: 'end' }],
  }))
  const after = decode(threadWatchSnapshotSchema, threadSnapshot(f.s, f.parent.id))
  expect(after.revision).not.toBe(before.revision)
  const native = after.threads?.find((entry) => entry.threadId === f.child.id)?.nativeAgents
  expect(native).toMatchObject([{ status: 'failed', working: false }])
  expect(JSON.stringify(native)).not.toMatch(/private|prompt|result|sessionId/)
  expect((await f.post(native![0].key)).status).toBe(200)
  // Presentation changes do not resend a completed execution result.
  f.s.store.updateTask(f.child.id, (task) => ({
    ...task,
    subagents: task.subagents?.map((agent) => ({ ...agent, name: 'Renamed', updatedAt: 'later' })),
  }))
  expect(threadSnapshot(f.s, f.parent.id).revision).toBe(after.revision)
  f.s.store.updateTask(f.child.id, (task) => ({
    ...task,
    subagents: Array.from({ length: 45 }, (_, i) => ({
      ...agent,
      id: String(i),
      status: 'completed',
    })),
  }))
  const bounded = decode(threadWatchSnapshotSchema, threadSnapshot(f.s, f.parent.id))
  expect(bounded.partial).toBe(true)
  expect(
    bounded.threads?.find((entry) => entry.threadId === f.child.id)?.nativeAgents,
  ).toHaveLength(40)
})

it('authorizes only currently observed remote native failures without writing to the peer', async () => {
  const f = await setup()
  let key = 'a'.repeat(64)
  vi.spyOn(f.s.threadWatch, 'list').mockImplementation((id) =>
    id === f.parent.id
      ? [
          {
            runtimeId: 'foreign-profile',
            threadId: 'remote',
            computerName: 'Server',
            relation: 'spawned',
            status: 'watching',
            offline: false,
            snapshot: {
              runtimeId: 'remote-identity',
              title: 'Successful owner',
              phase: 'completed',
              status: 'review',
              revision: 'one',
              attention: [],
              watches: { pipelines: 0, pullRequests: 0, failures: 0 },
              nativeAgents: [{ key, name: 'Failed native', status: 'failed', working: false }],
            },
          },
        ]
      : [],
  )
  expect((await f.post(key)).status).toBe(200)
  expect((await f.post('b'.repeat(64))).status).toBe(409)
  const previous = key
  key = 'b'.repeat(64)
  expect((await f.post(previous)).status).toBe(409)
  expect((await f.post(key)).status).toBe(200)
})

it('keeps direct-owner presentation, attention and watch counts consistent over a stale propagated path', async () => {
  const f = await setup()
  const fact = {
    runtimeId: 'C',
    threadId: 'c',
    title: 'Stale C',
    parent: { runtimeId: 'B', threadId: 'b' },
    phase: 'completed' as const,
    revision: 'old',
    attention: [],
    watches: { pipelines: 99, pullRequests: 0, failures: 0 },
  }
  const base = {
    computerName: 'Server',
    relation: 'spawned' as const,
    status: 'watching' as const,
    offline: false,
  }
  const ancestor = {
    ...base,
    runtimeId: 'profile-b',
    threadId: 'b',
    lastSuccessAt: '2026-10-19',
    snapshot: {
      runtimeId: 'B',
      title: 'B',
      phase: 'completed' as const,
      revision: 'b',
      attention: [],
      watches: fact.watches,
      entries: [fact],
      threads: [fact],
    },
  }
  const fresh = {
    ...fact,
    title: 'Fresh C',
    phase: 'needs-input' as const,
    attention: ['question'],
    watches: { pipelines: 1, pullRequests: 0, failures: 0 },
  }
  const direct = {
    ...base,
    runtimeId: 'profile-c',
    threadId: 'c',
    lastSuccessAt: '2026-10-18',
    snapshot: { ...fresh, runtimeId: 'C', entries: [fresh], threads: [fresh] },
  }
  vi.spyOn(f.s.threadWatch, 'list').mockImplementation((id) =>
    id === f.parent.id ? [ancestor] : id === f.child.id ? [direct] : [],
  )
  const snapshot = decode(threadWatchSnapshotSchema, threadSnapshot(f.s, f.parent.id))
  expect(snapshot.threads?.find((entry) => entry.threadId === 'c')).toMatchObject({
    title: 'Fresh C',
    phase: 'needs-input',
  })
  expect(snapshot.watches.pipelines).toBe(1)
  expect(snapshot.phase).toBe('needs-input')
})

it('validates and persists overflow failure group acknowledgements and rejects a newer execution', async () => {
  const f = await setup()
  const agents = Array.from({ length: 41 }, (_, i) => ({
    id: String(i),
    name: 'Worker ' + i,
    provider: 'codex' as const,
    status: 'failed' as const,
    startedAt: 'start',
    updatedAt: 'end',
    finishedAt: 'end',
  }))
  f.s.store.updateTask(f.child.id, (task) => ({ ...task, status: 'review', subagents: agents }))
  const snapshot = decode(threadWatchSnapshotSchema, threadSnapshot(f.s, f.parent.id))
  const fact = snapshot.threads!.find((entry) => entry.threadId === f.child.id)!
  expect(fact.nativeAgentOverflow).toMatchObject({ total: 1, failed: 1, working: 0 })
  const key = fact.nativeAgentOverflow!.failureKey!
  expect((await f.post(key)).status).toBe(200)
  expect(f.s.store.taskSummary(f.parent.id).acknowledgedSubagentFailures).toContain(key)
  f.s.store.updateTask(f.child.id, (task) => ({
    ...task,
    subagents: agents.map((agent) =>
      agent.id === '40' ? { ...agent, finishedAt: 'new attempt' } : agent,
    ),
  }))
  expect((await f.post(key)).status).toBe(409)
  const next = threadSnapshot(f.s, f.parent.id).threads!.find(
    (entry) => entry.threadId === f.child.id,
  )!.nativeAgentOverflow!.failureKey!
  expect(next).not.toBe(key)
  // The same credential-free facts can be acknowledged through a saved remote branch.
  vi.spyOn(f.s.threadWatch, 'list').mockImplementation((id) =>
    id === f.parent.id
      ? [
          {
            runtimeId: 'foreign-profile',
            threadId: 'remote',
            computerName: 'Server',
            relation: 'spawned',
            status: 'completed',
            offline: false,
            snapshot: {
              ...snapshot,
              runtimeId: 'remote-identity',
              entries: undefined,
              threads: undefined,
              nativeAgents: fact.nativeAgents,
              nativeAgentOverflow: { ...fact.nativeAgentOverflow!, failureKey: 'd'.repeat(64) },
            },
          },
        ]
      : [],
  )
  expect((await f.post('d'.repeat(64))).status).toBe(200)
})
