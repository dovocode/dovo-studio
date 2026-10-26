import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { Schema } from 'effect'
import {
  decode,
  noStudioTools,
  resolveTaskAgent,
  buildThreadTree,
  threadFailureKey,
  taskFailureVersion,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration, waitForRuntime } from '../testing/integration.js'
import type { AgentAdapter, AgentRun } from '../agents/execution/types.js'
import { threadSnapshot } from './thread-snapshot.js'
import { MutationReceipts } from '../storage/mutation-receipts.js'
vi.setConfig(runtimeIntegration)
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close()
  vi.restoreAllMocks()
})
function barrier() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const owner = 'targeted-subagent-owner-token-at-least-32-chars'
const childSchema = Schema.Struct({
  id: Schema.String,
  runtimeId: Schema.String,
  threadId: Schema.String,
  running: Schema.Boolean,
  result: Schema.optional(Schema.String),
  offline: Schema.Boolean,
  stopRequested: Schema.optional(Schema.Boolean),
})
async function setup(readOnly = false) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({ databasePath: ':memory:', ownerToken: owner, port: 0 })
  const s = runtime.services
  cleanups.push(() => runtime.close())
  s.store.update(() => f.workspace)
  s.preferences.save({ enableStudioThreads: true })
  const scratch = await s.scratch.ensure()
  cleanups.push(async () => {
    await rm(s.scratch.root, { recursive: true, force: true })
  })
  const parent = s.tasks.create({
    title: 'General coordinator',
    repositoryId: scratch.id,
    agentId: 'agent',
    objective: 'Coordinate work',
  })
  if (readOnly)
    s.store.updateTask(parent.id, (task) => ({
      ...task,
      agentOverrides: { permission: 'read-only' },
    }))
  const release = barrier(),
    entered = barrier()
  let childRun: ((run: AgentRun) => Promise<void>) | undefined
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (run) => {
      if (run.taskId === parent.id) {
        entered.resolve()
        await release.promise
        run.onText('Coordinator finished')
        return
      }
      if (childRun) await childRun(run)
      else run.onText('Child completed its focused task')
    },
  })
  const execution = await s.tasks.start(parent.id)
  const done = execution.done.catch(() => {})
  cleanups.push(async () => {
    release.resolve()
    await done
  })
  await entered.promise
  const runId = s.store.taskSummary(parent.id).activeRunId
  if (!runId) throw new Error('Parent did not start')
  const token = s.runCredentials.issue(
    {
      taskId: parent.id,
      runId,
      permissions: { provider: 'codex', permission: readOnly ? 'read-only' : 'ask' },
      readOnly,
      artifacts: false,
      pipelineWatching: false,
      pullRequestWatching: false,
      deviceHub: false,
      memoryScopes: [],
      studioTools: { ...noStudioTools(), threads: true },
    },
    new AbortController().signal,
  )
  const origin = `http://127.0.0.1:${runtime.port}`
  const post = (action: string, input: object = {}) =>
    fetch(`${origin}/api/subagents/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...input, taskId: parent.id, parentRunId: runId }),
    })
  return {
    s,
    runtime,
    f,
    parent,
    origin,
    post,
    runId,
    release,
    setChild: (run: (run: AgentRun) => Promise<void>) => {
      childRun = run
    },
  }
}
async function pair(
  source: Awaited<ReturnType<typeof setup>>,
  target: Awaited<ReturnType<typeof setup>>,
) {
  const token = randomUUID()
  target.s.devices.add('Paired source', token)
  const sessionId = randomUUID()
  const peer = {
    id: 'paired-desktop',
    name: 'Preferred desktop',
    connection: { address: target.origin, token },
  }
  const register = async (enabled: boolean) => {
    const response = await fetch(source.origin + '/api/studio/peers', {
      method: 'POST',
      headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, peers: enabled ? [peer] : [] }),
    })
    expect(response.status).toBe(200)
  }
  await register(true)
  return { register, token, peer }
}
const request = {
  key: 'focused-work',
  name: 'Focused child',
  prompt: 'Inspect the selected project',
  repositoryId: 'repo',
  provider: 'codex',
  execution: 'main',
}

it('runs a project child from General in its own checkout and consumes its answer without duplicate delivery', async () => {
  const source = await setup()
  let cwd = ''
  source.setChild(async (run) => {
    cwd = run.cwd
    run.onText('Project inspected')
  })
  const created = await source.post('spawn', request)
  expect(created.status).toBe(200)
  const child = decode(childSchema, await created.json())
  expect(child.runtimeId).toBe('local')
  expect(source.s.store.taskSummary(child.threadId).spawnParent).toEqual({
    runtimeId: source.s.runtimeId,
    threadId: source.parent.id,
    title: source.parent.title,
  })
  const result = await source.post('wait', { id: child.id })
  expect(result.status).toBe(200)
  expect(decode(childSchema, await result.json())).toMatchObject({
    running: false,
    result: 'Project inspected',
  })
  expect(cwd).toBe(source.f.directory)
  expect(cwd).not.toBe(await source.s.scratch.directory(source.parent.id))
  await source.s.threadWatch.tick()
  expect(source.s.store.taskSummary(source.parent.id).queue ?? []).toHaveLength(0)
  const listing = await source.post('list')
  expect(await listing.text()).toContain(child.id)
  expect(source.s.threadWatch.list(source.parent.id)).toMatchObject([
    {
      delegated: true,
      relation: 'spawned',
      snapshot: {
        projectName: source.s.store
          .get()
          .repositories.find((repository) => repository.id === request.repositoryId)?.name,
      },
    },
  ])
})

it('targets paired projects with the parent permissions and deduplicates concurrent retries across receipt reconstruction', async () => {
  const source = await setup(),
    target = await setup()
  const pairing = await pair(source, target)
  const input = { ...request, runtimeId: pairing.peer.id, agentId: 'agent', provider: undefined }
  const replies = await Promise.all([source.post('spawn', input), source.post('spawn', input)])
  expect(replies.map((response) => response.status)).toEqual([200, 200])
  const children = await Promise.all(
    replies.map(async (response) => decode(childSchema, await response.json())),
  )
  expect(children[0].id).toBe(children[1].id)
  expect(target.s.store.get().tasks.filter((task) => task.title === input.name)).toHaveLength(1)
  const remote = target.s.store.taskSummary(children[0].threadId)
  expect(resolveTaskAgent(remote, target.s.store.get().agents)?.permission).toBe('ask')
  expect(source.s.threadWatch.list(source.parent.id)[0].computerName).toBe('Preferred desktop')
  source.s.mutations = new MutationReceipts(source.s.db)
  expect((await source.post('spawn', input)).status).toBe(200)
  expect((await source.post('spawn', { ...input, prompt: 'Different work' })).status).toBe(409)
  expect((await source.post('spawn', { ...input, runtimeId: 'local' })).status).toBe(409)
  const listed = await source.post('list', { runtimeId: pairing.peer.id, repositoryId: 'repo' })
  const text = await listed.text()
  expect(text).toContain(children[0].id)
  expect(text).not.toContain(pairing.token)
  expect(text).not.toContain(target.origin)
  const forbidden = await target.post('read', { id: children[0].id })
  expect(forbidden.status).toBe(403)
})

it('delivers a remote final answer once and retains completed results when offline', async () => {
  const source = await setup(),
    target = await setup()
  const pairing = await pair(source, target)
  const created = await source.post('spawn', { ...request, runtimeId: pairing.peer.id })
  const child = decode(childSchema, await created.json())
  await waitForRuntime(() =>
    expect(target.s.store.taskSummary(child.threadId).status).toBe('review'),
  )
  await source.s.threadWatch.tick()
  const queued = source.s.store.taskSummary(source.parent.id).subagentInbox ?? []
  expect(queued).toHaveLength(1)
  expect(queued[0].text).toContain('Child completed its focused task')
  expect(queued[0].subagentResultId).toBe(child.id)
  await source.s.threadWatch.tick()
  expect(source.s.store.taskSummary(source.parent.id).subagentInbox).toHaveLength(1)
  const result = await source.post('read', { id: child.id })
  expect(decode(childSchema, await result.json()).result).toBe('Child completed its focused task')
  expect(source.s.store.taskSummary(source.parent.id).queue ?? []).toHaveLength(0)
  await pairing.register(false)
  const offline = await source.post('read', { id: child.id })
  expect(decode(childSchema, await offline.json())).toMatchObject({ offline: true, running: false })
})

it('permits read-only General coordinators to launch and read strictly read-only target children', async () => {
  const source = await setup(true),
    target = await setup()
  const pairing = await pair(source, target)
  const created = await source.post('spawn', {
    ...request,
    runtimeId: pairing.peer.id,
    permission: 'full-access',
  })
  expect(created.status).toBe(200)
  const child = decode(childSchema, await created.json())
  await waitForRuntime(() =>
    expect(target.s.store.taskSummary(child.threadId).status).toBe('review'),
  )
  expect(
    resolveTaskAgent(target.s.store.taskSummary(child.threadId), target.s.store.get().agents)
      ?.permission,
  ).toBe('read-only')
  expect((await source.post('read', { id: child.id })).status).toBe(200)
  expect(source.s.threadWatch.list(source.parent.id)[0].paused).toBeUndefined()
})

it('recovers a lost local acknowledgement using the original remote create receipt', async () => {
  const source = await setup(),
    target = await setup()
  const pairing = await pair(source, target)
  source.s.preferences.save({ maxActiveChildAgents: 1 })
  const watch = vi.spyOn(source.s.threadWatch, 'watch')
  watch.mockImplementationOnce(() => {
    throw new Error('Acknowledgement interrupted')
  })
  const input = { ...request, runtimeId: pairing.peer.id }
  expect((await source.post('spawn', input)).status).toBe(500)
  expect((await source.post('spawn', { ...input, key: 'another-launch' })).status).toBe(409)
  expect((await source.post('spawn', input)).status).toBe(200)
  expect(target.s.store.get().tasks.filter((task) => task.title === request.name)).toHaveLength(1)
})

it('persists offline cancellation until the paired computer returns', async () => {
  const source = await setup(),
    target = await setup()
  const pairing = await pair(source, target)
  const childStarted = barrier()
  target.setChild(async (run) => {
    childStarted.resolve()
    await new Promise<void>((resolve) =>
      run.signal.addEventListener('abort', () => resolve(), { once: true }),
    )
  })
  const created = await source.post('spawn', { ...request, runtimeId: pairing.peer.id })
  const child = decode(childSchema, await created.json())
  await childStarted.promise
  await pairing.register(false)
  const cancelled = await source.post('cancel', { id: child.id })
  expect(cancelled.status).toBe(200)
  expect(decode(childSchema, await cancelled.json()).stopRequested).toBe(true)
  await waitForRuntime(() =>
    expect(source.s.threadWatch.list(source.parent.id)[0].stopRequested).toBe(true),
  )
  expect(target.s.store.taskSummary(child.threadId).status).toBe('running')
  await pairing.register(true)
  await waitForRuntime(async () => {
    await source.s.threadWatch.tick()
    expect(source.s.threadWatch.list(source.parent.id)[0].status).toBe('stopped')
  })
  await waitForRuntime(() =>
    expect(target.s.store.taskSummary(child.threadId).status).toBe('cancelled'),
  )
})

it('counts remote children towards the shared limit and requests their cancellation on parent Stop', async () => {
  const source = await setup(),
    target = await setup()
  const pairing = await pair(source, target)
  source.s.preferences.save({ maxActiveChildAgents: 1 })
  target.setChild(async (run) => {
    await new Promise<void>((resolve) =>
      run.signal.addEventListener('abort', () => resolve(), { once: true }),
    )
  })
  const created = await source.post('spawn', { ...request, runtimeId: pairing.peer.id })
  const child = decode(childSchema, await created.json())
  expect(
    (
      await source.post('spawn', {
        key: 'another',
        name: 'Local child',
        prompt: 'Work',
        provider: 'codex',
      })
    ).status,
  ).toBe(409)
  await pairing.register(false)
  source.s.tasks.cancel(source.parent.id)
  expect(source.s.threadWatch.list(source.parent.id)[0].stopRequested).toBe(true)
  await pairing.register(true)
  await waitForRuntime(async () => {
    await source.s.threadWatch.tick()
    expect(source.s.threadWatch.list(source.parent.id)[0].status).toBe('stopped')
  })
  await waitForRuntime(() =>
    expect(target.s.store.taskSummary(child.threadId).status).toBe('cancelled'),
  )
})

it('rejects disabled features, conflicting targets and unsupported permissions before creating children', async () => {
  const source = await setup()
  expect((await source.post('spawn', { ...request, checkoutId: 'linked' })).status).toBe(400)
  expect(
    (await source.post('spawn', { ...request, key: 'unsupported', provider: 'acp' })).status,
  ).toBe(400)
  source.s.preferences.save({ enableStudioThreads: false })
  expect((await source.post('spawn', { ...request, key: 'disabled' })).status).toBe(403)
  expect(source.s.store.get().tasks.filter((task) => task.title === request.name)).toHaveLength(0)
})

it('creates a separate General child on a paired computer and preserves logical nesting limits', async () => {
  const source = await setup(),
    target = await setup()
  const pairing = await pair(source, target)
  const created = await source.post('spawn', {
    key: 'general-remote',
    name: 'Remote research',
    prompt: 'Inspect available tools',
    runtimeId: pairing.peer.id,
    provider: 'codex',
  })
  expect(created.status).toBe(200)
  const child = decode(childSchema, await created.json())
  expect(target.s.store.taskSummary(child.threadId)).toMatchObject({
    repositoryId: 'dovo:scratch',
    coordinationDepth: 1,
  })
  expect(await target.s.scratch.directory(child.threadId)).not.toBe(
    await target.s.scratch.directory(target.parent.id),
  )
  source.s.store.updateTask(source.parent.id, (task) => ({ ...task, coordinationDepth: 3 }))
  expect(
    (await source.post('spawn', { ...request, key: 'too-deep', runtimeId: pairing.peer.id }))
      .status,
  ).toBe(409)
})

it('returns a durable draft reference when the target cannot start and refuses unsupported read-only providers', async () => {
  const source = await setup(),
    target = await setup()
  const pairing = await pair(source, target)
  vi.spyOn(target.s.tasks, 'start').mockRejectedValueOnce(new Error('Provider is unavailable'))
  const created = await source.post('spawn', { ...request, runtimeId: pairing.peer.id })
  expect(created.status).toBe(200)
  expect(
    decode(Schema.Struct({ startError: Schema.String }), await created.clone().json()).startError,
  ).toContain('Provider is unavailable')
  const child = decode(childSchema, await created.json())
  expect(target.s.store.taskSummary(child.threadId).status).toBe('draft')
  expect((await source.post('spawn', { ...request, runtimeId: pairing.peer.id })).status).toBe(200)
  expect(target.s.store.get().tasks.filter((task) => task.title === request.name)).toHaveLength(1)
  const reader = await setup(true)
  expect(
    (await reader.post('spawn', { ...request, key: 'unsupported-reader', provider: 'hermes' }))
      .status,
  ).toBe(400)
  expect(reader.s.store.get().tasks.filter((task) => task.title === request.name)).toHaveLength(0)
})

it('retires a running target child when the coordinator permissions are narrowed', async () => {
  const source = await setup(),
    target = await setup()
  const pairing = await pair(source, target)
  const started = barrier()
  target.setChild(async (run) => {
    started.resolve()
    await new Promise<void>((resolve) =>
      run.signal.addEventListener('abort', () => resolve(), { once: true }),
    )
  })
  const created = await source.post('spawn', { ...request, runtimeId: pairing.peer.id })
  const child = decode(childSchema, await created.json())
  await started.promise
  source.s.store.updateTask(source.parent.id, (task) => ({
    ...task,
    agentOverrides: { permission: 'read-only' },
  }))
  await waitForRuntime(async () => {
    await source.s.threadWatch.tick()
    expect(target.s.store.taskSummary(child.threadId).status).toBe('cancelled')
  })
  expect(source.s.threadWatch.list(source.parent.id)[0].stopRequested).toBe(true)
})

it('bounds returned answers and exposes failed child outcomes instead of an earlier answer', async () => {
  const source = await setup(),
    target = await setup()
  const pairing = await pair(source, target)
  target.setChild(async (run) => {
    run.onText('x'.repeat(25000))
  })
  const created = await source.post('spawn', { ...request, runtimeId: pairing.peer.id })
  const child = decode(childSchema, await created.json())
  const result = await source.post('wait', { id: child.id })
  const answer = decode(
    Schema.Struct({ result: Schema.String, resultTruncated: Schema.Boolean }),
    await result.json(),
  )
  expect(answer.result).toHaveLength(20000)
  expect(answer.resultTruncated).toBe(true)
  expect(await (await source.post('list')).text()).not.toContain('x'.repeat(100))
  target.s.store.updateTask(child.threadId, (task) => ({
    ...task,
    status: 'failed',
    error: 'Provider authentication expired',
  }))
  const failed = await source.post('read', { id: child.id })
  expect(
    decode(
      Schema.Struct({
        status: Schema.String,
        result: Schema.optional(Schema.String),
        error: Schema.String,
      }),
      await failed.json(),
    ),
  ).toEqual({ status: 'failed', result: undefined, error: 'Provider authentication expired' })
})

it('keeps ownership and capacity when monitoring is stopped, and can still cancel that work', async () => {
  const source = await setup(),
    target = await setup()
  const pairing = await pair(source, target)
  source.s.preferences.save({ maxActiveChildAgents: 1 })
  const started = barrier()
  target.setChild(async (run) => {
    started.resolve()
    await new Promise<void>((resolve) =>
      run.signal.addEventListener('abort', () => resolve(), { once: true }),
    )
  })
  const created = await source.post('spawn', { ...request, runtimeId: pairing.peer.id })
  const child = decode(childSchema, await created.json())
  await started.promise
  source.s.threadWatch.stop(source.parent.id, pairing.peer.id, child.threadId)
  expect(
    (await source.post('spawn', { ...request, key: 'another', runtimeId: pairing.peer.id })).status,
  ).toBe(409)
  expect(
    decode(childSchema, await (await source.post('read', { id: child.id })).json()).running,
  ).toBe(true)
  expect((await source.post('cancel', { id: child.id })).status).toBe(200)
  await waitForRuntime(async () => {
    await source.s.threadWatch.tick()
    expect(target.s.store.taskSummary(child.threadId).status).toBe('cancelled')
  })
})

it('retries the same target key after a temporary connection failure', async () => {
  const source = await setup(),
    target = await setup()
  const pairing = await pair(source, target)
  const input = { ...request, runtimeId: pairing.peer.id }
  await pairing.register(false)
  expect((await source.post('spawn', input)).status).toBe(404)
  await pairing.register(true)
  expect((await source.post('spawn', input)).status).toBe(200)
  expect(target.s.store.get().tasks.filter((task) => task.title === request.name)).toHaveLength(1)
})

it('returns background grandchildren and acknowledges a remote failure without losing descendant attention', async () => {
  const source = await setup(),
    target = await setup()
  const pairing = await pair(source, target)
  const created = await source.post('spawn', { ...request, runtimeId: pairing.peer.id })
  expect(created.status).toBe(200)
  const child = decode(childSchema, await created.json())
  await waitForRuntime(() =>
    expect(target.s.store.taskSummary(child.threadId).status).toBe('review'),
  )
  target.s.store.updateTask(child.threadId, (task) => ({
    ...task,
    status: 'failed',
    error: 'Provider failed',
  }))
  const grandchild = target.s.tasks.create({
    title: 'Grandchild input',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  target.s.store.updateTask(grandchild.id, (task) => ({
    ...task,
    delegation: { parentTaskId: child.threadId, parentRunId: 'run', key: 'grandchild' },
  }))
  vi.spyOn(target.s.approvals, 'list').mockReturnValue([
    { id: 'input', taskId: grandchild.id, title: 'Allow', detail: '', createdAt: '' },
  ])
  await source.s.threadWatch.tick()
  const watch = source.s.threadWatch.list(source.parent.id)[0]
  expect(watch.snapshot?.threads?.find((entry) => entry.threadId === grandchild.id)).toMatchObject({
    title: 'Grandchild input',
    attention: ['approval:input'],
  })
  expect(watch.snapshot?.phase).toBe('needs-input')
  const snapshot = threadSnapshot(source.s, source.parent.id)
  expect(snapshot.threads?.find((entry) => entry.threadId === grandchild.id)?.parent).toMatchObject(
    { threadId: child.threadId, runtimeId: target.s.runtimeId },
  )
  const parent = { ...source.s.store.taskSummary(source.parent.id), threadWatches: [watch] }
  const tree = buildThreadTree([
    {
      key: JSON.stringify(['local', parent.id]),
      task: parent,
      needsInput: false,
      projectName: 'General',
      source: {
        runtimeId: 'local',
        name: 'Source',
        online: true,
        snapshot: { runtimeId: source.s.runtimeId, questions: [], approvals: [] },
      },
    },
  ])
  const branch = tree.nodes.get(JSON.stringify(['local', parent.id]))!.children[0]
  expect(branch.phase).toBe('failed')
  expect(branch.children[0]).toMatchObject({ title: 'Grandchild input', needsInput: true })
  expect(tree.roots[0].needsInput).toBe(true)
  const key = threadFailureKey(
    target.s.runtimeId,
    child.threadId,
    taskFailureVersion(target.s.store.taskSummary(child.threadId)),
  )
  expect(branch.failureKey).toBe(key)
  const response = await fetch(source.origin + '/api/tasks/acknowledge-subagent-failure', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + owner, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: parent.id, key }),
  })
  expect(response.status).toBe(200)
  expect(source.s.store.taskSummary(parent.id).acknowledgedSubagentFailures).toEqual([key])
  expect(target.s.store.taskSummary(child.threadId).acknowledgedSubagentFailures).toBeUndefined()
})

it('sends idempotent follow-ups to an owned paired child and receives a fresh inbox result', async () => {
  const source = await setup(),
    target = await setup()
  const pairing = await pair(source, target)
  let turns = 0
  target.setChild(async (run) => {
    turns++
    run.onText(`Remote answer ${turns}`)
  })
  const spawned = await source.post('spawn', { ...request, runtimeId: pairing.peer.id })
  expect(spawned.status).toBe(200)
  const child = decode(childSchema, await spawned.json())
  expect(
    decode(childSchema, await (await source.post('wait', { id: child.id })).json()).result,
  ).toBe('Remote answer 1')
  const followup = { id: child.id, key: 'second-review', prompt: 'Review again' }
  const sent = await source.post('send', followup)
  expect(sent.status).toBe(200)
  expect((await source.post('send', followup)).status).toBe(200)
  expect((await source.post('send', { ...followup, prompt: 'Different' })).status).toBe(409)
  const waited = await source.post('wait', { id: child.id })
  expect(decode(childSchema, await waited.json()).result).toContain('Remote answer 2')
  expect(turns).toBe(2)
  expect((await source.post('send', { ...followup, id: 'someone-else' })).status).toBe(403)
  expect(source.s.store.taskSummary(source.parent.id).queue ?? []).toEqual([])
})

it('lists and reads a late native result without exposing it to the user queue', async () => {
  const source = await setup()
  const completionId = 'native-result:codex:session:child:started'
  source.s.store.updateTask(source.parent.id, (task) => ({
    ...task,
    subagents: [
      {
        id: 'native-child',
        provider: 'codex',
        name: 'Native reviewer',
        status: 'completed',
        source: undefined,
        startedAt: 'started',
        updatedAt: 'finished',
        finishedAt: 'finished',
        result: 'Native answer',
        completion: 'pending',
        completionId,
      },
    ],
  }))
  await source.s.tasks.runScheduled()
  const list = await source.post('list')
  expect(await list.json()).toMatchObject({ inbox: [{ id: completionId }] })
  expect(source.s.store.taskSummary(source.parent.id).queue ?? []).toEqual([])
  const result = await source.post('read', { id: completionId })
  expect(result.status).toBe(200)
  expect(await result.json()).toMatchObject({ result: 'Native answer', running: false })
  expect(source.s.store.taskSummary(source.parent.id).subagentInbox).toEqual([])
  expect(source.s.store.taskSummary(source.parent.id).subagents?.[0].completion).toBe('read')
  // A restarted native child must not overwrite an older unread result or receive its acknowledgement.
  source.s.tasks.queue.addSubagentResult(
    source.parent.id,
    'older',
    'Earlier native answer',
    completionId,
  )
  source.s.store.updateTask(source.parent.id, (task) => ({
    ...task,
    subagents: task.subagents?.map((agent) => ({
      ...agent,
      completionId: 'native-result:new-attempt',
      completion: 'pending',
      result: 'New answer',
    })),
  }))
  const earlier = await source.post('read', { id: completionId })
  expect(earlier.status).toBe(200)
  expect(await earlier.json()).toMatchObject({ result: 'Earlier native answer' })
  expect(source.s.store.taskSummary(source.parent.id).subagents?.[0].completion).toBe('pending')
  expect((await source.post('read', { id: 'native-result:someone-else' })).status).toBe(403)
})
