import { afterEach, expect, it, vi } from 'vite-plus/test'
import { join } from 'node:path'
import { startRuntime } from './index'
import { createServices } from './services'
import { openDatabase } from './storage/database'
import { fixture } from './testing/fixture'
import { GithubTransport } from './scm/git/github-transport'
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})
it('does not persist successful CLI read edges but retains failed reads and mutations', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const db = openDatabase(':memory:')
  const s = createServices(db, 'command-audit-test-owner-token-with-32-characters')
  cleanups.push(async () => {
    await s.tasks.dispose()
    db.close()
  })
  await s.git.inspect(f.directory)
  await s.git.command(f.directory, ['config', '--null', '--list'])
  expect(s.activity.list('', 'command', 0).events).toEqual([])
  await expect(
    s.git.command(f.directory, ['rev-parse', '--verify', 'refs/heads/missing']),
  ).rejects.toThrow(/refs\/heads\/missing/)
  const failures = s.activity.list('', 'command', 0).events
  expect(failures).toHaveLength(1)
  expect(failures[0].summary).toContain('failed')
  expect(JSON.parse(failures[0].payload)).toMatchObject({
    args: [s.commands.get().git, 'rev-parse', '--verify', 'refs/heads/missing'],
    error: expect.any(String),
  })
  await s.git.command(f.directory, ['config', 'user.name', 'Audit fixture'])
  const events = s.activity.list('', 'command', 0).events
  expect(events).toHaveLength(3)
  expect(events.map((event) => event.summary)).toEqual(
    expect.arrayContaining([
      expect.stringContaining('started'),
      expect.stringContaining('completed'),
      expect.stringContaining('failed'),
    ]),
  )
})
it('does not persist API reads while retaining failed reads, REST writes and GraphQL mutations', async () => {
  const db = openDatabase(':memory:')
  const s = createServices(db, 'api-audit-test-owner-token-with-32-characters')
  const transport = vi.spyOn(GithubTransport.prototype, 'send').mockResolvedValue('{}')
  const account = { host: 'github.com', token: 'private-fixture-token' }
  const request = (args: string[]) => s.git.githubAccount(args, undefined, '/repo', account)
  try {
    await request(['api', 'repos/team/app/actions/runs'])
    await request(['api', 'graphql', '-f', 'query=query { viewer { login } }'])
    expect(s.activity.list('', 'command', 0).events).toEqual([])
    transport.mockRejectedValueOnce(new Error('Fixture network error'))
    await expect(request(['api', 'repos/team/app/actions/runs'])).rejects.toThrow(
      'Fixture network error',
    )
    expect(s.activity.list('', 'command', 0).events).toHaveLength(1)
    await request(['api', 'repos/team/app/issues', '-f', 'title=New issue'])
    await request([
      'api',
      'graphql',
      '-f',
      'query=mutation { addStar(input:{starrableId:"id"}) { clientMutationId } }',
    ])
    const events = s.activity.list('', 'command', 0).events
    expect(events).toHaveLength(5)
    expect(events.filter((event) => event.summary.endsWith('completed'))).toHaveLength(2)
    expect(JSON.stringify(events)).not.toContain(account.token)
  } finally {
    transport.mockRestore()
    await s.tasks.dispose()
    db.close()
  }
})
it('restarts over the same database without replaying conversations into activity', async () => {
  const f = await fixture()
  cleanups.push(f.cleanup)
  const options = {
    databasePath: join(f.directory, '.git', 'startup.sqlite'),
    ownerToken: 'startup-test-owner-token-with-32-characters',
    port: 0,
  }
  let r = await startRuntime(options)
  const runtimeId = r.services.runtimeId
  const firstInstance = r.services.instanceId
  cleanups.push(() => r.close())
  r.services.store.update(() => f.workspace)
  const task = r.services.tasks.create({
    title: 'Seeded',
    repositoryId: 'repo',
    agentId: 'agent',
    objective: 'Original request',
  })
  r.services.store.updateTaskHistory(task.id, (t) => ({
    ...t,
    messages: [...t.messages, { id: 'reply', role: 'assistant', text: 'Answer' }],
  }))
  const count = (kind: string) => {
    const row = r.services.db
      .prepare('SELECT COUNT(*) AS total FROM activity WHERE kind=? AND scope=?')
      .get(kind, task.id)
    if (!row || typeof row !== 'object' || !('total' in row) || typeof row.total !== 'number')
      throw new Error('Invalid activity count')
    return row.total
  }
  const before = { task: count('task'), message: count('message') }
  expect(before.task).toBeGreaterThan(0)
  expect(before.message).toBe(2)
  await r.close()
  r = await startRuntime(options)
  expect(r.services.runtimeId).toBe(runtimeId)
  expect(r.services.instanceId).not.toBe(firstInstance)
  expect({ task: count('task'), message: count('message') }).toEqual(before)
  expect(r.services.activity.pruneBefore(new Date(Date.now() + 60_000).toISOString())).toBe(
    before.task + before.message,
  )
  await r.close()
  r = await startRuntime(options)
  expect({ task: count('task'), message: count('message') }).toEqual({ task: 0, message: 0 })
  expect(r.services.store.task(task.id).messages.map((m) => m.id)).toContain('reply')
})

it.each([false, true])(
  'audits only the interrupted assistant stream on crash recovery (boundary=%s)',
  async (boundary) => {
    const f = await fixture()
    cleanups.push(f.cleanup)
    const options = {
      databasePath: join(f.directory, '.git', 'stream-crash.sqlite'),
      ownerToken: 'startup-test-owner-token-with-32-characters',
      port: 0,
    }
    function reopen() {
      const db = openDatabase(options.databasePath)
      const services = createServices(db, options.ownerToken)
      cleanups.push(async () => {
        await services.tasks.dispose()
        if (db.open) db.close()
      })
      return services
    }
    let services = reopen()
    services.store.update(() => f.workspace)
    const task = services.tasks.create({
      title: 'Interrupted stream',
      repositoryId: 'repo',
      agentId: 'agent',
      objective: 'Original request',
    })
    services.store.updateTaskHistory(task.id, (current) => ({
      ...current,
      messages: [...current.messages, { id: 'old', role: 'assistant', text: 'Pruned old answer' }],
    }))
    services.activity.pruneBefore(new Date(Date.now() + 60_000).toISOString())
    services.store.updateTaskHistory(task.id, (current) => ({
      ...current,
      status: 'running',
      runPhase: 'provider',
      activeRunId: 'interrupted-attempt',
      turns: [
        {
          id: 'turn',
          assistantId: 'inflight',
          status: 'running',
          agentId: 'agent',
          provider: 'codex',
          model: '',
          startedAt: new Date().toISOString(),
        },
      ],
    }))
    services.store.updateTaskHistory(task.id, (current) => ({
      ...current,
      messages: [...current.messages, { id: 'inflight', role: 'assistant', text: '' }],
    }))
    if (boundary)
      services.store.updateTaskHistory(task.id, (current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.id === 'inflight'
            ? { ...message, text: 'First segment.', textBreaks: [14] }
            : message,
        ),
      }))
    services.store.updateTaskHistory(task.id, (current) => ({
      ...current,
      messages: current.messages.map((message) =>
        message.id === 'inflight'
          ? { ...message, text: 'First segment. Unsaved audit tail.' }
          : message,
      ),
    }))
    expect(services.activity.list('', 'message', 0).events).toHaveLength(boundary ? 1 : 0)
    // No executor owns this seeded run, so reopening preserves the crash-time workspace
    // without completing the turn or flushing Activity's in-memory stream buffer.
    await services.tasks.dispose()
    services.db.close()
    services = reopen()
    const rows = services.activity.list('', 'message', 0).events
    expect(services.store.task(task.id).status).toBe('failed')
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(`message:${task.id}:inflight`)
    expect(JSON.parse(rows[0].payload)).toMatchObject({
      text: 'First segment. Unsaved audit tail.',
    })
    services.activity.pruneBefore(new Date(Date.now() + 60_000).toISOString())
    await services.tasks.dispose()
    services.db.close()
    services = reopen()
    expect(services.activity.list('', 'message', 0).events).toEqual([])
  },
)
