import { afterEach, expect, it, vi } from 'vite-plus/test'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { Effect } from 'effect'
import {
  decode,
  doDiscoverReplySchema,
  doListReplySchema,
  doRunReplySchema,
  snapshotSchema,
  type DoPlanItem,
  type DoRun,
} from '@dovo/protocol'
import { startRuntime } from '../index.js'
import { fixture } from '../testing/fixture.js'
import { runtimeIntegration } from '../testing/integration.js'
import { AgentRegistry } from '../agents/configuration/registry.js'
import { HttpError } from '../errors.js'
import { DoPeers } from './peers.js'
import { ModelSelection } from '../agents/tasks/model-selection.js'
import type { AgentAdapter, AgentRun } from '../agents/execution/types.js'

vi.setConfig(runtimeIntegration)
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const close of cleanups.splice(0).reverse()) await close()
})
const token = 'do-runtime-owner-token-at-least-32-characters'

async function setup(
  run: AgentAdapter['run'] = async (context) => context.onText('Finished the item'),
  options: { enabled?: boolean; databasePath?: string; directory?: string } = {},
) {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const runtime = await startRuntime({
    databasePath: options.databasePath ?? join(f.directory, '.git', 'do.sqlite'),
    ownerToken: token,
    port: 0,
  })
  cleanups.push(runtime.close)
  const s = runtime.services
  if (options.enabled ?? true) s.preferences.save({ enableDo: true })
  s.store.update(() => f.workspace)
  const calls: AgentRun[] = []
  vi.spyOn(s.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (context) => {
      calls.push(context)
      await run(context)
    },
  })
  const origin = `http://127.0.0.1:${runtime.port}`
  const raw = (path: string, input: unknown = {}) =>
    fetch(`${origin}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  const call = async (operation: string, input: unknown) => {
    const response = await raw(`/api/do/${operation}`, input)
    if (!response.ok) throw new Error(`${response.status} ${await response.text()}`)
    return decode(doRunReplySchema, await response.json()).run
  }
  const read = (id: string) => call('read', { id })
  /** Drives the scheduler directly instead of waiting for its interval. */
  const until = (id: string, check: (run: DoRun) => void) =>
    vi.waitFor(
      async () => {
        await s.doRuns.tick()
        check(await read(id))
      },
      { timeout: 15_000, interval: 50 },
    )
  return { f, runtime, s, calls, origin, raw, call, read, until }
}
const item = (id: string, dependsOn: string[] = [], runtimeId = 'local'): DoPlanItem => ({
  id,
  title: `Item ${id}`,
  instructions: `Do ${id}`,
  dependsOn,
  target: { runtimeId, repositoryId: 'repo', agentId: 'agent' },
})
const plan = (items: DoPlanItem[], maxConcurrency = 2) => ({
  id: randomUUID(),
  title: 'Ship the feature',
  goal: 'Implement and verify the feature',
  maxConcurrency,
  items,
})
type Setup = Awaited<ReturnType<typeof setup>>
const doThreads = (s: Setup['s']) => s.store.get().tasks.filter((task) => task.origin === 'do')
/** Registers `target` the way Studio on the source computer does, under a client profile ID. */
const pair = async (source: Setup, target: Setup) => {
  const response = await source.raw('/api/studio/peers', {
    sessionId: randomUUID(),
    peers: [{ id: 'paired', name: 'Paired', connection: { address: target.origin, token } }],
  })
  expect(response.status).toBe(200)
}

it('is off by default and gates every mutating action behind the runtime preference', async () => {
  const f = await setup(undefined, { enabled: false })
  const snapshot = async () =>
    decode(
      snapshotSchema,
      await (
        await fetch(`${f.origin}/api/snapshot`, { headers: { Authorization: `Bearer ${token}` } })
      ).json(),
    )
  expect(f.s.preferences.get().enableDo).toBe(false)
  expect((await snapshot()).doEnabled).toBe(false)
  expect((await f.raw('/api/do/save', plan([item('a')]))).status).toBe(403)
  expect((await f.raw('/api/do/discover')).status).toBe(403)
  const dispatch = {
    runtimeId: f.s.runtimeId,
    key: 'origin:run:item',
    messageId: 'do:run:item:1',
    title: 'Item',
    text: 'Do the item',
    repositoryId: 'repo',
  }
  expect((await f.raw('/api/do/remote/dispatch', dispatch)).status).toBe(403)
  expect(decode(doListReplySchema, await (await f.raw('/api/do/list')).json()).runs).toEqual([])
  f.s.preferences.save({ enableDo: true })
  expect((await snapshot()).doEnabled).toBe(true)
  expect((await f.raw('/api/do/save', plan([item('a')]))).status).toBe(200)
})

it('validates the dependency graph and local targets at the boundary', async () => {
  const f = await setup()
  const status = async (items: DoPlanItem[]) => (await f.raw('/api/do/save', plan(items))).status
  expect(await status([item('a', ['b']), item('b', ['a'])])).toBe(400)
  expect(await status([item('a', ['missing'])])).toBe(400)
  expect(await status([item('a', ['a'])])).toBe(400)
  expect(await status([item('a'), item('a')])).toBe(400)
  expect(
    await status([{ ...item('a'), target: { runtimeId: 'local', repositoryId: 'gone' } }]),
  ).toBe(400)
  expect(await status([{ ...item('a'), state: { status: 'completed' } } as DoPlanItem])).toBe(400)
  expect(await status([item('a'), item('b', ['a'])])).toBe(200)
})

it('runs an approved plan in dependency order with upstream results and a final review', async () => {
  const f = await setup(async (context) =>
    context.onText(
      `Summary for ${/Instructions:\nDo (\w+)/.exec(context.prompt)?.[1] ?? 'unknown'}`,
    ),
  )
  const input = plan([item('a'), item('b', ['a'])], 1)
  const saved = await f.call('save', input)
  expect(saved.status).toBe('draft')
  // An identical retry of the create returns the stored draft.
  expect((await f.call('save', input)).revision).toBe(saved.revision)
  expect(
    (await f.raw('/api/do/start', { id: saved.id, expectedRevision: randomUUID() })).status,
  ).toBe(409)
  const started = await f.call('start', { id: saved.id, expectedRevision: saved.revision })
  expect(started.status).toBe('running')
  expect((await f.call('start', { id: saved.id, expectedRevision: saved.revision })).status).toBe(
    'running',
  )
  expect((await f.raw('/api/do/save', { ...input, expectedRevision: saved.revision })).status).toBe(
    409,
  )
  await f.until(saved.id, (run) => expect(run.status).toBe('review'))
  const run = await f.read(saved.id)
  expect(run.items.map((value) => value.state.status)).toEqual(['completed', 'completed'])
  expect(run.items[0].state.result).toMatchObject({
    summary: 'Summary for a',
    source: 'agent-message',
    truncated: false,
  })
  expect(f.calls).toHaveLength(2)
  expect(f.calls[0].prompt).toContain('Do a')
  expect(f.calls[0].prompt).not.toContain('Upstream results')
  expect(f.calls[1].prompt).toContain('Upstream results')
  expect(f.calls[1].prompt).toContain('agent-reported and unverified')
  expect(f.calls[1].prompt).toContain('Summary for a')
  expect(doThreads(f.s)).toHaveLength(2)
  expect((await f.raw('/api/do/complete', { id: saved.id, decision: 'maybe' })).status).toBe(400)
  const reviewed = await f.call('complete', {
    id: saved.id,
    decision: 'accepted',
    note: 'Looks good',
  })
  expect(reviewed).toMatchObject({ status: 'completed', review: { decision: 'accepted' } })
  expect((await f.call('complete', { id: saved.id, decision: 'accepted' })).status).toBe(
    'completed',
  )
  expect((await f.raw('/api/do/cancel', { id: saved.id })).status).toBe(409)
})

const held =
  (releases: (() => void)[]): AgentAdapter['run'] =>
  (context) =>
    new Promise<void>((resolve) => {
      context.signal.addEventListener('abort', () => resolve())
      releases.push(() => {
        context.onText('done')
        resolve()
      })
    })
/** Releases agent turns once they actually started, not merely once queued. */
const release = async (releases: (() => void)[], count: number) => {
  await vi.waitFor(() => expect(releases.length).toBeGreaterThanOrEqual(count), {
    timeout: 15_000,
  })
  releases.splice(0).forEach((resolve) => resolve())
}
const worktree = (value: DoPlanItem): DoPlanItem => ({
  ...value,
  target: { ...value.target, execution: 'worktree' },
})

it('bounds concurrency and dispatches each owned thread exactly once', async () => {
  const releases: (() => void)[] = []
  const f = await setup(held(releases))
  const saved = await f.call('save', plan([item('a'), item('b'), item('c')].map(worktree), 2))
  await f.call('start', { id: saved.id, expectedRevision: saved.revision })
  await f.until(saved.id, (run) =>
    expect(run.items.filter((value) => value.state.status === 'running')).toHaveLength(2),
  )
  for (let index = 0; index < 5; index++) await f.s.doRuns.tick()
  expect(doThreads(f.s)).toHaveLength(2)
  expect((await f.read(saved.id)).items[2].state.status).toBe('pending')
  await release(releases, 2)
  await f.until(saved.id, (run) => expect(run.items[2].state.status).toBe('running'))
  await release(releases, 1)
  await f.until(saved.id, (run) => expect(run.status).toBe('review'))
  expect(doThreads(f.s)).toHaveLength(3)
  expect(f.calls).toHaveLength(3)
})

it('runs items that share a project checkout one at a time', async () => {
  const releases: (() => void)[] = []
  const f = await setup(held(releases))
  const saved = await f.call('save', plan([item('a'), item('b')], 2))
  await f.call('start', { id: saved.id, expectedRevision: saved.revision })
  await f.until(saved.id, (run) => expect(run.items[0].state.status).toBe('running'))
  for (let index = 0; index < 3; index++) await f.s.doRuns.tick()
  expect((await f.read(saved.id)).items[1].state.status).toBe('pending')
  await release(releases, 1)
  await f.until(saved.id, (run) => expect(run.items[1].state.status).toBe('running'))
  await release(releases, 1)
  await f.until(saved.id, (run) => expect(run.status).toBe('review'))
  expect(doThreads(f.s).map((task) => task.error)).toEqual([undefined, undefined])
})

it('makes owned-thread dispatch idempotent and rejects a stopped attempt arriving late', async () => {
  const f = await setup()
  const request = {
    runtimeId: f.s.runtimeId,
    key: 'origin:run:item',
    messageId: 'do:run:item:1',
    title: 'Item',
    text: 'Do the item',
    repositoryId: 'repo',
    agentId: 'agent',
  }
  const first = await f.s.doThreads.dispatch('local', request)
  const again = await f.s.doThreads.dispatch('local', request)
  expect(first.created).toBe(true)
  expect(again.created).toBe(false)
  expect(again.observation.taskId).toBe(first.observation.taskId)
  expect(doThreads(f.s)).toHaveLength(1)
  await vi.waitFor(() =>
    expect(f.s.doThreads.observe('local', request.key).status).toBe('finished'),
  )
  expect(f.calls).toHaveLength(1)
  expect(() => f.s.doThreads.observe('origin:other', request.key)).toThrow('another runtime')
  expect(f.s.doThreads.stop('local', 'origin:run:late', 'do:run:late:1')).toBe('confirmed')
  await expect(
    f.s.doThreads.dispatch('local', {
      ...request,
      key: 'origin:run:late',
      messageId: 'do:run:late:1',
    }),
  ).rejects.toThrow('cancelled')
  expect(doThreads(f.s)).toHaveLength(1)
})

it('cancels only this run’s threads and reports cancelled only after the stop is confirmed', async () => {
  const f = await setup(
    (context) =>
      new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve())),
  )
  const other = f.s.tasks.create({
    title: 'Unrelated',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: '',
  })
  const saved = await f.call('save', plan([item('a'), item('b', ['a'])]))
  await f.call('start', { id: saved.id, expectedRevision: saved.revision })
  await f.until(saved.id, (run) => expect(run.items[0].state.status).toBe('running'))
  const cancelling = await f.call('cancel', { id: saved.id })
  expect(cancelling.status).toBe('cancelling')
  expect(cancelling.items.map((value) => value.state.status)).toEqual(['cancelling', 'cancelled'])
  await f.until(saved.id, (run) => expect(run.status).toBe('cancelled'))
  const run = await f.read(saved.id)
  expect(run.items[0].state.status).toBe('cancelled')
  expect(f.s.tasks.hasWorkingFamily(run.items[0].state.taskId ?? '')).toBe(false)
  expect(f.s.store.taskSummary(other.id).status).toBe('draft')
  expect(doThreads(f.s)).toHaveLength(1)
})

it('retries a failed item in its original thread after inspecting it', async () => {
  let failures = 1
  const f = await setup(async (context) => {
    if (failures-- > 0) throw new Error('Provider exploded')
    context.onText('Recovered')
  })
  const saved = await f.call('save', plan([item('a'), item('b', ['a'])]))
  await f.call('start', { id: saved.id, expectedRevision: saved.revision })
  await f.until(saved.id, (run) => expect(run.status).toBe('attention'))
  const failed = await f.read(saved.id)
  expect(failed.items[0].state).toMatchObject({ status: 'failed', attempt: 1 })
  expect(failed.items[0].state.error).toBeTruthy()
  expect(failed.items[1].state.status).toBe('pending')
  const taskId = failed.items[0].state.taskId
  const retried = await f.call('retry', { id: saved.id })
  expect(retried.status).toBe('running')
  await f.until(saved.id, (run) => expect(run.status).toBe('review'))
  const run = await f.read(saved.id)
  expect(run.items[0].state).toMatchObject({ status: 'completed', attempt: 2, taskId })
  expect(f.calls[1].prompt).toContain('attempt 2')
  expect(f.calls[1].prompt).toContain('previous attempt ended with')
  expect(doThreads(f.s)).toHaveLength(2)
  expect((await f.raw('/api/do/retry', { id: saved.id })).status).toBe(409)
})

it('reconciles persisted intent after a restart without rerunning completed work', async () => {
  const first = await setup()
  const databasePath = join(first.f.directory, '.git', 'do.sqlite')
  const saved = await first.call('save', plan([item('a')]))
  await first.call('start', { id: saved.id, expectedRevision: saved.revision })
  await first.until(saved.id, (run) => expect(run.status).toBe('review'))
  const completed = await first.read(saved.id)
  const workspace = first.s.store.get()
  await first.runtime.close()
  cleanups.splice(cleanups.indexOf(first.runtime.close), 1)
  // Simulate a crash after the thread accepted the message but before the state was saved.
  const db = new Database(databasePath)
  db.prepare('UPDATE do_runs SET value=? WHERE id=?').run(
    JSON.stringify({
      ...completed,
      status: 'running',
      items: completed.items.map((value) => ({
        ...value,
        state: { status: 'dispatching', attempt: 1, updatedAt: value.state.updatedAt },
      })),
    }),
    saved.id,
  )
  db.close()
  const runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  const calls: AgentRun[] = []
  vi.spyOn(runtime.services.agents, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run: async (context) => {
      calls.push(context)
    },
  })
  expect(runtime.services.store.get().tasks).toHaveLength(workspace.tasks.length)
  await vi.waitFor(async () => {
    await runtime.services.doRuns.tick()
    expect(runtime.services.doRuns.read(saved.id).status).toBe('review')
  })
  const run = runtime.services.doRuns.read(saved.id)
  expect(run.items[0].state).toMatchObject({ status: 'completed', attempt: 1 })
  expect(run.items[0].state.result?.summary).toBe('Finished the item')
  expect(calls).toHaveLength(0)
  expect(runtime.services.store.get().tasks.filter((task) => task.origin === 'do')).toHaveLength(1)
})

it('dispatches to a paired computer only while Studio keeps it registered', async () => {
  const source = await setup()
  const target = await setup(async (context) => context.onText('Remote summary'))
  const missing = await source.call('save', plan([item('a', [], 'offline')]))
  await source.call('start', { id: missing.id, expectedRevision: missing.revision })
  await source.until(missing.id, (run) => expect(run.status).toBe('attention'))
  expect((await source.read(missing.id)).items[0].state).toMatchObject({
    status: 'blocked',
    blockedReason: expect.stringContaining('Studio'),
  })
  expect((await source.raw('/api/do/discover', { runtimeId: 'offline' })).status).toBe(503)
  const register = await source.raw('/api/studio/peers', {
    sessionId: randomUUID(),
    peers: [{ id: 'paired', name: 'Paired', connection: { address: target.origin, token } }],
  })
  expect(register.status).toBe(200)
  const discovered = decode(
    doDiscoverReplySchema,
    await (await source.raw('/api/do/discover', {})).json(),
  )
  // Targets bind the paired runtime's own ID, learned from `/health`, not Studio's profile ID.
  expect(discovered.computers).toEqual([
    { id: 'local', name: 'This computer', local: true },
    { id: target.s.runtimeId, name: 'Paired', local: false },
  ])
  expect((await source.raw('/api/do/discover', { runtimeId: 'paired' })).status).toBe(503)
  expect(
    decode(
      doDiscoverReplySchema,
      await (await source.raw('/api/do/discover', { runtimeId: target.s.runtimeId })).json(),
    ),
  ).toMatchObject({ runtimeId: target.s.runtimeId, projects: [{ id: 'repo' }] })
  // Another Studio client registering the same computer under its own profile ID changes nothing.
  expect(
    (
      await source.raw('/api/studio/peers', {
        sessionId: randomUUID(),
        peers: [
          {
            id: 'phone-profile',
            name: 'Paired',
            connection: { address: target.origin, token, runtimeId: target.s.runtimeId },
          },
        ],
      })
    ).status,
  ).toBe(200)
  const saved = await source.call(
    'save',
    plan([item('a', [], target.s.runtimeId), item('b', ['a'], source.s.runtimeId)]),
  )
  expect(saved.items[1].target.runtimeId).toBe('local')
  await source.call('start', { id: saved.id, expectedRevision: saved.revision })
  await source.until(saved.id, (run) => expect(run.status).toBe('review'))
  const run = await source.read(saved.id)
  expect(run.items[0].state.result?.summary).toBe('Remote summary')
  expect(doThreads(target.s)).toHaveLength(1)
  expect(doThreads(target.s)[0].id).toBe(run.items[0].state.taskId)
  expect(doThreads(source.s)).toHaveLength(1)
  expect(source.calls[0].prompt).toContain('Remote summary')
  // Summaries and branch names travel; files do not, and the agent is told so.
  expect(source.calls[0].prompt).toContain('not copied into this checkout')
  expect(source.calls[0].prompt).toContain('may not contain uncommitted changes')
  // Remote keys stay apart from the target's own Do threads, and requests name their target.
  const key = `${source.s.runtimeId}:${saved.id}:a`
  expect(() => target.s.doThreads.observe('local', key)).toThrow('another runtime')
  const inspect = (runtimeId: string) =>
    target.raw('/api/do/remote/inspect', { runtimeId, keys: [key] })
  expect((await inspect(source.s.runtimeId)).status).toBe(409)
  expect((await inspect(target.s.runtimeId)).status).toBe(200)
})

it('leaves interrupted Do threads to Do instead of generic restart continuation', async () => {
  const first = await setup(async (context) => {
    await new Promise<void>((_resolve, reject) => {
      if (context.signal.aborted) reject(context.signal.reason)
      else
        context.signal.addEventListener('abort', () => reject(context.signal.reason), {
          once: true,
        })
    })
  })
  first.s.preferences.save({ autoContinueAfterRestart: true })
  const databasePath = join(first.f.directory, '.git', 'do.sqlite')
  const saved = await first.call('save', plan([item('a')]))
  await first.call('start', { id: saved.id, expectedRevision: saved.revision })
  await vi.waitFor(() => expect(first.calls).toHaveLength(1))
  await first.until(saved.id, (run) => expect(run.items[0].state.status).toBe('running'))
  const taskId = (await first.read(saved.id)).items[0].state.taskId
  if (!taskId) throw new Error('The work item has no thread')
  await first.runtime.close()
  cleanups.splice(cleanups.indexOf(first.runtime.close), 1)
  const run = vi.fn<AgentAdapter['run']>(async (context) => context.onText('Continued'))
  vi.spyOn(AgentRegistry.prototype, 'get').mockResolvedValue({
    probe: vi.fn<AgentAdapter['probe']>(),
    run,
  })
  const runtime = await startRuntime({ databasePath, ownerToken: token, port: 0 })
  cleanups.push(runtime.close)
  await vi.waitFor(() =>
    expect(runtime.services.store.task(taskId).restartRecovery?.automatic).toBe(false),
  )
  await runtime.services.doRuns.tick()
  expect(runtime.services.doRuns.read(saved.id).items[0].state.status).toBe('waiting')
  expect(run).not.toHaveBeenCalled()
})

it('re-sends a dispatch whose reply was lost without creating a second thread or message', async () => {
  const source = await setup()
  const target = await setup(async (context) => context.onText('Remote summary'))
  await pair(source, target)
  const dispatch = target.s.doThreads.dispatch.bind(target.s.doThreads)
  const dispatched = vi
    .spyOn(target.s.doThreads, 'dispatch')
    .mockImplementationOnce(async (owner, input) => {
      await dispatch(owner, input)
      // The origin cannot tell what happened, and its next inspect races the delivery.
      vi.spyOn(target.s.doThreads, 'observe').mockImplementationOnce((_owner, key) => ({
        key,
        status: 'missing',
      }))
      throw new HttpError(502, 'Reply lost')
    })
  const saved = await source.call('save', plan([item('a', [], target.s.runtimeId)]))
  await source.call('start', { id: saved.id, expectedRevision: saved.revision })
  await source.until(saved.id, (run) => expect(run.status).toBe('review'))
  expect(dispatched).toHaveBeenCalledTimes(2)
  expect(dispatched.mock.calls[1][1]).toMatchObject({
    key: dispatched.mock.calls[0][1].key,
    messageId: dispatched.mock.calls[0][1].messageId,
  })
  expect((await dispatched.mock.results[1].value).created).toBe(false)
  const [thread] = doThreads(target.s)
  expect(doThreads(target.s)).toHaveLength(1)
  expect(
    target.s.store.task(thread.id).messages.filter((message) => message.role === 'user'),
  ).toHaveLength(1)
  expect(target.calls).toHaveLength(1)
})

it('dispatches a blocked item once its paired computer is registered', async () => {
  const source = await setup()
  const target = await setup(async (context) => context.onText('Remote summary'))
  const saved = await source.call('save', plan([item('a', [], target.s.runtimeId)]))
  await source.call('start', { id: saved.id, expectedRevision: saved.revision })
  await source.until(saved.id, (run) =>
    expect(run.items[0].state).toMatchObject({
      status: 'blocked',
      blockedReason: expect.stringContaining('Studio'),
    }),
  )
  await pair(source, target)
  await source.until(saved.id, (run) => expect(run.status).toBe('review'))
  expect(doThreads(target.s)).toHaveLength(1)
  expect(target.calls).toHaveLength(1)
})

it('fails an attempt whose thread was deleted and replaces it only on an explicit retry', async () => {
  const f = await setup()
  const saved = await f.call('save', plan([item('a')]))
  await f.call('start', { id: saved.id, expectedRevision: saved.revision })
  await f.until(saved.id, (run) => expect(run.status).toBe('review'))
  const finished = await f.read(saved.id)
  const taskId = finished.items[0].state.taskId
  if (!taskId) throw new Error('The work item has no thread')
  expect((await f.raw('/api/tasks/lifecycle', { id: taskId, action: 'delete' })).status).toBe(200)
  // A crash before the dispatch outcome was saved: reconciliation re-sends the same attempt.
  f.s.db.prepare('UPDATE do_runs SET value=? WHERE id=?').run(
    JSON.stringify({
      ...finished,
      status: 'running',
      items: finished.items.map((value) => ({
        ...value,
        state: { status: 'dispatching', attempt: 1, taskId, updatedAt: value.state.updatedAt },
      })),
    }),
    saved.id,
  )
  await f.until(saved.id, (run) =>
    expect(run.items[0].state).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('deleted'),
    }),
  )
  expect(doThreads(f.s)).toHaveLength(0)
  expect(f.calls).toHaveLength(1)
  await f.call('retry', { id: saved.id })
  await f.until(saved.id, (run) => expect(run.status).toBe('review'))
  expect(doThreads(f.s)).toHaveLength(1)
  expect(f.calls).toHaveLength(2)
})

it('keeps a remote item cancelling until the paired computer confirms the stop', async () => {
  const releases: (() => void)[] = []
  const source = await setup()
  const target = await setup(held(releases))
  await pair(source, target)
  const saved = await source.call('save', plan([item('a', [], target.s.runtimeId)]))
  await source.call('start', { id: saved.id, expectedRevision: saved.revision })
  await vi.waitFor(() => expect(releases).toHaveLength(1), { timeout: 15_000 })
  await source.until(saved.id, (run) => expect(run.items[0].state.status).toBe('running'))
  const stop = vi.spyOn(target.s.doThreads, 'stop').mockImplementation(() => {
    throw new HttpError(504, 'Stop timed out')
  })
  await source.call('cancel', { id: saved.id })
  const unconfirmed = async () => {
    await source.s.doRuns.tick()
    const run = await source.read(saved.id)
    expect(run.status).toBe('cancelling')
    expect(run.items[0].state).toMatchObject({
      status: 'cancelling',
      blockedReason: expect.stringContaining('Stop timed out'),
    })
  }
  await unconfirmed()
  await unconfirmed()
  const [thread] = doThreads(target.s)
  expect(target.s.tasks.hasWorkingFamily(thread.id) || thread.status === 'running').toBe(true)
  stop.mockRestore()
  await source.until(saved.id, (run) => expect(run.status).toBe('cancelled'))
  expect(target.s.tasks.hasWorkingFamily(thread.id)).toBe(false)
  expect(target.s.store.task(thread.id).status).not.toBe('running')
})

it('keeps reconciling other runs while a paired computer is not answering', async () => {
  const source = await setup()
  const target = await setup()
  await pair(source, target)
  let answer = () => {}
  const answered = new Promise<void>((resolve) => {
    answer = resolve
  })
  const dispatch = target.s.doThreads.dispatch.bind(target.s.doThreads)
  vi.spyOn(target.s.doThreads, 'dispatch').mockImplementation(async (owner, input) => {
    await answered
    return dispatch(owner, input)
  })
  const stuck = await source.call('save', plan([item('a', [], target.s.runtimeId)]))
  await source.call('start', { id: stuck.id, expectedRevision: stuck.revision })
  await vi.waitFor(async () =>
    expect((await source.read(stuck.id)).items[0].state.status).toBe('dispatching'),
  )
  const local = await source.call('save', plan([item('b')]))
  await source.call('start', { id: local.id, expectedRevision: local.revision })
  // The scheduler alone, without awaiting the stuck run, finishes the local one.
  await vi.waitFor(
    async () => {
      source.s.doRuns.wake()
      expect((await source.read(local.id)).status).toBe('review')
    },
    { timeout: 15_000, interval: 50 },
  )
  expect((await source.read(stuck.id)).items[0].state.status).toBe('dispatching')
  answer()
  await source.until(stuck.id, (run) => expect(run.status).toBe('review'))
})

it('stops working children of an idle work item thread when its run is cancelled', async () => {
  let childId = ''
  let childStarted = () => {}
  const started = new Promise<void>((resolve) => {
    childStarted = resolve
  })
  const f: Setup = await setup(async (context) => {
    if (context.agent.provider === 'claude') {
      childStarted()
      // Ends only when stopped: children are not left to finish on their own.
      await new Promise<void>((resolve) =>
        context.signal.addEventListener('abort', () => resolve(), { once: true }),
      )
      return
    }
    if (!context.taskId) throw new Error('Expected a task execution')
    childId = f.s.tasks.subagentSpawn({
      taskId: context.taskId,
      key: 'child',
      name: 'Child',
      prompt: 'Keep working',
      provider: 'claude',
    }).id
    await started
    context.onText('Waiting for the child')
  })
  const saved = await f.call('save', plan([item('a')]))
  await f.call('start', { id: saved.id, expectedRevision: saved.revision })
  await started
  const [root] = doThreads(f.s)
  await vi.waitFor(() => {
    expect(f.s.store.task(root.id).status).not.toBe('running')
    expect(f.s.store.task(root.id).activeRunId).toBeUndefined()
    expect(f.s.store.task(childId).status).toBe('running')
  })
  await f.until(saved.id, (run) => expect(run.items[0].state.status).toBe('running'))
  await f.call('cancel', { id: saved.id })
  await f.until(saved.id, (run) => expect(run.status).toBe('cancelled'))
  expect(f.s.tasks.hasWorkingFamily(root.id)).toBe(false)
  expect(f.s.store.task(childId).status).toBe('cancelled')
  expect(f.s.store.task(root.id)).toMatchObject({ status: 'cancelled', queuePaused: true })
})

it('keeps observing and cancelling owned work after Do is turned off, without dispatching more', async () => {
  const releases: (() => void)[] = []
  const f = await setup(held(releases))
  const saved = await f.call('save', plan([item('a'), item('b', ['a']), item('c')], 1))
  await f.call('start', { id: saved.id, expectedRevision: saved.revision })
  await vi.waitFor(() => expect(releases).toHaveLength(1), { timeout: 15_000 })
  f.s.preferences.save({ enableDo: false })
  await release(releases, 1)
  // The running item is still observed to completion; nothing new is dispatched.
  await f.until(saved.id, (run) => {
    expect(run.items[0].state.status).toBe('completed')
    expect(run.status).toBe('attention')
  })
  const paused = await f.read(saved.id)
  expect(paused.items.slice(1).map((value) => value.state.status)).toEqual(['pending', 'pending'])
  expect(f.calls).toHaveLength(1)
  expect((await f.raw('/api/do/retry', { id: saved.id })).status).toBe(403)
  expect(
    decode(doListReplySchema, await (await f.raw('/api/do/list')).json()).runs.map((run) => run.id),
  ).toEqual([saved.id])
  await f.call('cancel', { id: saved.id })
  await f.until(saved.id, (run) => expect(run.status).toBe('cancelled'))
  expect(
    (await f.raw('/api/do/delete', { id: saved.id, expectedRevision: paused.revision })).status,
  ).toBe(200)
})

it('blocks work for a paired computer with Do turned off and can still cancel it', async () => {
  const source = await setup()
  const target = await setup(undefined, { enabled: false })
  await pair(source, target)
  const saved = await source.call('save', plan([item('a', [], target.s.runtimeId)]))
  await source.call('start', { id: saved.id, expectedRevision: saved.revision })
  await source.until(saved.id, (run) =>
    expect(run.items[0].state).toMatchObject({
      status: 'blocked',
      blockedReason: expect.stringContaining('turned off on this paired computer'),
    }),
  )
  await source.call('cancel', { id: saved.id })
  await source.until(saved.id, (run) => expect(run.status).toBe('cancelled'))
  expect(doThreads(target.s)).toHaveLength(0)
})

it('does not start a retry while the previous attempt cannot be observed', async () => {
  let attempts = 0
  const source = await setup()
  const target = await setup(async (context) => {
    if (++attempts === 1) throw new Error('First attempt failed')
    context.onText('Recovered')
  })
  await pair(source, target)
  const saved = await source.call('save', plan([item('a', [], target.s.runtimeId)]))
  await source.call('start', { id: saved.id, expectedRevision: saved.revision })
  await source.until(saved.id, (run) => expect(run.items[0].state.status).toBe('failed'))
  // Studio on the source computer stopped registering the paired computer.
  const offline = vi.spyOn(DoPeers.prototype, 'list').mockResolvedValue([])
  await source.call('retry', { id: saved.id })
  const held = async () => {
    await source.s.doRuns.tick()
    const run = await source.read(saved.id)
    expect(run.status).toBe('attention')
    expect(run.items[0].state).toMatchObject({
      status: 'pending',
      attempt: 1,
      blockedReason: expect.stringContaining('Studio'),
    })
  }
  await held()
  await held()
  expect(attempts).toBe(1)
  offline.mockRestore()
  await source.until(saved.id, (run) => expect(run.status).toBe('review'))
  expect((await source.read(saved.id)).items[0].state).toMatchObject({
    status: 'completed',
    attempt: 2,
  })
  expect(attempts).toBe(2)
  expect(doThreads(target.s)).toHaveLength(1)
})

it('drops observations that finish after the run was cancelled', async () => {
  const releases: (() => void)[] = []
  const source = await setup()
  const target = await setup(held(releases))
  await pair(source, target)
  const saved = await source.call('save', plan([item('a', [], target.s.runtimeId), item('b')], 1))
  await source.call('start', { id: saved.id, expectedRevision: saved.revision })
  await vi.waitFor(() => expect(releases).toHaveLength(1), { timeout: 15_000 })
  await source.until(saved.id, (run) => expect(run.items[0].state.status).toBe('running'))
  let resume = () => {}
  const gate = new Promise<void>((resolve) => {
    resume = resolve
  })
  const observing = vi.spyOn(DoPeers.prototype, 'list')
  observing.mockImplementationOnce(async function (this: DoPeers, signal: AbortSignal) {
    await gate
    observing.mockRestore()
    return this.list(signal)
  })
  // The agent finishes while the origin's observation is still in flight.
  const ticking = source.s.doRuns.tick()
  await vi.waitFor(() => expect(observing).toHaveBeenCalled())
  releases.splice(0).forEach((finish) => finish())
  await vi.waitFor(() => expect(doThreads(target.s)[0].status).not.toBe('running'))
  const cancelled = await source.call('cancel', { id: saved.id })
  expect(cancelled.items.map((value) => value.state.status)).toEqual(['cancelling', 'cancelled'])
  resume()
  await ticking
  const after = await source.read(saved.id)
  expect(after.status).toBe('cancelling')
  expect(after.items.map((value) => value.state.status)).toEqual(['cancelling', 'cancelled'])
  await source.until(saved.id, (run) => expect(run.status).toBe('cancelled'))
  expect(source.calls).toHaveLength(0)
})

it('observes local items of a run while its paired computer dispatch is not answering', async () => {
  const source = await setup()
  const target = await setup()
  await pair(source, target)
  let answer = () => {}
  const answered = new Promise<void>((resolve) => {
    answer = resolve
  })
  const dispatch = target.s.doThreads.dispatch.bind(target.s.doThreads)
  vi.spyOn(target.s.doThreads, 'dispatch').mockImplementation(async (owner, input) => {
    await answered
    return dispatch(owner, input)
  })
  const saved = await source.call('save', plan([item('a', [], target.s.runtimeId), item('b')]))
  await source.call('start', { id: saved.id, expectedRevision: saved.revision })
  await vi.waitFor(
    async () => {
      source.s.doRuns.wake()
      expect((await source.read(saved.id)).items.map((value) => value.state.status)).toEqual([
        'dispatching',
        'completed',
      ])
    },
    { timeout: 15_000, interval: 50 },
  )
  answer()
  await source.until(saved.id, (run) => expect(run.status).toBe('review'))
})

it('serializes shared checkout work across separate plans and remote origins', async () => {
  const releases: (() => void)[] = []
  const f = await setup(held(releases))
  const first = await f.call('save', plan([item('a')]))
  await f.call('start', { id: first.id, expectedRevision: first.revision })
  await f.until(first.id, (run) => expect(run.items[0].state.status).toBe('running'))
  await vi.waitFor(() => expect(releases).toHaveLength(1))
  const second = await f.call('save', plan([item('b')]))
  await f.call('start', { id: second.id, expectedRevision: second.revision })
  await f.until(second.id, (run) => {
    expect(run.items[0].state.status).toBe('blocked')
    expect(run.items[0].state.blockedReason).toContain('project checkout')
  })
  await expect(
    f.s.doThreads.dispatch('origin:elsewhere', {
      runtimeId: f.s.runtimeId,
      key: 'elsewhere:run:item',
      messageId: 'do:elsewhere:item:1',
      repositoryId: 'repo',
      agentId: 'agent',
      execution: 'main',
      title: 'Remote item',
      text: 'Do the item',
    }),
  ).rejects.toThrow('project checkout')
  expect(f.calls).toHaveLength(1)
  await release(releases, 1)
  await f.until(first.id, (run) => expect(run.status).toBe('review'))
  await f.until(second.id, (run) => expect(run.items[0].state.status).toBe('running'))
  await release(releases, 1)
  await f.until(second.id, (run) => expect(run.status).toBe('review'))
  expect(f.calls).toHaveLength(2)
  expect(doThreads(f.s).map((task) => task.error)).toEqual([undefined, undefined])
})

it.each([1, 2])('cannot launch after a stop during model resolution phase %s', async (phase) => {
  const f = await setup()
  let unblock = () => {}
  const gate = new Promise<void>((resolve) => {
    unblock = resolve
  })
  let entered = false
  const resolving = vi.spyOn(ModelSelection.prototype, 'resolveEffect')
  if (phase === 2) resolving.mockImplementationOnce(() => Effect.void)
  resolving.mockImplementationOnce(() => {
    entered = true
    return Effect.promise(() => gate)
  })
  const request = {
    runtimeId: f.s.runtimeId,
    key: 'origin:race:item',
    messageId: 'do:race:item:1',
    repositoryId: 'repo',
    agentId: 'agent',
    execution: 'main' as const,
    title: 'Delayed item',
    text: 'Do the item',
  }
  const dispatch = f.s.doThreads.dispatch('local', request)
  await vi.waitFor(() => expect(entered).toBe(true))
  expect(f.s.doThreads.stop('local', request.key, request.messageId)).toBe('requested')
  unblock()
  await dispatch
  expect(f.s.doThreads.stop('local', request.key, request.messageId)).toBe('confirmed')
  expect(f.calls).toHaveLength(0)
  expect(doThreads(f.s)[0].queue ?? []).toEqual([])
  expect(f.s.tasks.hasWorkingFamily(doThreads(f.s)[0].id)).toBe(false)
})
